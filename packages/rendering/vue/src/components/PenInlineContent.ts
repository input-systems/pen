import { fullReconcileDeltasToDOM } from "@input/pen-dom/field-editor/reconciler";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import { isDomHTMLElement } from "@input/pen-dom/utils/domNodes";
import { isInlineContentEmpty } from "@input/pen-dom/utils/editorEmptyState";
import { fieldEditorTextEntryAttrs } from "@input/pen-dom/utils/fieldEditorTextEntryAttrs";
import {
	applyInlineDecorationsToDeltas,
	filterVisibleInlineDecorationDeltas,
} from "@input/pen-dom/utils/inlineDecorations";
import { resolveInlinePlaceholderVisibility } from "@input/pen-dom/utils/placeholderVisibility";
import { replaceElementChildren } from "@input/pen-dom/utils/replaceElementChildren";
import type { InlineDecoration } from "@input/pen-types";
import {
	computed,
	defineComponent,
	h,
	ref,
	watch,
	type ComponentPublicInstance,
	type PropType,
} from "vue";
import { useBlockSnapshot } from "../internal/blockNotifier";
import { readBlockTextSnapshot } from "../internal/editorState";
import { resolveEditorSchemaPlaceholder } from "../internal/displayCopy";
import { useEditorContext } from "../internal/editorContext";
import { useFieldEditorContext } from "../internal/fieldEditorContext";

/**
 * Renders a block's editable text, including inline decorations and the
 * empty-block placeholder. Pen reconciles this subtree directly from the
 * document rather than through Vue's renderer, which is what keeps
 * typing, composition, and selection intact.
 */
