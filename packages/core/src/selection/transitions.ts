/**
 * T1–T6 selection type transitions (`spec/rules/selection.md` §7).
 *
 * Pure functions over a fake doc + selection snapshot. Not wired to the
 * manager, commands, or reader.
 */

import type { Point, SelectAllBehavior } from "@input/pen-types";

export type Affinity = "upstream" | "downstream";

export type { Point };

export interface TextSelection {
	readonly type: "text";
	readonly anchor: Point;
	readonly focus: Point;
	readonly affinity: Affinity;
	readonly goalX: number | null;
}

export interface BlockSelection {
	readonly type: "block";
	readonly blockIds: readonly string[];
	readonly head: string;
}

export interface AppSelection {
	readonly type: "app";
	readonly appId: string;
}

export interface CellSelection {
	readonly type: "cell";
	readonly blockId: string;
	readonly anchor: { readonly row: number; readonly col: number };
	readonly head: { readonly row: number; readonly col: number };
}

export type SelectionState =
	| TextSelection
	| BlockSelection
	| AppSelection
	| CellSelection
	| null;

export type TransitionBlockKind = "text" | "structural";

export type TransitionContainerKind = "list" | "layout-cell" | "table";

export type ArrowDirection = "up" | "down" | "left" | "right";

export type CellTransitionInput =
	| {
			readonly source: "pointer";
			readonly cell: { readonly row: number; readonly col: number };
	  }
	| {
			readonly source: "keyboard";
			readonly direction: ArrowDirection;
			readonly extend: boolean;
	  };

/**
 * One block as the T functions see it: `text` blocks hold offsets up to
 * `length`; `structural` blocks are covered whole (pseudo offsets `0..1`).
 */
export interface TransitionBlock {
	readonly id: string;
	readonly kind: TransitionBlockKind;
	readonly length: number;
	readonly parentId: string | null;
	readonly containerId: string | null;
	readonly containerKind: TransitionContainerKind | null;
	readonly grid?: { readonly rows: number; readonly cols: number };
}

/**
 * The document the T functions read: visible blocks in document order, the
 * top-level ids, and the blocks by id. Built by `buildTransitionSnapshot`,
 * optionally scoped to the blocks a transition touches.
 */
export interface TransitionSnapshot {
	readonly blockOrder: readonly string[];
	readonly topLevelIds: readonly string[];
	readonly blocks: Readonly<Record<string, TransitionBlock>>;
}

const DEFAULT_AFFINITY: Affinity = "downstream";

export function escalateSelectAll(
	doc: TransitionSnapshot,
	selection: SelectionState,
	behavior: SelectAllBehavior = "block-first",
): SelectionState {
	if (entersAtContentRung(doc, selection, behavior)) {
		return selectAllContent(doc) ?? topLevelBlockSelection(doc);
	}

	if (selection === null) {
		return topLevelBlockSelection(doc);
	}

	switch (selection.type) {
		case "text":
			return escalateSelectAllFromText(doc, selection);
		case "block":
			return escalateFromBlockSet(doc, selection.blockIds);
		case "cell":
			return escalateFromBlockSet(doc, [selection.blockId]);
		case "app":
			return selection;
		default: {
			const _exhaustive: never = selection;
			return _exhaustive;
		}
	}
}

/**
 * T2: pointer crossing a block boundary stays a text selection.
 * Does not call escalateCoveredTextToBlocks (T3) — no implicit flip.
 *
 * A structural end of a cross-block range covers that block in the drag's
 * direction (pseudo offsets `0..1`, A4), so a delete removes the divider and
 * keeps the text beside it, and a mid-paragraph text end stays where the
 * pointer put it (N2). Within one block the focus is only clamped.
 */
export function convertPointerDrag(
	doc: TransitionSnapshot,
	selection: SelectionState,
	focus: Point,
): SelectionState {
	if (selection === null || selection.type !== "text") {
		return selection;
	}
	if (!doc.blocks[focus.blockId]) {
		return selection;
	}
	const { anchor } = selection;
	if (anchor.blockId === focus.blockId) {
		return textSelection(
			anchor,
			dragEndpoint(doc, focus, null),
			selection.affinity,
		);
	}
	const anchorIndex = doc.blockOrder.indexOf(anchor.blockId);
	const focusIndex = doc.blockOrder.indexOf(focus.blockId);
	const forward =
		anchorIndex < 0 || focusIndex < 0 || anchorIndex <= focusIndex;
	const anchorBlock = doc.blocks[anchor.blockId];
	return textSelection(
		anchorBlock?.kind === "structural"
			? dragEndpoint(doc, anchor, forward ? "start" : "end")
			: anchor,
		dragEndpoint(doc, focus, forward ? "end" : "start"),
		selection.affinity,
	);
}

