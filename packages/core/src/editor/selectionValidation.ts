import type {
	BlockSelection,
	CellSelection,
	CRDTMap,
	PenDocument,
	Point,
	SelectionRecordState,
	SelectionState,
	TextSelection,
} from "@input/pen-types";
import { createTextSelection } from "../selection/helpers";

type CRDTBlockMap = CRDTMap<CRDTMap<unknown>>;

/**
 * Mixed-boundary N2: a text endpoint on a non-text block is still
 * admitted (clamped to 0..1) when the other endpoint sits on a different
 * block. The document-order structural end is expanded to a full 0..1
 * cover so `deleteSelection` removes the divider and keeps the paragraph
 * prefix. A pointer drag that maps the divider to offset 0 must not stay
 * uncovering — that left the divider in place after Backspace.
 * Retargeting the range onto `selectBlock` would delete the entire
 * paragraph — an owner decision, not this clamp.
 *
 * Same-block fully-selected (0..1) divider/table writes are converted
 * to `BlockSelection` in `_validateText`. A collapsed caret on a table
 * stays a text point — autocomplete and similar callers still probe it.
 * `nextNormalPosition` already forbids these positions (N2).
 */
export function clampNonTextPseudoOffset(offset: number): number {
	if (!Number.isFinite(offset)) {
		return 0;
	}
	return Math.max(0, Math.min(offset, 1));
}

/**
 * Expand a mixed text/structural range so the structural end is a full
 * 0..1 cover. Forward `p1@2 → d1@0` becomes `d1@1`; a reversed
 * structural start stays at 0.
 */
function coverMixedBoundaryStructuralOffsets(
	selection: { anchor: Point; focus: Point },
	input: {
		isNonText: (blockId: string) => boolean;
		blockIndex: (blockId: string) => number;
	},
): { anchor: Point; focus: Point } {
	if (selection.anchor.blockId === selection.focus.blockId) {
		return selection;
	}
	const anchorNonText = input.isNonText(selection.anchor.blockId);
	const focusNonText = input.isNonText(selection.focus.blockId);
	if (anchorNonText === focusNonText) {
		return selection;
	}
	const anchorIdx = input.blockIndex(selection.anchor.blockId);
	const focusIdx = input.blockIndex(selection.focus.blockId);
	if (anchorIdx < 0 || focusIdx < 0) {
		return selection;
	}
	const selectingForward = anchorIdx <= focusIdx;
	return {
		anchor: anchorNonText
			? {
					blockId: selection.anchor.blockId,
					offset: selectingForward ? 0 : 1,
				}
			: selection.anchor,
		focus: focusNonText
			? {
					blockId: selection.focus.blockId,
					offset: selectingForward ? 1 : 0,
				}
			: selection.focus,
	};
}

export function selectionEquals(
	left: SelectionState,
	right: SelectionState,
): boolean {
	if (left === right) {
		return true;
	}
	if (left === null || right === null) {
		return false;
	}
	if (left.type !== right.type) {
		return false;
	}
	switch (left.type) {
		case "text": {
			if (right.type !== "text") {
				return false;
			}
			return (
				pointEquals(left.anchor, right.anchor) &&
				pointEquals(left.focus, right.focus) &&
				(left.affinity ?? "downstream") ===
					(right.affinity ?? "downstream")
			);
		}
		case "block": {
			if (right.type !== "block") {
				return false;
			}
			if (left.blockIds.length !== right.blockIds.length) {
				return false;
			}
			if (
				left.blockIds.some((id, index) => id !== right.blockIds[index])
			) {
				return false;
			}
			const leftHead =
				left.head ??
				left.blockIds[left.blockIds.length - 1] ??
				left.blockIds[0] ??
				"";
			const rightHead =
				right.head ??
				right.blockIds[right.blockIds.length - 1] ??
				right.blockIds[0] ??
				"";
			return leftHead === rightHead;
		}
		case "app":
			return right.type === "app" && left.appId === right.appId;
		case "cell": {
			if (right.type !== "cell") {
				return false;
			}
			return (
				left.blockId === right.blockId &&
				left.anchor.row === right.anchor.row &&
				left.anchor.col === right.anchor.col &&
				left.head.row === right.head.row &&
				left.head.col === right.head.col &&
				cellTextEquals(left.text, right.text)
			);
		}
		default: {
			const _exhaustive: never = left;
			return _exhaustive;
		}
	}
}

