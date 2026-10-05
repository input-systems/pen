import { fullReconcileDeltasToDOM } from "@input/pen-dom/field-editor/reconciler";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import { isDomHTMLElement } from "@input/pen-dom/utils/domNodes";
import { isInlineContentEmpty } from "@input/pen-dom/utils/editorEmptyState";
import { fieldEditorTextEntryAttrs } from "@input/pen-dom/utils/fieldEditorTextEntryAttrs";
import { replaceElementChildren } from "@input/pen-dom/utils/replaceElementChildren";
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
import { readCellTextSnapshot } from "../internal/editorState";
import { useEditorContext } from "../internal/editorContext";
import { useFieldEditorContext } from "../internal/fieldEditorContext";

const TABLE_CELL_MIN_WIDTH = "6rem";

export const PenTableCellContent = defineComponent({
	name: "PenTableCellContent",
	props: {
		tableBlockId: {
			type: String,
			required: true,
		},
		row: {
			type: Number,
			required: true,
		},
		col: {
			type: Number,
			required: true,
		},
		placeholder: {
			type: String as PropType<string | undefined>,
			default: undefined,
		},
	},
	setup(props) {
		const { editor } = useEditorContext();
		const fieldEditor = useFieldEditorContext();
		// The table block's notifier slices (SCALE6): the cell re-reads its text
		// when the table's commit slice moves.
		const tableSlices = useBlockSnapshot(props.tableBlockId);
		const textSnapshot = computed(() => {
			void tableSlices.commit.value;
			return readCellTextSnapshot(editor, props.tableBlockId, props.row, props.col);
		});
		const elementRef = ref<HTMLElement | null>(null);

		const isActiveCell = computed(() => {
			const activeCell = tableSlices.field.value.activeCell;
			return activeCell?.row === props.row && activeCell.col === props.col;
		});
		const showPlaceholder = computed(() => {
			return (
				!!props.placeholder &&
				isInlineContentEmpty(textSnapshot.value.deltas)
			);
		});

		watch(
			[elementRef, isActiveCell],
			([nextElement, nextIsActiveCell]) => {
				if (nextElement && nextIsActiveCell && fieldEditor) {
					fieldEditor.attachElement(nextElement);
				}
			},
			{ immediate: true },
		);

		watch(
			[elementRef, textSnapshot, isActiveCell],
			([nextElement, nextTextSnapshot, nextIsActiveCell]) => {
				if (nextIsActiveCell || !nextElement) {
					return;
				}
				if (!nextTextSnapshot.exists) {
					// HOST4: replaceChildren is above some hosts; fallback clears then
					// appends. The inactive cell still empties — no user-visible
					// degradation.
					replaceElementChildren(nextElement);
					return;
				}

				fullReconcileDeltasToDOM(
					[...nextTextSnapshot.deltas],
					nextElement,
					editor.schema,
					{
						editor,
					},
				);
			},
			{ immediate: true },
		);

		// DIR3/AX4: this cell host does not set `dir` or `aria-hidden`.
		// DIR2/DIR3 put `dir` on the table block wrapper (PenBlock); nested
		// blocks resolve independently there. AX4 keeps visible atom chips in
		// the tree (`aria-label` from the reconciler). Hiding this host would
		// hide them. HOST4 replaceChildren fallback above is unchanged.
		return () =>
			h("span", {
				ref: (element: Element | ComponentPublicInstance | null) => {
					elementRef.value =
						isDomHTMLElement(element) ? element : null;
				},
				[DATA_ATTRS.inlineContent]: "",
				[DATA_ATTRS.fieldEditorSurface]: "",
				...fieldEditorTextEntryAttrs(isActiveCell.value, editor),
				[DATA_ATTRS.ignorePointerGesture]: isActiveCell.value
					? ""
					: undefined,
				[DATA_ATTRS.placeholderVisible]: showPlaceholder.value
					? ""
					: undefined,
				[DATA_ATTRS.tableCellRow]: props.row,
				[DATA_ATTRS.tableCellCol]: props.col,
				"data-placeholder": showPlaceholder.value
					? props.placeholder
					: undefined,
				style: {
					minWidth: TABLE_CELL_MIN_WIDTH,
					minHeight: "1.5rem",
					display: "block",
					width: "100%",
					position: showPlaceholder.value ? "relative" : undefined,
					// RI1: unicode-bidi does not inherit, so every cell needs its own
					// isolate — the table host's does not reach them.
					unicodeBidi: "isolate",
					// RI5: same reason as the inline content host.
					whiteSpace: "pre-wrap",
				},
			});
	},
});
