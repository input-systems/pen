import type {
	Anchor,
	Assoc,
	BlockSelection,
	CellSelection,
	ChangeSummary,
	PenDocument,
	Point,
	SelectionState,
	TextSelection,
} from "@input/pen-types";
import { mapOffsetThroughSplices } from "../changes/mapOffsetThroughSplices";
import { createTextSelection } from "../selection/helpers";
import type { EditorAnchorsImpl } from "./anchors";
import {
	clampCellCoord,
	clampOffsetToLength,
	liveChildIds,
	selectionEquals,
} from "./selectionValidation";

export function mapSelectionState(
	state: SelectionState,
	summary: ChangeSummary,
	host: {
		blockExists(blockId: string): boolean;
		logicalLength(blockId: string): number;
		tableGrid(blockId: string): { rows: number; cols: number } | null;
		doc: PenDocument;
	},
): SelectionState | undefined {
	if (state === null) {
		return undefined;
	}
	switch (state.type) {
		case "text":
			return mapText(state, summary, host);
		case "block":
			return mapBlock(state, summary, host);
		case "cell":
			return mapCell(state, summary, host);
		case "app":
			return undefined;
		default: {
			const _exhaustive: never = state;
			return _exhaustive;
		}
	}
}

/**
 * AS1: anchors for an accepted text selection's endpoints, and for an
 * edited cell's `text` endpoints as cell-text targets (AN10).
 */
export function mintSelectionAnchors(
	state: SelectionState,
	anchors: EditorAnchorsImpl,
	isNonTextBlock: (blockId: string) => boolean,
): { from: Anchor | null; to: Anchor | null } {
	if (state?.type === "cell" && state.text) {
		const cell = { row: state.head.row, col: state.head.col };
		const collapsed = state.text.anchor === state.text.focus;
		return {
			from: anchors.create(
				{ blockId: state.blockId, offset: state.text.anchor, cell },
				collapsed ? 1 : -1,
			),
			to: anchors.create(
				{ blockId: state.blockId, offset: state.text.focus, cell },
				1,
			),
		};
	}
	if (!state || state.type !== "text") {
		return { from: null, to: null };
	}
	if (
		isNonTextBlock(state.anchor.blockId) ||
		isNonTextBlock(state.focus.blockId)
	) {
		return { from: null, to: null };
	}
	const collapsed = isCollapsedRange(state);
	return {
		from: anchors.create(state.anchor, collapsed ? 1 : -1),
		to: anchors.create(state.focus, 1),
	};
}

/** AS2: the held anchors resolved after repair, in the state's own shape. */
export function resolveHeldSelection(
	state: SelectionState,
	fromAnchor: Anchor | null,
	toAnchor: Anchor | null,
	anchors: EditorAnchorsImpl,
): TextSelection | CellSelection | undefined {
	if (!fromAnchor || !toAnchor) {
		return undefined;
	}
	if (state?.type !== "text" && !(state?.type === "cell" && state.text)) {
		return undefined;
	}
	const from = anchors.resolve(fromAnchor);
	const to = anchors.resolve(toAnchor);
	if (!from || !to) {
		return undefined;
	}
	if (state.type === "cell") {
		return {
			...state,
			text: { anchor: from.offset, focus: to.offset },
		};
	}
	return createTextSelection({
		anchor: from,
		focus: to,
		affinity: state.affinity,
		goalX: state.goalX,
	});
}

/** A table structure change or removal re-addresses a cell selection (A5). */
export function cellStructureChanged(
	state: SelectionState,
	summary: ChangeSummary,
): boolean {
	if (state?.type !== "cell") {
		return false;
	}
	return (
		summary.structural.some(
			(change) =>
				change.type === "table-changed" &&
				change.blockId === state.blockId,
		) || removedBlockIds(summary).has(state.blockId)
	);
}

function mapText(
	state: TextSelection,
	summary: ChangeSummary,
	host: {
		blockExists(blockId: string): boolean;
		logicalLength(blockId: string): number;
		doc: PenDocument;
	},
): SelectionState | undefined {
	const collapsed = isCollapsedRange(state);
	const anchor = fallbackPoint(
		state.anchor,
		summary,
		collapsed ? 1 : -1,
		host,
	);
	const focus = fallbackPoint(state.focus, summary, 1, host);
	if (!anchor || !focus) {
		return null;
	}
	const next = createTextSelection({
		anchor,
		focus,
		affinity: state.affinity,
		goalX: state.goalX,
	});
	if (selectionEquals(state, next)) {
		return undefined;
	}
	return next;
}

function mapBlock(
	state: BlockSelection,
	summary: ChangeSummary,
	host: {
		blockExists(blockId: string): boolean;
		logicalLength(blockId: string): number;
		doc: PenDocument;
	},
): SelectionState | undefined {
	const removed = removedBlockIds(summary);
	const remaining = state.blockIds.filter((id) => !removed.has(id));
	if (remaining.length > 0) {
		const next: BlockSelection = {
			type: "block",
			blockIds: remaining,
			head:
				state.head && remaining.includes(state.head)
					? state.head
					: (remaining[remaining.length - 1] ?? remaining[0] ?? ""),
		};
		if (selectionEquals(state, next)) {
			return undefined;
		}
		return next;
	}

	const firstDeleted = state.blockIds[0];
	if (!firstDeleted) {
		return null;
	}
	const point = fallbackForRemovedBlock(firstDeleted, summary, host);
	if (!point) {
		return null;
	}
	return createTextSelection({
		anchor: point,
		focus: point,
	});
}

