import type {
	CommandResult,
	Editor,
	Point,
	SelectionState,
} from "@input/pen-types";

import {
	nextWordBoundary,
	previousWordBoundary,
} from "../editor/textSegmentation";
import {
	nextNormalPosition,
	type NextNormalPositionResult,
} from "../selection/normalPosition";
import {
	arrowFromBlockSelection,
	escalateSelectAll,
	type ArrowDirection,
} from "../selection/transitions";
import { isCollapsed } from "../selection/helpers";
import {
	blockSelectionResult,
	buildNormalPositionSnapshot,
	buildTransitionSnapshot,
	collapsedAt,
	documentOrderedTextPoints,
	fromTransitionSelection,
	getAdjacentVisibleBlockId,
	getAtomRangeAtOffset,
	getEditorLocale,
	getVisibleBlockIds,
	isEditableTextBlock,
	logicalInline,
	readTextAnchor,
	readTextFocus,
	textSelectionResult,
	toTransitionSelection,
} from "./helpers";
import {
	getCellCaretFocus,
	handleCellEditingCaret,
	handleCellSelectionArrow,
} from "./caretCellEditing";
import type { CaretMotionParam, SelectBlockParam } from "./caretParams";
import { setVerticalCaretGoalX } from "./verticalCaret";

const LINE_EDGE_SEAM = Symbol.for("pen.lineEdgeSeam");

export type LineEdgePoint = {
	readonly blockId: string;
	readonly offset: number;
};

export type LineEdgeMeasure = (
	editor: Editor,
	current: LineEdgePoint,
	edge: "start" | "end",
) => LineEdgePoint | null;

export function setLineEdgeMeasure(
	editor: Editor,
	measure: LineEdgeMeasure | null,
): void {
	(editor as unknown as Record<symbol, LineEdgeMeasure | null>)[
		LINE_EDGE_SEAM
	] = measure;
}

function getLineEdgeMeasure(editor: Editor): LineEdgeMeasure | undefined {
	return (
		(editor as unknown as Record<symbol, LineEdgeMeasure | undefined>)[
			LINE_EDGE_SEAM
		] ?? undefined
	);
}

/**
 * G5: goalX is a vertical-only column. Successful left/right/word/line/doc
 * motion must not reuse the last vertical x. Misses leave it alone.
 */
export function finishNonVertical(
	editor: Editor,
	result: CommandResult | false,
): CommandResult | false {
	if (result !== false) {
		setVerticalCaretGoalX(editor, null);
	}
	return result;
}

export function handleGraphemeCaret(
	editor: Editor,
	param: CaretMotionParam,
	direction: -1 | 1,
): CommandResult | false {
	const arrow = direction === 1 ? "right" : "left";
	const fromCellEdit = handleCellEditingCaret(editor, param, arrow);
	if (fromCellEdit !== undefined) {
		return finishNonVertical(editor, fromCellEdit);
	}

	const fromBlock = handleBlockSelectionArrow(editor, param, arrow);
	if (fromBlock !== undefined) {
		return finishNonVertical(editor, fromBlock);
	}

	const fromCell = handleCellSelectionArrow(editor, param, arrow);
	if (fromCell !== undefined) {
		return finishNonVertical(editor, fromCell);
	}

	const collapsed = collapseTextRange(editor, param, direction);
	if (collapsed !== undefined) {
		return finishNonVertical(editor, collapsed);
	}

	const focus = readTextFocus(editor);
	if (!focus) {
		return false;
	}

	const atomSelection = stepInlineAtom(editor, param, focus, direction);
	if (atomSelection !== undefined) {
		return finishNonVertical(editor, atomSelection);
	}

	const snapshot = buildNormalPositionSnapshot(editor);
	const stepped = nextNormalPosition(snapshot, focus, direction);
	const next = resolveStep(editor, focus, stepped, direction);
	if (!next) {
		return false;
	}
	return finishNonVertical(editor, {
		selection: extendSelection(editor, param.extend, next),
	});
}

/**
 * A plain arrow on a range collapses it to the edge in that direction and
 * moves nothing else (T7). K1 prevents the browser default for every
 * navigation key, so this collapse has to be Pen's: stepping the focus
 * instead would strand a select-all at the document end, where there is no
 * next position, with the range still standing.
 */
function collapseTextRange(
	editor: Editor,
	param: CaretMotionParam,
	direction: -1 | 1,
): CommandResult | undefined {
	const selection = editor.selection;
	if (
		param.extend ||
		!selection ||
		selection.type !== "text" ||
		isCollapsed(selection)
	) {
		return undefined;
	}

	const ordered = documentOrderedTextPoints(editor, selection);
	if (!ordered) {
		return undefined;
	}

	const edge = direction === 1 ? ordered.end : ordered.start;
	return { selection: collapsedAt(edge.blockId, edge.offset) };
}

