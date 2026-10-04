import type { DocumentOp } from "@input/pen-types";
import type { ActiveCellCoord } from "./controller";
import type { FieldEditorTextLike } from "./crdt";

export type InlineTextRange = {
	start: number;
	end: number;
};

export type InlineTextDiffOp =
	| { type: "insert"; offset: number; text: string }
	| { type: "delete"; offset: number; length: number };

export type InlineTextSelectionTarget = {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
	cell?: {
		row: number;
		col: number;
	};
};

export function buildInlineTextEditTransaction(options: {
	blockId: string;
	range: InlineTextRange;
	text: string;
	marks?: Record<string, unknown>;
	cellCoord?: ActiveCellCoord | null;
}): {
	ops: DocumentOp[];
	selection: InlineTextSelectionTarget;
} {
	const { blockId, range, text, marks, cellCoord } = options;
	const ops: DocumentOp[] = [];
	const nextOffset = range.start + text.length;

	if (range.end > range.start) {
		ops.push(spliceTextOp(blockId, cellCoord, range.start, range.end));
	}

	if (text.length > 0) {
		ops.push(
			spliceTextOp(blockId, cellCoord, range.start, range.start, {
				text,
				marks: () => marks,
			}),
		);
	}

	return {
		ops,
		selection: {
			blockId,
			anchorOffset: nextOffset,
			focusOffset: nextOffset,
			cell: cellCoord
				? { row: cellCoord.row, col: cellCoord.col }
				: undefined,
		},
	};
}

export function buildInlineTextDiffOps(options: {
	blockId: string;
	diff: readonly InlineTextDiffOp[];
	ytext: FieldEditorTextLike;
	resolveInsertMarks: (
		ytext: FieldEditorTextLike,
		offset: number,
	) => Record<string, unknown | null> | undefined;
	cellCoord?: ActiveCellCoord | null;
}): DocumentOp[] {
	const { blockId, diff, ytext, resolveInsertMarks, cellCoord } = options;
	const ops: DocumentOp[] = [];

	for (const op of diff) {
		ops.push(
			op.type === "delete"
				? spliceTextOp(blockId, cellCoord, op.offset, op.offset + op.length)
				: spliceTextOp(blockId, cellCoord, op.offset, op.offset, {
						text: op.text,
						marks: () => resolveInsertMarks(ytext, op.offset),
					}),
		);
	}

	return ops;
}

/**
 * A `splice-text` op in the block or in the active cell. Without `insert` it
 * deletes `from..to`; an insert outside a cell carries the resolved marks
 * (a cell insert takes none).
 */
function spliceTextOp(
	blockId: string,
	cellCoord: ActiveCellCoord | null | undefined,
	from: number,
	to: number,
	insert?: {
		text: string;
		marks: () => Record<string, unknown | null> | undefined;
	},
): DocumentOp {
	const text = insert?.text ?? "";
	if (cellCoord) {
		const cell = { row: cellCoord.row, col: cellCoord.col };
		return { type: "splice-text", blockId, cell, from, to, insert: text };
	}
	if (!insert) {
		return { type: "splice-text", blockId, from, to, insert: text };
	}
	return {
		type: "splice-text",
		blockId,
		from,
		to,
		insert: text,
		marks: insert.marks(),
	};
}