/**
 * T3: full-coverage multi-block text becomes BlockSelection.
 * Used by escalateSelectAll on rung 2+; never by convertPointerDrag.
 */
function escalateCoveredTextToBlocks(
	doc: TransitionSnapshot,
	selection: SelectionState,
): SelectionState {
	if (selection === null || selection.type !== "text") {
		return selection;
	}
	const covered = coveredBlockIds(doc, selection);
	if (!coversEveryOffsetOfMultipleBlocks(doc, selection, covered)) {
		return selection;
	}
	return makeBlockSelection(covered);
}

export function arrowFromBlockSelection(
	doc: TransitionSnapshot,
	selection: SelectionState,
	direction: ArrowDirection,
	extend: boolean,
): SelectionState {
	if (selection === null || selection.type !== "block") {
		return selection;
	}
	if (selection.blockIds.length === 0) {
		return selection;
	}

	const headIndex = doc.blockOrder.indexOf(selection.head);
	if (headIndex === -1) {
		return selection;
	}

	if (extend) {
		return extendBlockSelection(doc, selection, direction, headIndex);
	}
	return collapseBlockSelection(doc, selection, direction, headIndex);
}

/**
 * T5: a click on a structural block selects it as a BlockSelection with that
 * block as head; a click in a text block is a collapsed caret, clamped.
 *
 * @param doc - The transition snapshot holding `blockId`.
 * @param blockId - The clicked block.
 * @param offset - The clicked offset in a text block.
 * @returns The selection the click forms, or `null` for an unknown block.
 */
export function clickSelectableBlock(
	doc: TransitionSnapshot,
	blockId: string,
	offset = 0,
): SelectionState {
	const block = doc.blocks[blockId];
	if (!block) {
		return null;
	}
	if (block.kind === "structural") {
		return makeBlockSelection([blockId], blockId);
	}
	return collapsedText(blockId, clampOffset(block.length, offset));
}

export function transitionCellSelection(
	doc: TransitionSnapshot,
	selection: SelectionState,
	input: CellTransitionInput,
): SelectionState {
	switch (input.source) {
		case "pointer":
			return pointerCellSelection(doc, selection, input.cell);
		case "keyboard":
			return keyboardCellSelection(
				doc,
				selection,
				input.direction,
				input.extend,
			);
		default: {
			const _exhaustive: never = input;
			return _exhaustive;
		}
	}
}

/**
 * T1 document-first entry: the first press covers all content rather than the
 * active block. Only a text or empty selection enters here. A `block`, `cell`,
 * or `app` selection already sits at or above the content rung, so entering
 * from the content range would walk the ladder backwards.
 */
function entersAtContentRung(
	doc: TransitionSnapshot,
	selection: SelectionState,
	behavior: SelectAllBehavior,
): boolean {
	if (behavior !== "document-first") {
		return false;
	}
	if (selection !== null && selection.type !== "text") {
		return false;
	}
	return !coversAllContent(doc, selection);
}

/**
 * Returns `null` when the content range is empty, so a document of empty blocks
 * falls through to `BlockSelection` instead of writing a collapsed caret that
 * looks like a dropped keystroke.
 */
function selectAllContent(doc: TransitionSnapshot): SelectionState {
	const range = contentRange(doc);
	if (!range || samePoint(range.start, range.end)) {
		return null;
	}
	return textSelection(range.start, range.end, DEFAULT_AFFINITY);
}

function coversAllContent(
	doc: TransitionSnapshot,
	selection: SelectionState,
): boolean {
	if (selection === null || selection.type !== "text") {
		return false;
	}
	const content = contentRange(doc);
	const range = orderedTextRange(doc, selection);
	if (!content || !range) {
		return false;
	}
	return (
		samePoint(content.start, range.start) &&
		samePoint(content.end, range.end)
	);
}

function contentRange(
	doc: TransitionSnapshot,
): { start: Point; end: Point } | null {
	const firstId = doc.blockOrder[0];
	const lastId = doc.blockOrder[doc.blockOrder.length - 1];
	if (!firstId || !lastId) {
		return null;
	}
	const lastBlock = doc.blocks[lastId];
	if (!doc.blocks[firstId] || !lastBlock) {
		return null;
	}
	return {
		start: { blockId: firstId, offset: 0 },
		end: { blockId: lastId, offset: selectableExtent(lastBlock) },
	};
}

