import React, { useRef } from "react";
import type { Editor } from "@input/pen-types";
import { useEditorContext } from "../../context/editorContext";
import { useIsomorphicLayoutEffect } from "../../hooks/useIsomorphicLayoutEffect";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { useBlockSlice } from "../../hooks/useBlockNotifier";
import { fullReconcileDeltasToDOM } from "@input/pen-dom/field-editor/reconciler";
import { useCellTextSnapshot } from "../../hooks/useCellTextSnapshot";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import { isInlineContentEmpty } from "../../utils/editorEmptyState";
import { fieldEditorTextEntryAttrs } from "../../utils/fieldEditorTextEntryAttrs";
import { replaceElementChildren } from "@input/pen-dom/utils/replaceElementChildren";

const TABLE_CELL_MIN_WIDTH = "6rem";

export interface TableCellContentProps {
	tableBlockId: string;
	row: number;
	col: number;
	placeholder?: string;
}

export function TableCellContent(props: TableCellContentProps) {
	return <TextCell {...props} />;
}

function TextCell(props: TableCellContentProps) {
	const { tableBlockId, row, col, placeholder } = props;
	const { editor } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const activeCell = useBlockSlice(tableBlockId, "field").activeCell;
	const textSnapshot = useCellTextSnapshot(editor, tableBlockId, row, col);
	const elementRef = useRef<HTMLSpanElement>(null);

	const isActiveCell = activeCell?.row === row && activeCell.col === col;
	const showPlaceholder =
		!!placeholder && isInlineContentEmpty(textSnapshot.deltas);

	useIsomorphicLayoutEffect(() => {
		if (isActiveCell && elementRef.current && fieldEditor) {
			fieldEditor.attachElement(elementRef.current);
		}
	}, [isActiveCell, fieldEditor]);

	useIsomorphicLayoutEffect(() => {
		if (isActiveCell) return;
		if (!elementRef.current) return;
		if (!textSnapshot.exists) {
			replaceElementChildren(elementRef.current);
			return;
		}
		fullReconcileDeltasToDOM(
			[...textSnapshot.deltas],
			elementRef.current,
			editor.schema,
			{
				editor,
			},
		);
	}, [editor, isActiveCell, textSnapshot]);

	return (
		<span
			ref={elementRef}
			{...cellSurfaceAttrs(
				editor,
				isActiveCell,
				row,
				col,
				showPlaceholder,
				placeholder,
			)}
		/>
	);
}


function cellSurfaceAttrs(
	editor: Editor,
	isActiveCell: boolean,
	row: number,
	col: number,
	showPlaceholder: boolean,
	placeholder?: string,
): Record<string, unknown> {
	return {
		[DATA_ATTRS.inlineContent]: "",
		[DATA_ATTRS.fieldEditorSurface]: "",
		...fieldEditorTextEntryAttrs(isActiveCell, editor),
		[DATA_ATTRS.ignorePointerGesture]: isActiveCell ? "" : undefined,
		[DATA_ATTRS.placeholderVisible]: showPlaceholder ? "" : undefined,
		[DATA_ATTRS.tableCellRow]: row,
		[DATA_ATTRS.tableCellCol]: col,
		"data-placeholder": showPlaceholder ? placeholder : undefined,
		style: {
			minWidth: TABLE_CELL_MIN_WIDTH,
			minHeight: "1.5rem",
			display: "block",
			width: "100%",
			position: showPlaceholder ? ("relative" as const) : undefined,
			// RI1: unicode-bidi does not inherit, so every cell needs its own
			// isolate — the table host's does not reach them.
			unicodeBidi: "isolate" as const,
			// RI5: same reason as the inline content host.
			whiteSpace: "pre-wrap" as const,
		},
	};
}