export function handleWordCaret(
	editor: Editor,
	param: CaretMotionParam,
	direction: -1 | 1,
): CommandResult | false {
	const fromCellEdit = handleCellEditingCaret(
		editor,
		param,
		direction === 1 ? "word-right" : "word-left",
	);
	if (fromCellEdit !== undefined) {
		return finishNonVertical(editor, fromCellEdit);
	}

	const fromBlock = handleBlockSelectionArrow(
		editor,
		param,
		direction === 1 ? "right" : "left",
	);
	if (fromBlock !== undefined) {
		return finishNonVertical(editor, fromBlock);
	}

	const fromCell = handleCellSelectionArrow(
		editor,
		param,
		direction === 1 ? "right" : "left",
	);
	if (fromCell !== undefined) {
		return finishNonVertical(editor, fromCell);
	}

	const focus = readTextFocus(editor);
	if (!focus) {
		return false;
	}

	const block = editor.getBlock(focus.blockId);
	if (!block || !isEditableTextBlock(editor, focus.blockId)) {
		return false;
	}

	const { text } = logicalInline(block);
	const locale = getEditorLocale(editor);
	const nextOffset =
		direction === 1
			? nextWordBoundary(text, focus.offset, locale)
			: previousWordBoundary(text, focus.offset, locale);

	if (nextOffset !== focus.offset) {
		return finishNonVertical(editor, {
			selection: extendSelection(editor, param.extend, {
				blockId: focus.blockId,
				offset: nextOffset,
			}),
		});
	}

	const crossed = crossBlock(
		editor,
		focus.blockId,
		direction === 1 ? "next" : "previous",
	);
	if (!crossed) {
		return false;
	}
	return finishNonVertical(editor, {
		selection: extendSelection(editor, param.extend, crossed),
	});
}

export function handleLineOrBlockEdge(
	editor: Editor,
	param: CaretMotionParam,
	edge: "start" | "end",
	visual: boolean,
): CommandResult | false {
	const fromCellEdit = handleCellEditingCaret(
		editor,
		param,
		edge === "end" ? "line-end" : "line-start",
	);
	if (fromCellEdit !== undefined) {
		return finishNonVertical(editor, fromCellEdit);
	}

	const fromBlock = handleBlockSelectionArrow(
		editor,
		param,
		edge === "end" ? "right" : "left",
	);
	if (fromBlock !== undefined) {
		return finishNonVertical(editor, fromBlock);
	}

	const focus = readTextFocus(editor);
	if (!focus) {
		return false;
	}
	const block = editor.getBlock(focus.blockId);
	if (!block) {
		return false;
	}
	const measured = visual
		? (getLineEdgeMeasure(editor)?.(editor, focus, edge) ?? null)
		: null;
	const next = measured ?? {
		blockId: focus.blockId,
		offset: edge === "start" ? 0 : block.length(),
	};
	return finishNonVertical(editor, {
		selection: extendSelection(editor, param.extend, next),
	});
}

export function handleDocEdge(
	editor: Editor,
	param: CaretMotionParam,
	edge: "start" | "end",
): CommandResult | false {
	if (getCellCaretFocus(editor)) {
		return true;
	}

	const fromBlock = handleBlockSelectionArrow(
		editor,
		param,
		edge === "end" ? "down" : "up",
	);
	if (fromBlock !== undefined) {
		return finishNonVertical(editor, fromBlock);
	}

	const focus = readTextFocus(editor);
	if (!focus && editor.selection?.type !== "block") {
		return false;
	}

	const target = documentEdgePoint(editor, edge);
	if (!target) {
		return false;
	}
	if (target.type === "block") {
		return finishNonVertical(editor, { selection: target.selection });
	}
	return finishNonVertical(editor, {
		selection: extendSelection(editor, param.extend, target.point),
	});
}

export function handleSelectAll(editor: Editor): CommandResult | false {
	const snapshot = buildTransitionSnapshot(editor);
	const next = escalateSelectAll(snapshot, toTransitionSelection(editor));
	const selection = fromTransitionSelection(next, snapshot.blockOrder);
	if (!selection) {
		return false;
	}
	return finishNonVertical(editor, { selection });
}

export function handleSelectBlock(
	editor: Editor,
	param: SelectBlockParam,
): CommandResult | false {
	if (!editor.getBlock(param.blockId)) {
		return false;
	}
	return finishNonVertical(editor, {
		selection: blockSelectionResult([param.blockId]),
	});
}