/** A structural block has no text domain; 0..1 covers it as a unit (N2). */
function selectableExtent(block: TransitionBlock): number {
	return block.kind === "structural" ? 1 : block.length;
}

function samePoint(left: Point, right: Point): boolean {
	return left.blockId === right.blockId && left.offset === right.offset;
}

function escalateSelectAllFromText(
	doc: TransitionSnapshot,
	selection: TextSelection,
): SelectionState {
	const covered = coveredBlockIds(doc, selection);
	if (covered.length === 0) {
		return selection;
	}

	if (coversEveryOffsetOfMultipleBlocks(doc, selection, covered)) {
		return escalateCoveredTextToBlocks(doc, selection);
	}

	if (isWholeSingleBlockText(doc, selection, covered)) {
		return escalateFromBlockSet(doc, covered);
	}

	const range = orderedTextRange(doc, selection);
	if (!range) {
		return selection;
	}
	const startBlock = doc.blocks[range.start.blockId];
	const endBlock = doc.blocks[range.end.blockId];
	if (!startBlock || !endBlock) {
		return selection;
	}
	return textSelection(
		{ blockId: startBlock.id, offset: 0 },
		{ blockId: endBlock.id, offset: endBlock.length },
		selection.affinity,
	);
}

function escalateFromBlockSet(
	doc: TransitionSnapshot,
	blockIds: readonly string[],
): SelectionState {
	if (blockIds.length === 0) {
		return topLevelBlockSelection(doc);
	}

	const containerSet = sharedContainerSet(doc, blockIds);
	if (containerSet && !sameIdList(blockIds, containerSet)) {
		return makeBlockSelection(containerSet);
	}

	if (!sameIdList(blockIds, doc.topLevelIds)) {
		return topLevelBlockSelection(doc);
	}

	return topLevelBlockSelection(doc);
}

function collapseBlockSelection(
	doc: TransitionSnapshot,
	selection: BlockSelection,
	direction: ArrowDirection,
	headIndex: number,
): SelectionState {
	const forward = isForward(direction);
	if (forward) {
		const nextId = doc.blockOrder[headIndex + 1];
		if (nextId) {
			return caretAtBlockEdge(doc, nextId, "start");
		}
		return caretAtBlockEdge(doc, selection.head, "end");
	}

	const prevId = doc.blockOrder[headIndex - 1];
	if (prevId) {
		return caretAtBlockEdge(doc, prevId, "end");
	}
	return caretAtBlockEdge(doc, selection.head, "start");
}

function extendBlockSelection(
	doc: TransitionSnapshot,
	selection: BlockSelection,
	direction: ArrowDirection,
	headIndex: number,
): SelectionState {
	const selected = new Set(selection.blockIds);
	const firstId = selection.blockIds[0];
	const lastId = selection.blockIds[selection.blockIds.length - 1];
	if (!firstId || !lastId) {
		return selection;
	}

	const forward = isForward(direction);
	const headIsFirst = selection.head === firstId;
	const headIsLast = selection.head === lastId;

	if (forward) {
		if (headIsLast) {
			const nextId = doc.blockOrder[headIndex + 1];
			if (!nextId || selected.has(nextId)) {
				return selection;
			}
			return makeBlockSelection([...selection.blockIds, nextId], nextId);
		}
		if (headIsFirst && selection.blockIds.length > 1) {
			const nextIds = selection.blockIds.slice(1);
			return makeBlockSelection(nextIds, nextIds[0]);
		}
		return selection;
	}

	if (headIsFirst) {
		const prevId = doc.blockOrder[headIndex - 1];
		if (!prevId || selected.has(prevId)) {
			return selection;
		}
		return makeBlockSelection([prevId, ...selection.blockIds], prevId);
	}
	if (headIsLast && selection.blockIds.length > 1) {
		const nextIds = selection.blockIds.slice(0, -1);
		return makeBlockSelection(nextIds, nextIds[nextIds.length - 1]);
	}
	return selection;
}

function pointerCellSelection(
	doc: TransitionSnapshot,
	selection: SelectionState,
	cell: { readonly row: number; readonly col: number },
): SelectionState {
	const tableId =
		selection?.type === "cell"
			? selection.blockId
			: nearestTableBlockId(doc, selection);
	if (!tableId) {
		return selection;
	}
	const grid = doc.blocks[tableId]?.grid;
	if (!grid) {
		return selection;
	}
	const nextHead = clampCell(grid, cell);
	if (selection?.type === "cell" && selection.blockId === tableId) {
		return {
			type: "cell",
			blockId: tableId,
			anchor: selection.anchor,
			head: nextHead,
		};
	}
	return {
		type: "cell",
		blockId: tableId,
		anchor: nextHead,
		head: nextHead,
	};
}

