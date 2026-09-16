import { isCollapsed } from "@input/pen-core";
import { fullReconcileDeltasToDOM } from "@input/pen-dom/field-editor/reconciler";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
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
import { useSelection } from "../composables/useSelection";
import {
	isBlockSelected,
	useBlockDecorations,
	useBlockModel,
	useBlockTextSnapshot,
	useDocumentPlaceholderTarget,
	useFieldEditorState,
} from "../internal/editorState";
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
		const selection = useSelection(editor);
		const fieldEditorState = useFieldEditorState(fieldEditor);
		const blockModel = useBlockModel(editor, props.blockId);
		const blockDecorations = useBlockDecorations(editor, props.blockId);
		const textSnapshot = useBlockTextSnapshot(editor, props.blockId);
		const documentPlaceholderTarget = useDocumentPlaceholderTarget(editor);
		const elementRef = ref<HTMLElement | null>(null);

		const isActive = computed(
			() => fieldEditorState.value.focusBlockId === props.blockId,
		);
		const isExpandedOwnedBlock = computed(
			() =>
				fieldEditorState.value.mode === "expanded" &&
				fieldEditorState.value.activeBlockIds.includes(props.blockId),
		);
		const schemaPlaceholder = computed(() =>
			resolveEditorSchemaPlaceholder(editor, props.blockId),
		);
		const isDocumentPlaceholderTarget = computed(
			() => documentPlaceholderTarget.value === props.blockId,
		);
		const isFocusedBlock = computed(() => {
			return (
				isActive.value ||
				(selection.value?.type === "text" &&
					isCollapsed(selection.value) &&
					selection.value.focus.blockId === props.blockId)
			);
		});
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
			[elementRef, isActive, fieldEditorState],
			([nextElement, nextIsActive, nextFieldEditorState]) => {
				if (
					nextElement &&
					nextIsActive &&
					fieldEditor &&
					nextFieldEditorState.mode !== "expanded"
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
						preserveSelection: false,
					},
				);
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
							element instanceof HTMLElement ? element : null;
					},
					[DATA_ATTRS.inlineContent]: "",
					[DATA_ATTRS.fieldEditorSurface]: "",
					...fieldEditorTextEntryAttrs(
						isActive.value &&
							fieldEditorState.value.mode !== "expanded",
						editor,
					),
					[DATA_ATTRS.placeholderVisible]: placeholder.value
						? ""
						: undefined,
					"data-placeholder": placeholder.value,
					dir: resolveInlineContentDir(
						props.direction ?? blockModel.value.props?.direction,
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
					"data-selected": isBlockSelected(
						editor,
						selection.value,
						props.blockId,
					)
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