/** A2: an edited cell's `text` is part of cell equality. */
function cellTextEquals(
	left: CellSelection["text"],
	right: CellSelection["text"],
): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}
	return left.anchor === right.anchor && left.focus === right.focus;
}

/**
 * Snapshot a live selection into the record shape. Identity on the
 * shared fields; fills record-required `affinity` / `goalX` / `head`
 * when the live value omitted them. No computed fields remain to strip.
 */
export function toRecordState(state: SelectionState): SelectionRecordState {
	if (state === null) {
		return null;
	}
	switch (state.type) {
		case "text":
			return {
				type: "text",
				anchor: { ...state.anchor },
				focus: { ...state.focus },
				affinity: state.affinity ?? "downstream",
				goalX: state.goalX ?? null,
			};
		case "block":
			return {
				type: "block",
				blockIds: [...state.blockIds],
				head:
					state.head ??
					state.blockIds[state.blockIds.length - 1] ??
					state.blockIds[0] ??
					"",
			};
		case "app":
			return { type: "app", appId: state.appId };
		case "cell":
			return {
				type: "cell",
				blockId: state.blockId,
				anchor: { ...state.anchor },
				head: { ...state.head },
				...(state.text ? { text: { ...state.text } } : {}),
			};
		default: {
			const _exhaustive: never = state;
			return _exhaustive;
		}
	}
}

export function clampCellCoord(
	coord: { row: number; col: number },
	grid: { rows: number; cols: number },
): { row: number; col: number } {
	return {
		row: clampIndex(coord.row, grid.rows),
		col: clampIndex(coord.col, grid.cols),
	};
}

export function clampOffsetToLength(offset: number, length: number): number {
	if (!Number.isFinite(offset) || offset < 0) {
		return 0;
	}
	return Math.max(0, Math.min(offset, length));
}

export function liveChildIds(
	doc: PenDocument,
	parentId: string | null,
): string[] {
	if (parentId === null) {
		return readIdArray(doc.blockOrder);
	}
	const block = (doc.blocks as CRDTBlockMap).get(parentId);
	return readIdArray(block?.get("children"));
}

export function validateSelection(
	sel: SelectionState,
	host: {
		blockExists(blockId: string): boolean;
		emitMissingBlock(blockId: string): void;
		isNonTextBlock(blockId: string): boolean;
		clampOffset(blockId: string, offset: number): number;
		tableGrid(blockId: string): { rows: number; cols: number } | null;
		cellTextLength(blockId: string, row: number, col: number): number;
		emitInvalidCellText(blockId: string): void;
		doc: PenDocument;
	},
): SelectionState | undefined {
	if (sel === null) {
		return null;
	}
	switch (sel.type) {
		case "text":
			return validateText(sel, host);
		case "block":
			return validateBlock(sel, host);
		case "app":
			return { type: "app", appId: sel.appId };
		case "cell":
			return validateCell(sel, host);
		default: {
			const _exhaustive: never = sel;
			return _exhaustive;
		}
	}
}

function validateText(
	sel: TextSelection,
	host: {
		blockExists(blockId: string): boolean;
		emitMissingBlock(blockId: string): void;
		isNonTextBlock(blockId: string): boolean;
		clampOffset(blockId: string, offset: number): number;
		tableGrid(blockId: string): { rows: number; cols: number } | null;
		doc: PenDocument;
	},
): SelectionState | undefined {
	if (
		!host.blockExists(sel.anchor.blockId) ||
		!host.blockExists(sel.focus.blockId)
	) {
		host.emitMissingBlock(
			host.blockExists(sel.anchor.blockId)
				? sel.focus.blockId
				: sel.anchor.blockId,
		);
		return undefined;
	}
	if (
		sel.anchor.blockId === sel.focus.blockId &&
		host.isNonTextBlock(sel.anchor.blockId) &&
		isFullySelectedNonText(sel)
	) {
		return validateBlock(
			{
				type: "block",
				blockIds: [sel.anchor.blockId],
				head: sel.anchor.blockId,
			},
			host,
		);
	}
	const clamped = {
		anchor: {
			blockId: sel.anchor.blockId,
			offset: host.clampOffset(sel.anchor.blockId, sel.anchor.offset),
		},
		focus: {
			blockId: sel.focus.blockId,
			offset: host.clampOffset(sel.focus.blockId, sel.focus.offset),
		},
	};
	// Read the order only for a mixed text/structural range: a caret move or
	// keystroke must not read the whole document (SCALE2).
	let order: string[] | null = null;
	const covered = coverMixedBoundaryStructuralOffsets(clamped, {
		isNonText: (blockId) => host.isNonTextBlock(blockId),
		blockIndex: (blockId) => (order ??= liveChildIds(host.doc, null)).indexOf(blockId),
	});
	return createTextSelection({
		anchor: covered.anchor,
		focus: covered.focus,
		affinity: sel.affinity,
		goalX: sel.goalX,
	});
}

