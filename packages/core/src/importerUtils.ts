import type { DocumentOp, ImportOptions, Position } from "@input/pen-types";
import { generateId } from "@input/pen-types";

export type { ImportOptions } from "@input/pen-types";

export type PendingInlineSegment =
	| {
			type: "text";
			text: string;
			attributes?: Record<string, unknown>;
	  }
	| {
			type: "node";
			nodeType: string;
			props?: Record<string, unknown>;
	  };

export interface PendingBlock {
	type: string;
	props: Record<string, unknown>;
	content?: string;
	marks?: Array<{
		type: string;
		props?: Record<string, unknown>;
		start: number;
		end: number;
	}>;
	segments?: PendingInlineSegment[];
	children?: PendingBlock[];
}

export function blocksToOps(
	blocks: PendingBlock[],
	options?: ImportOptions,
): DocumentOp[] {
	const ops: DocumentOp[] = [];
	let position: Position = options?.position ?? "last";

	for (const block of blocks) {
		if (block.type.startsWith("__table")) continue;

		const blockId = generateId();

		ops.push({
			type: "insert-block",
			blockId,
			blockType: block.type,
			props: cleanProps(block.props),
			position,
		});

		if (block.type === "table" && block.children) {
			materializeTableChildren(ops, blockId, block.children);
		} else {
			ops.push(...inlineContentToOps(block, blockId));

			if (block.children) {
				for (let i = 0; i < block.children.length; i += 1) {
					const child = block.children[i];
					const childOps = blocksToOps([child], {
						position: { parent: blockId, index: i },
					});
					ops.push(...childOps);
				}
			}
		}

		position = { after: blockId };
	}

	return ops;
}

function materializeTableChildren(
	ops: DocumentOp[],
	blockId: string,
	rows: PendingBlock[],
): void {
	const tableRows = rows.filter((row) => row.type === "__table_row");

	const seedRows = 2;
	const seedCols = 2;
	const desiredRowCount = Math.max(tableRows.length, 1);
	const desiredColCount = Math.max(
		tableRows.reduce((max, row) => {
			const cellCount = (row.children ?? []).filter(
				(cell) => cell.type === "__table_cell",
			).length;
			return Math.max(max, cellCount);
		}, 0),
		1,
	);

	for (let rowIdx = seedRows - 1; rowIdx >= desiredRowCount; rowIdx -= 1) {
		ops.push({
			type: "grid",
			blockId,
			change: { kind: "delete-row", index: rowIdx },
		});
	}

	for (let colIdx = seedCols - 1; colIdx >= desiredColCount; colIdx -= 1) {
		ops.push({
			type: "grid",
			blockId,
			change: { kind: "delete-column", index: colIdx },
		});
	}

	for (let colIdx = seedCols; colIdx < desiredColCount; colIdx += 1) {
		ops.push({
			type: "grid",
			blockId,
			change: { kind: "insert-column", index: colIdx },
		});
	}

	for (let rowIdx = 0; rowIdx < tableRows.length; rowIdx += 1) {
		const row = tableRows[rowIdx];
		const cells = (row.children ?? []).filter(
			(cell) => cell.type === "__table_cell",
		);

		if (rowIdx >= seedRows) {
			ops.push({
				type: "grid",
				blockId,
				change: { kind: "insert-row", index: rowIdx },
			});
		}

		for (let colIdx = 0; colIdx < cells.length; colIdx += 1) {
			const cell = cells[colIdx];
			materializeTableCellContent(ops, blockId, rowIdx, colIdx, cell);
		}
	}
}

/**
 * Writes a pending block's inline content (text, marks, inline nodes) into an
 * existing block, starting at `offset`.
 */
export function inlineContentToOps(
	block: PendingBlock,
	blockId: string,
	offset = 0,
): DocumentOp[] {
	const ops: DocumentOp[] = [];
	if (block.segments && block.segments.length > 0) {
		let at = offset;
		for (const segment of block.segments) {
			if (segment.type === "text") {
				if (segment.text.length === 0) {
					continue;
				}
				ops.push({
					type: "splice-text",
					blockId,
					from: at,
					to: at,
					insert: segment.text,
				});
				if (segment.attributes) {
					ops.push({
						type: "format-text",
						blockId,
						from: at,
						to: at + segment.text.length,
						marks: segment.attributes,
					});
				}
				at += segment.text.length;
				continue;
			}

			ops.push({
				type: "splice-text",
				blockId,
				from: at,
				to: at,
				insert: {
					nodeType: segment.nodeType,
					props: segment.props ?? {},
				},
			});
			at += 1;
		}
		return ops;
	}

	if (!block.content) {
		return ops;
	}

	ops.push({
		type: "splice-text",
		blockId,
		from: offset,
		to: offset,
		insert: block.content,
	});

	for (const mark of block.marks ?? []) {
		if (mark.start >= mark.end) continue;
		ops.push({
			type: "format-text",
			blockId,
			from: offset + mark.start,
			to: offset + mark.end,
			marks: { [mark.type]: mark.props ?? true },
		});
	}
	return ops;
}

function materializeTableCellContent(
	ops: DocumentOp[],
	blockId: string,
	row: number,
	col: number,
	cell: PendingBlock,
): void {
	if (cell.segments && cell.segments.length > 0) {
		let offset = 0;
		for (const segment of cell.segments) {
			if (segment.type === "text") {
				if (segment.text.length === 0) {
					continue;
				}
				ops.push({
					type: "splice-text",
					blockId,
					cell: { row, col },
					from: offset,
					to: offset,
					insert: segment.text,
				});
				if (segment.attributes) {
					ops.push({
						type: "format-text",
						blockId,
						cell: { row, col },
						from: offset,
						to: offset + segment.text.length,
						marks: segment.attributes,
					});
				}
				offset += segment.text.length;
			}
		}
		return;
	}

	if (!cell.content) {
		return;
	}

	ops.push({
		type: "splice-text",
		blockId,
		cell: { row, col },
		from: 0,
		to: 0,
		insert: cell.content,
	});

	for (const mark of cell.marks ?? []) {
		if (mark.start >= mark.end) continue;
		ops.push({
			type: "format-text",
			blockId,
			cell: { row, col },
			from: mark.start,
			to: mark.end,
			marks: { [mark.type]: mark.props ?? true },
		});
	}
}

function cleanProps(props: Record<string, unknown>): Record<string, unknown> {
	const cleaned: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(props)) {
		if (value !== undefined) {
			cleaned[key] = value;
		}
	}
	return cleaned;
}
