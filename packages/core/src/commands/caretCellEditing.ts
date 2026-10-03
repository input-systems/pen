import type { CellSelection, CommandResult, Editor } from "@input/pen-types";

import {
	nextGraphemeBoundary,
	nextWordBoundary,
	previousGraphemeBoundary,
	previousWordBoundary,
} from "../editor/textSegmentation";
import {
	arrowFromBlockSelection,
	type ArrowDirection,
	transitionCellSelection,
} from "../selection/transitions";
import {
	buildTransitionSnapshot,
	fromTransitionSelection,
	getEditorLocale,
	toTransitionSelection,
} from "./helpers";
import type { CaretMotionParam } from "./caretParams";

type CellMotionKind =
	| ArrowDirection
	| "word-left"
	| "word-right"
	| "line-start"
	| "line-end";

/** The selection while a cell is being edited: a cell selection with `text` (T6). */
export function editedCellSelection(
	editor: Editor,
): (CellSelection & { text: { anchor: number; focus: number } }) | null {
	const selection = editor.selection;
	if (selection?.type !== "cell" || !selection.text) {
		return null;
	}
	return { ...selection, text: selection.text };
}

/**
 * T6: caret motion inside an edited cell stays a `CellSelection` and moves
 * its `text`. Undefined when no cell is being edited.
 */
export function handleCellEditingCaret(
	editor: Editor,
	param: CaretMotionParam,
	direction: CellMotionKind,
): CommandResult | false | undefined {
	const selection = editedCellSelection(editor);
	if (!selection) {
		return undefined;
	}

	const cell = editor
		.getBlock(selection.blockId)
		?.as("table")
		?.tableCell(selection.head.row, selection.head.col);
	const text = cell?.textContent() ?? "";
	const length = cell?.length() ?? text.length;
	const next = stepCellText(
		text,
		{
			anchor: clampCellOffset(length, selection.text.anchor),
			focus: clampCellOffset(length, selection.text.focus),
		},
		direction,
		param.extend,
		getEditorLocale(editor),
	);
	return { selection: { ...selection, text: next } };
}

export function handleCellSelectionArrow(
	editor: Editor,
	param: CaretMotionParam,
	direction: ArrowDirection,
): CommandResult | false | undefined {
	if (editor.selection?.type !== "cell") {
		return undefined;
	}
	const snapshot = buildCellTransitionSnapshot(editor);
	const next = transitionCellSelection(
		snapshot,
		toTransitionSelection(editor),
		{
			source: "keyboard",
			direction,
			extend: param.extend,
		},
	);
	const selection = fromTransitionSelection(next, snapshot.blockOrder);
	if (!selection) {
		return false;
	}
	return { selection };
}

function buildCellTransitionSnapshot(editor: Editor) {
	const snapshot = buildTransitionSnapshot(editor);
	const blocks = { ...snapshot.blocks };
	for (const id of snapshot.blockOrder) {
		const existing = blocks[id];
		if (!existing) {
			continue;
		}
		const table = editor.getBlock(id)?.as("table");
		if (!table) {
			continue;
		}
		blocks[id] = {
			...existing,
			grid: {
				rows: table.tableRowCount(),
				cols: table.tableColumnCount(),
			},
		};
	}
	return { ...snapshot, blocks };
}

/**
 * Extend moves the focus. A plain motion collapses: a caret steps, and a
 * range steps from its edge in the motion's direction.
 */
function stepCellText(
	text: string,
	range: { anchor: number; focus: number },
	direction: CellMotionKind,
	extend: boolean,
	locale: string,
): { anchor: number; focus: number } {
	if (extend) {
		return {
			anchor: range.anchor,
			focus: nextCellTextOffset(text, range.focus, direction, locale),
		};
	}
	const from = isBackwardCellMotion(direction)
		? Math.min(range.anchor, range.focus)
		: Math.max(range.anchor, range.focus);
	const to = nextCellTextOffset(text, from, direction, locale);
	return { anchor: to, focus: to };
}

function nextCellTextOffset(
	text: string,
	offset: number,
	direction: CellMotionKind,
	locale: string,
): number {
	switch (direction) {
		case "left":
			return previousGraphemeBoundary(text, offset, locale);
		case "right":
			return nextGraphemeBoundary(text, offset, locale);
		case "up":
		case "line-start":
			return 0;
		case "down":
		case "line-end":
			return text.length;
		case "word-left":
			return previousWordBoundary(text, offset, locale);
		case "word-right":
			return nextWordBoundary(text, offset, locale);
		default: {
			const _exhaustive: never = direction;
			return _exhaustive;
		}
	}
}

function isBackwardCellMotion(direction: CellMotionKind): boolean {
	switch (direction) {
		case "left":
		case "up":
		case "word-left":
		case "line-start":
			return true;
		case "right":
		case "down":
		case "word-right":
		case "line-end":
			return false;
		default: {
			const _exhaustive: never = direction;
			return _exhaustive;
		}
	}
}

function clampCellOffset(length: number, offset: number): number {
	if (offset <= 0) {
		return 0;
	}
	if (offset >= length) {
		return length;
	}
	return offset;
}