function validateBlock(
	sel: BlockSelection,
	host: {
		blockExists(blockId: string): boolean;
		emitMissingBlock(blockId: string): void;
	},
): BlockSelection | undefined {
	if (sel.blockIds.length === 0) {
		host.emitMissingBlock("");
		return undefined;
	}
	for (const id of sel.blockIds) {
		if (!host.blockExists(id)) {
			host.emitMissingBlock(id);
			return undefined;
		}
	}
	return {
		type: "block",
		blockIds: [...sel.blockIds],
		head:
			sel.head && sel.blockIds.includes(sel.head)
				? sel.head
				: (sel.blockIds[sel.blockIds.length - 1] ??
					sel.blockIds[0] ??
					""),
	};
}

function validateCell(
	sel: CellSelection,
	host: {
		blockExists(blockId: string): boolean;
		emitMissingBlock(blockId: string): void;
		tableGrid(blockId: string): { rows: number; cols: number } | null;
		cellTextLength(blockId: string, row: number, col: number): number;
		emitInvalidCellText(blockId: string): void;
	},
): CellSelection | undefined {
	if (!host.blockExists(sel.blockId)) {
		host.emitMissingBlock(sel.blockId);
		return undefined;
	}
	// A1: `text` addresses one cell, so it needs a single-cell selection.
	if (
		sel.text &&
		(sel.anchor.row !== sel.head.row || sel.anchor.col !== sel.head.col)
	) {
		host.emitInvalidCellText(sel.blockId);
		return undefined;
	}
	const grid = host.tableGrid(sel.blockId);
	const anchor = grid ? clampCellCoord(sel.anchor, grid) : { ...sel.anchor };
	const head = grid ? clampCellCoord(sel.head, grid) : { ...sel.head };
	const length = sel.text
		? host.cellTextLength(sel.blockId, head.row, head.col)
		: 0;
	return {
		type: "cell",
		blockId: sel.blockId,
		anchor,
		head,
		...(sel.rowIds ? { rowIds: [...sel.rowIds] } : {}),
		...(sel.columnIds ? { columnIds: [...sel.columnIds] } : {}),
		...(sel.text
			? {
					text: {
						anchor: clampOffsetToLength(sel.text.anchor, length),
						focus: clampOffsetToLength(sel.text.focus, length),
					},
				}
			: {}),
	};
}

/** v1 non-text span is 0..1; only that full cover is safe to escalate. */
function isFullySelectedNonText(sel: TextSelection): boolean {
	const from = Math.min(sel.anchor.offset, sel.focus.offset);
	const to = Math.max(sel.anchor.offset, sel.focus.offset);
	return from <= 0 && to >= 1;
}

function pointEquals(left: Point, right: Point): boolean {
	return left.blockId === right.blockId && left.offset === right.offset;
}

function clampIndex(value: number, length: number): number {
	if (!Number.isFinite(value) || length <= 0) {
		return 0;
	}
	return Math.max(0, Math.min(Math.trunc(value), length - 1));
}

function readIdArray(value: unknown): string[] {
	if (
		value == null ||
		typeof (value as { length?: unknown }).length !== "number" ||
		typeof (value as { get?: unknown }).get !== "function"
	) {
		return [];
	}
	const arr = value as { length: number; get: (index: number) => unknown };
	const ids: string[] = [];
	for (let i = 0; i < arr.length; i++) {
		const id = arr.get(i);
		if (typeof id === "string") {
			ids.push(id);
		}
	}
	return ids;
}