export function handleBlockSelectionArrow(
	editor: Editor,
	param: CaretMotionParam,
	direction: ArrowDirection,
): CommandResult | false | undefined {
	if (editor.selection?.type !== "block") {
		return undefined;
	}
	const snapshot = buildTransitionSnapshot(editor);
	const next = arrowFromBlockSelection(
		snapshot,
		toTransitionSelection(editor),
		direction,
		param.extend,
	);
	const selection = fromTransitionSelection(next, snapshot.blockOrder);
	if (!selection) {
		return false;
	}
	return { selection };
}

function stepInlineAtom(
	editor: Editor,
	param: CaretMotionParam,
	focus: Point,
	direction: -1 | 1,
): CommandResult | false | undefined {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		return undefined;
	}

	const block = editor.getBlock(focus.blockId);
	if (!block) {
		return undefined;
	}

	if (
		!isCollapsed(selection) &&
		selection.anchor.blockId === focus.blockId &&
		selection.focus.blockId === focus.blockId
	) {
		const start = Math.min(selection.anchor.offset, selection.focus.offset);
		const end = Math.max(selection.anchor.offset, selection.focus.offset);
		const selectedAtom = getAtomRangeAtOffset(block, start);
		if (
			selectedAtom &&
			selectedAtom.start === start &&
			selectedAtom.end === end
		) {
			const offset = direction === 1 ? end : start;
			return {
				selection: extendSelection(editor, param.extend, {
					blockId: focus.blockId,
					offset,
				}),
			};
		}
		return undefined;
	}

	const probeOffset = direction === 1 ? focus.offset : focus.offset - 1;
	if (probeOffset < 0) {
		return undefined;
	}
	const atom = getAtomRangeAtOffset(block, probeOffset);
	if (!atom) {
		return undefined;
	}
	if (direction === 1 && atom.start !== focus.offset) {
		return undefined;
	}
	if (direction === -1 && atom.end !== focus.offset) {
		return undefined;
	}
	return {
		selection: textSelectionResult(
			param.extend
				? (readTextAnchor(editor) ?? {
						blockId: focus.blockId,
						offset: atom.start,
					})
				: {
						blockId: focus.blockId,
						offset: atom.start,
					},
			{ blockId: focus.blockId, offset: atom.end },
		),
	};
}

function resolveStep(
	editor: Editor,
	focus: Point,
	stepped: NextNormalPositionResult,
	direction: -1 | 1,
): Point | SelectionState | null {
	if (!stepped) {
		return null;
	}
	if ("blockId" in stepped) {
		return stepped;
	}
	return crossBlock(
		editor,
		focus.blockId,
		direction === 1 ? "next" : "previous",
	);
}

export function crossBlock(
	editor: Editor,
	blockId: string,
	direction: "previous" | "next",
): Point | SelectionState | null {
	const adjacentId = getAdjacentVisibleBlockId(editor, blockId, direction);
	if (!adjacentId) {
		return null;
	}
	if (!isEditableTextBlock(editor, adjacentId)) {
		return blockSelectionResult([adjacentId]);
	}
	const adjacent = editor.getBlock(adjacentId);
	if (!adjacent) {
		return null;
	}
	return {
		blockId: adjacent.id,
		offset: direction === "previous" ? adjacent.length() : 0,
	};
}

function documentEdgePoint(
	editor: Editor,
	edge: "start" | "end",
):
	| { type: "text"; point: Point }
	| { type: "block"; selection: SelectionState }
	| null {
	// D6: nested children are absent from blockOrder (RI6). Cmd+Down in a
	// document whose last top-level block is an opened container must land
	// in that container's last visible child, not on the container itself.
	const order = getVisibleBlockIds(editor);
	if (order.length === 0) {
		return null;
	}
	const blockId = edge === "start" ? order[0] : order[order.length - 1];
	if (!blockId) {
		return null;
	}
	if (!isEditableTextBlock(editor, blockId)) {
		return { type: "block", selection: blockSelectionResult([blockId]) };
	}
	const block = editor.getBlock(blockId);
	if (!block) {
		return null;
	}
	return {
		type: "text",
		point: {
			blockId,
			offset: edge === "start" ? 0 : block.length(),
		},
	};
}

export function extendSelection(
	editor: Editor,
	extend: boolean,
	next: Point | SelectionState,
): SelectionState {
	if (!isPoint(next)) {
		return next;
	}
	if (!extend) {
		return collapsedAt(next.blockId, next.offset);
	}
	const anchor = readTextAnchor(editor);
	if (!anchor) {
		return collapsedAt(next.blockId, next.offset);
	}
	return textSelectionResult(anchor, next, {
		blockOrder: editor.documentState.blockOrder,
	});
}

function isPoint(value: Point | SelectionState): value is Point {
	return value !== null && "offset" in value && !("type" in value);
}