export const PenInlineContent = defineComponent({
	name: "PenInlineContent",
	props: {
		blockId: {
			type: String,
			required: true,
		},
		placeholder: {
			type: String as PropType<string | undefined>,
			default: undefined,
		},
		as: {
			type: String as PropType<string>,
			default: "span",
		},
		direction: {
			type: String as PropType<string | undefined>,
			default: undefined,
		},
	},
	setup(props) {
		const { editor, emptyPlaceholder } = useEditorContext();
		const fieldEditor = useFieldEditorContext();
		// This block's notifier slices only (SCALE6).
		const slices = useBlockSnapshot(props.blockId);
		const blockDecorations = slices.decorations;
		// Text is re-read only when the block's commit slice moves.
		const textSnapshot = computed(() => {
			void slices.commit.value;
			return readBlockTextSnapshot(editor, props.blockId);
		});
		const elementRef = ref<HTMLElement | null>(null);

		const isActive = computed(() => slices.field.value.isFieldFocus);
		// Expanded mode and this block among its active blocks.
		const isExpandedOwnedBlock = computed(
			() => slices.field.value.expandedRole !== null,
		);
		const schemaPlaceholder = computed(() =>
			resolveEditorSchemaPlaceholder(editor, props.blockId),
		);
		const isDocumentPlaceholderTarget = slices.isPlaceholderTarget;
		const isFocusedBlock = computed(
			() => isActive.value || slices.selection.value.caretHere,
		);
		const blockTextEmpty = computed(() =>
			isInlineContentEmpty(textSnapshot.value.deltas),
		);
		const placeholderVisibility = computed(() =>
			resolveInlinePlaceholderVisibility({
				blockTextEmpty: blockTextEmpty.value,
				isDocumentPlaceholderTarget: isDocumentPlaceholderTarget.value,
				isFocusedBlock: isFocusedBlock.value,
				hasEmptyPlaceholder: !!emptyPlaceholder.value,
				hasExplicitPlaceholder: !!props.placeholder,
				hasSchemaPlaceholder: !!schemaPlaceholder.value,
				suppressPlaceholders: false,
			}),
		);
		const placeholder = computed(() => {
			const visibility = placeholderVisibility.value;
			if (visibility.showDocumentPlaceholder) {
				return emptyPlaceholder.value;
			}
			if (visibility.showExplicitPlaceholder) {
				return props.placeholder;
			}
			if (visibility.showBlockPlaceholder) {
				return schemaPlaceholder.value;
			}
			return undefined;
		});
		const renderedDeltas = computed(() => {
			const inlineDecorations = blockDecorations.value.filter(
				(decoration): decoration is InlineDecoration =>
					decoration.type === "inline",
			);

			return inlineDecorations.length > 0
				? filterVisibleInlineDecorationDeltas(
						applyInlineDecorationsToDeltas(
							textSnapshot.value.deltas,
							inlineDecorations,
						),
					)
				: [...textSnapshot.value.deltas];
		});

		watch(
			[elementRef, isActive, isExpandedOwnedBlock],
			([nextElement, nextIsActive, nextIsExpandedOwnedBlock]) => {
				if (
					nextElement &&
					nextIsActive &&
					fieldEditor &&
					!nextIsExpandedOwnedBlock
				) {
					fieldEditor.attachElement(nextElement);
				}
			},
			{ immediate: true },
		);

		watch(
			[
				elementRef,
				textSnapshot,
				renderedDeltas,
				isActive,
				isExpandedOwnedBlock,
			],
			([
				nextElement,
				nextTextSnapshot,
				nextRenderedDeltas,
				nextIsActive,
				nextIsExpandedOwnedBlock,
			]) => {
				if (!nextElement) {
					return;
				}
				if (nextIsActive || nextIsExpandedOwnedBlock) {
					return;
				}
				if (!nextTextSnapshot.exists) {
					// HOST4: replaceChildren is above some hosts; fallback clears then
					// appends. The inactive block still empties — no user-visible
					// degradation.
					replaceElementChildren(nextElement);
					return;
				}

				fullReconcileDeltasToDOM(
					[...nextRenderedDeltas],
					nextElement,
					editor.schema,
					{
						editor,
					},
				);
				// P3: a no-op unless this block is the projection target.
				fieldEditor?.projectAfterRebuild?.([props.blockId]);
			},
			{ immediate: true },
		);

		// DIR2: the block host (PenBlock) is the resolved-dir sink. This
		// surface only applies an explicit override — the direction prop or
		// the block's declared props.direction — so standalone mounts keep
		// working and the inline span inherits the block's resolved dir when
		// neither is set. Never `dir="auto"`. AX4: do not set `aria-hidden`
		// (visible atom chips stay in the tree; `aria-label` comes from the
		// reconciler).
		return () =>
			h(
				props.as,
				{
					ref: (
						element: Element | ComponentPublicInstance | null,
					) => {
						elementRef.value =
							isDomHTMLElement(element) ? element : null;
					},
					[DATA_ATTRS.inlineContent]: "",
					[DATA_ATTRS.fieldEditorSurface]: "",
					...fieldEditorTextEntryAttrs(
						isActive.value && !isExpandedOwnedBlock.value,
						editor,
					),
					[DATA_ATTRS.placeholderVisible]: placeholder.value
						? ""
						: undefined,
					"data-placeholder": placeholder.value,
					dir: resolveInlineContentDir(
						props.direction ?? slices.commit.value.props?.direction,
					),
					// RI1: unicode-bidi does not inherit, so the block host's isolate does
					// not reach this surface and it needs its own.
					// RI5: stored newlines and repeated spaces are document characters;
					// under the initial `normal` they collapse and become unreachable.
					style: {
						position: placeholder.value ? "relative" : undefined,
						unicodeBidi: "isolate",
						whiteSpace: "pre-wrap",
					},
					"data-selected": slices.selection.value.inSelection
						? ""
						: undefined,
				},
				[],
			);
	},
});

function resolveInlineContentDir(
	direction: unknown,
): "ltr" | "rtl" | undefined {
	if (direction === "ltr" || direction === "rtl") {
		return direction;
	}
	return undefined;
}