function keyboardCellSelection(
	doc: TransitionSnapshot,
	selection: SelectionState,
	direction: ArrowDirection,
	extend: boolean,
): SelectionState {
	if (selection === null || selection.type !== "cell") {
		return selection;
	}
	const grid = doc.blocks[selection.blockId]?.grid;
	if (!grid) {
		return selection;
	}

	const stepped = stepCell(selection.head, direction);
	if (!inGrid(grid, stepped)) {
		return arrowFromBlockSelection(
			doc,
			makeBlockSelection([selection.blockId], selection.blockId),
			direction,
			false,
		);
	}

	if (extend) {
		return {
			type: "cell",
			blockId: selection.blockId,
			anchor: selection.anchor,
			head: stepped,
		};
	}
	return {
		type: "cell",
		blockId: selection.blockId,
		anchor: stepped,
		head: stepped,
	};
}

function caretAtBlockEdge(
	doc: TransitionSnapshot,
	blockId: string,
	edge: "start" | "end",
): SelectionState {
	const block = doc.blocks[blockId];
	if (!block) {
		return null;
	}
	if (block.kind === "structural") {
		return makeBlockSelection([blockId], blockId);
	}
	const offset = edge === "start" ? 0 : block.length;
	return collapsedText(blockId, offset);
}

function isWholeSingleBlockText(
	doc: TransitionSnapshot,
	selection: TextSelection,
	covered: readonly string[],
): boolean {
	if (covered.length !== 1) {
		return false;
	}
	const block = doc.blocks[covered[0]!];
	if (!block) {
		return false;
	}
	const range = orderedTextRange(doc, selection);
	if (!range) {
		return false;
	}
	return range.start.offset === 0 && range.end.offset === block.length;
}

function coversEveryOffsetOfMultipleBlocks(
	doc: TransitionSnapshot,
	selection: TextSelection,
	covered: readonly string[],
): boolean {
	if (covered.length < 2) {
		return false;
	}
	const range = orderedTextRange(doc, selection);
	if (!range) {
		return false;
	}
	const endBlock = doc.blocks[range.end.blockId];
	if (!endBlock) {
		return false;
	}
	return range.start.offset === 0 && range.end.offset === endBlock.length;
}

function coveredBlockIds(
	doc: TransitionSnapshot,
	selection: TextSelection,
): readonly string[] {
	const startIdx = doc.blockOrder.indexOf(selection.anchor.blockId);
	const endIdx = doc.blockOrder.indexOf(selection.focus.blockId);
	if (startIdx === -1 || endIdx === -1) {
		return [];
	}
	const from = Math.min(startIdx, endIdx);
	const to = Math.max(startIdx, endIdx);
	return doc.blockOrder.slice(from, to + 1);
}

function orderedTextRange(
	doc: TransitionSnapshot,
	selection: TextSelection,
): { start: Point; end: Point } | null {
	const aIdx = doc.blockOrder.indexOf(selection.anchor.blockId);
	const bIdx = doc.blockOrder.indexOf(selection.focus.blockId);
	if (aIdx === -1 || bIdx === -1) {
		return null;
	}
	if (aIdx < bIdx) {
		return { start: selection.anchor, end: selection.focus };
	}
	if (aIdx > bIdx) {
		return { start: selection.focus, end: selection.anchor };
	}
	if (selection.anchor.offset <= selection.focus.offset) {
		return { start: selection.anchor, end: selection.focus };
	}
	return { start: selection.focus, end: selection.anchor };
}

function sharedContainerSet(
	doc: TransitionSnapshot,
	blockIds: readonly string[],
): readonly string[] | null {
	const first = doc.blocks[blockIds[0]!];
	if (!first?.containerId) {
		return null;
	}
	for (const id of blockIds) {
		if (doc.blocks[id]?.containerId !== first.containerId) {
			return null;
		}
	}
	return doc.blockOrder.filter(
		(id) => doc.blocks[id]?.containerId === first.containerId,
	);
}