function mapCell(
	state: CellSelection,
	summary: ChangeSummary,
	host: {
		blockExists(blockId: string): boolean;
		logicalLength(blockId: string): number;
		tableGrid(blockId: string): { rows: number; cols: number } | null;
		doc: PenDocument;
	},
): SelectionState | undefined {
	const tableChanged = summary.structural.some(
		(change) =>
			change.type === "table-changed" && change.blockId === state.blockId,
	);
	if (tableChanged) {
		return {
			type: "cell",
			blockId: state.blockId,
			anchor: { row: 0, col: 0 },
			head: { row: 0, col: 0 },
		};
	}

	if (removedBlockIds(summary).has(state.blockId)) {
		const point = fallbackForRemovedBlock(state.blockId, summary, host);
		if (!point) {
			return null;
		}
		return createTextSelection({
			anchor: point,
			focus: point,
		});
	}

	const grid = host.tableGrid(state.blockId);
	if (!grid) {
		return undefined;
	}
	const head = clampCellCoord(state.head, grid);
	// An edited cell that the clamp moved is not the cell `text` addresses.
	const keepText =
		state.text !== undefined &&
		head.row === state.head.row &&
		head.col === state.head.col;
	const next: CellSelection = {
		type: "cell",
		blockId: state.blockId,
		anchor: clampCellCoord(state.anchor, grid),
		head,
		...(state.rowIds ? { rowIds: [...state.rowIds] } : {}),
		...(state.columnIds ? { columnIds: [...state.columnIds] } : {}),
		...(keepText && state.text ? { text: { ...state.text } } : {}),
	};
	if (selectionEquals(state, next)) {
		return undefined;
	}
	return next;
}

function fallbackPoint(
	original: Point,
	summary: ChangeSummary,
	assoc: Assoc,
	host: {
		blockExists(blockId: string): boolean;
		logicalLength(blockId: string): number;
		doc: PenDocument;
	},
): Point | null {
	const addressed = readdressThroughStructural(
		original,
		summary.structural,
		assoc,
	);
	if (!host.blockExists(addressed.blockId)) {
		return fallbackForRemovedBlock(original.blockId, summary, host);
	}
	if (addressed.blockId !== original.blockId) {
		return {
			blockId: addressed.blockId,
			offset: clampOffsetToLength(
				addressed.offset,
				host.logicalLength(addressed.blockId),
			),
		};
	}
	const textChange = summary.blockText.find(
		(change) => change.blockId === addressed.blockId,
	);
	const offset =
		textChange && textChange.splices.length > 0
			? mapOffsetThroughSplices(textChange.splices, addressed.offset, assoc)
			: addressed.offset;
	return {
		blockId: addressed.blockId,
		offset: clampOffsetToLength(
			offset,
			host.logicalLength(addressed.blockId),
		),
	};
}

function fallbackForRemovedBlock(
	blockId: string,
	summary: ChangeSummary,
	host: {
		blockExists(blockId: string): boolean;
		logicalLength(blockId: string): number;
		doc: PenDocument;
	},
): Point | null {
	for (const change of summary.structural) {
		if (
			change.type === "blocks-merged" &&
			change.sourceBlockId === blockId
		) {
			if (!host.blockExists(change.targetBlockId)) {
				break;
			}
			return {
				blockId: change.targetBlockId,
				offset: clampOffsetToLength(
					change.joinOffset,
					host.logicalLength(change.targetBlockId),
				),
			};
		}
	}
	const removed = summary.structural.find(
		(change) =>
			change.type === "block-removed" && change.blockId === blockId,
	);
	if (removed && removed.type === "block-removed") {
		const siblings = liveChildIds(host.doc, removed.parentId);
		const nextId = siblings[removed.index];
		if (nextId && host.blockExists(nextId)) {
			return { blockId: nextId, offset: 0 };
		}
		const previousId = siblings[removed.index - 1];
		if (previousId && host.blockExists(previousId)) {
			return {
				blockId: previousId,
				offset: host.logicalLength(previousId),
			};
		}
		if (removed.parentId && host.blockExists(removed.parentId)) {
			return { blockId: removed.parentId, offset: 0 };
		}
	}
	const first = liveChildIds(host.doc, null)[0];
	if (first && host.blockExists(first)) {
		return { blockId: first, offset: 0 };
	}
	return null;
}

function isCollapsedRange(range: { anchor: Point; focus: Point }): boolean {
	return (
		range.anchor.blockId === range.focus.blockId &&
		range.anchor.offset === range.focus.offset
	);
}

function readdressThroughStructural(
	point: Point,
	structural: ChangeSummary["structural"],
	assoc: Assoc,
): Point {
	let current = point;
	for (const change of structural) {
		if (
			change.type === "blocks-merged" &&
			current.blockId === change.sourceBlockId
		) {
			current = {
				blockId: change.targetBlockId,
				offset: change.joinOffset + current.offset,
			};
			continue;
		}
		if (
			change.type === "block-split" &&
			current.blockId === change.blockId
		) {
			if (current.offset > change.offset) {
				current = {
					blockId: change.newBlockId,
					offset: current.offset - change.offset,
				};
			} else if (current.offset === change.offset && assoc === 1) {
				current = { blockId: change.newBlockId, offset: 0 };
			}
		}
	}
	return current;
}

function removedBlockIds(summary: ChangeSummary): Set<string> {
	const removed = new Set<string>();
	for (const change of summary.structural) {
		if (change.type === "block-removed") {
			removed.add(change.blockId);
		}
		if (change.type === "blocks-merged") {
			removed.add(change.sourceBlockId);
		}
	}
	for (const change of summary.structural) {
		if (change.type === "block-inserted") {
			removed.delete(change.blockId);
		}
		if (change.type === "block-split") {
			removed.delete(change.newBlockId);
		}
	}
	return removed;
}