function nearestTableBlockId(
	doc: TransitionSnapshot,
	selection: SelectionState,
): string | null {
	if (selection === null) {
		return firstTableBlockId(doc);
	}
	switch (selection.type) {
		case "cell":
			return selection.blockId;
		case "text":
			return tableIdForBlock(doc, selection.focus.blockId);
		case "block":
			return tableIdForBlock(doc, selection.head);
		case "app":
			return firstTableBlockId(doc);
		default: {
			const _exhaustive: never = selection;
			return _exhaustive;
		}
	}
}

function tableIdForBlock(
	doc: TransitionSnapshot,
	blockId: string,
): string | null {
	const block = doc.blocks[blockId];
	if (!block) {
		return null;
	}
	if (block.grid) {
		return blockId;
	}
	if (block.containerKind === "table" && block.containerId) {
		return block.containerId;
	}
	if (block.parentId && doc.blocks[block.parentId]?.grid) {
		return block.parentId;
	}
	return firstTableBlockId(doc);
}

function firstTableBlockId(doc: TransitionSnapshot): string | null {
	for (const id of doc.blockOrder) {
		if (doc.blocks[id]?.grid) {
			return id;
		}
	}
	return null;
}

function stepCell(
	cell: { readonly row: number; readonly col: number },
	direction: ArrowDirection,
): { row: number; col: number } {
	switch (direction) {
		case "up":
			return { row: cell.row - 1, col: cell.col };
		case "down":
			return { row: cell.row + 1, col: cell.col };
		case "left":
			return { row: cell.row, col: cell.col - 1 };
		case "right":
			return { row: cell.row, col: cell.col + 1 };
		default: {
			const _exhaustive: never = direction;
			return _exhaustive;
		}
	}
}

function clampCell(
	grid: { readonly rows: number; readonly cols: number },
	cell: { readonly row: number; readonly col: number },
): { row: number; col: number } {
	return {
		row: clampOffset(grid.rows - 1, cell.row),
		col: clampOffset(grid.cols - 1, cell.col),
	};
}

function inGrid(
	grid: { readonly rows: number; readonly cols: number },
	cell: { readonly row: number; readonly col: number },
): boolean {
	return (
		cell.row >= 0 &&
		cell.col >= 0 &&
		cell.row < grid.rows &&
		cell.col < grid.cols
	);
}

/** The pseudo length of a structural block in a text range (A4). */
const STRUCTURAL_COVER_LENGTH = 1;

/**
 * A drag endpoint: a structural block covers to `side` (`null` within one
 * block clamps to the cover), a text block clamps, an unknown block stays.
 * The anchor of a text range is where the gesture started and is not clamped.
 */
function dragEndpoint(
	doc: TransitionSnapshot,
	point: Point,
	side: "start" | "end" | null,
): Point {
	const block = doc.blocks[point.blockId];
	if (!block) {
		return point;
	}
	if (block.kind === "structural") {
		if (side === null) {
			return {
				blockId: point.blockId,
				offset: clampOffset(STRUCTURAL_COVER_LENGTH, point.offset),
			};
		}
		return {
			blockId: point.blockId,
			offset: side === "start" ? 0 : STRUCTURAL_COVER_LENGTH,
		};
	}
	return clampPoint(doc, point) ?? point;
}

function clampPoint(doc: TransitionSnapshot, point: Point): Point | null {
	const block = doc.blocks[point.blockId];
	if (!block) {
		return null;
	}
	return {
		blockId: point.blockId,
		offset: clampOffset(block.length, point.offset),
	};
}

function clampOffset(max: number, offset: number): number {
	if (offset <= 0) {
		return 0;
	}
	if (offset >= max) {
		return max;
	}
	return offset;
}

function isForward(direction: ArrowDirection): boolean {
	return direction === "down" || direction === "right";
}

function topLevelBlockSelection(doc: TransitionSnapshot): SelectionState {
	if (doc.topLevelIds.length === 0) {
		return null;
	}
	return makeBlockSelection(doc.topLevelIds);
}

function makeBlockSelection(
	blockIds: readonly string[],
	head = blockIds[blockIds.length - 1],
): BlockSelection {
	return {
		type: "block",
		blockIds,
		head: head ?? blockIds[0] ?? "",
	};
}

function collapsedText(blockId: string, offset: number): TextSelection {
	const point = { blockId, offset };
	return textSelection(point, point, DEFAULT_AFFINITY);
}

function textSelection(
	anchor: Point,
	focus: Point,
	affinity: Affinity,
): TextSelection {
	return {
		type: "text",
		anchor,
		focus,
		affinity,
		goalX: null,
	};
}

function sameIdList(
	left: readonly string[],
	right: readonly string[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((id, index) => id === right[index]);
}
