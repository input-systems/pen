import { describe, expect, it } from "vitest";

import {
	createEditor,
	normalizePendingBlocksForImport,
	reportPendingBlockImportViolations,
} from "../index";
import { blocksToOps, inlineContentToOps } from "../importerUtils";
import type { DocumentOp } from "@input/pen-types";
import type { PendingBlock } from "../importerUtils";
import { defaultSchema } from "./fixtures/testSchema";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

type InsertBlockOp = Extract<DocumentOp, { type: "insert-block" }>;
type InsertTableCellTextOp = Extract<DocumentOp, { type: "splice-text" }>;
type InsertTableRowOp = Extract<DocumentOp, { type: "grid" }>;
type InsertTableColumnOp = Extract<DocumentOp, { type: "grid" }>;
type FormatTableCellTextOp = Extract<DocumentOp, { type: "format-text" }>;

describe("blocksToOps table materialization", () => {
	it("materializes __table_row / __table_cell into table ops", () => {
		const blocks: PendingBlock[] = [
			{
				type: "table",
				props: { hasHeaderRow: true },
				children: [
					{
						type: "__table_row",
						props: { _rowIndex: 0 },
						children: [
							{
								type: "__table_cell",
								props: { _rowIndex: 0, _colIndex: 0 },
								content: "Name",
								marks: [],
							},
							{
								type: "__table_cell",
								props: { _rowIndex: 0, _colIndex: 1 },
								content: "Age",
								marks: [],
							},
						],
					},
					{
						type: "__table_row",
						props: { _rowIndex: 1 },
						children: [
							{
								type: "__table_cell",
								props: { _rowIndex: 1, _colIndex: 0 },
								content: "Alice",
								marks: [],
							},
							{
								type: "__table_cell",
								props: { _rowIndex: 1, _colIndex: 1 },
								content: "30",
								marks: [],
							},
						],
					},
				],
			},
		];

		const ops = blocksToOps(blocks);

		const insertBlock = ops[0] as InsertBlockOp;
		expect(insertBlock.type).toBe("insert-block");
		expect(insertBlock.blockType).toBe("table");

		const tableBlockId = insertBlock.blockId;

		const cellTextOps = ops.filter(
			(op) => op.type === "splice-text" && op.cell,
		);
		expect(cellTextOps.length).toBe(4);

		const firstCellText = cellTextOps[0] as InsertTableCellTextOp;
		expect(firstCellText.blockId).toBe(tableBlockId);
		expect(firstCellText.cell).toEqual({ row: 0, col: 0 });
		expect(firstCellText.insert).toBe("Name");

		const lastCellText = cellTextOps[3] as InsertTableCellTextOp;
		expect(lastCellText.cell).toEqual({ row: 1, col: 1 });
		expect(lastCellText.insert).toBe("30");
	});

	it("generates insert-table-row for rows beyond the seed", () => {
		const blocks: PendingBlock[] = [
			{
				type: "table",
				props: {},
				children: [
					{
						type: "__table_row",
						props: {},
						children: [
							{
								type: "__table_cell",
								props: {},
								content: "A",
							},
						],
					},
					{
						type: "__table_row",
						props: {},
						children: [
							{
								type: "__table_cell",
								props: {},
								content: "B",
							},
						],
					},
					{
						type: "__table_row",
						props: {},
						children: [
							{
								type: "__table_cell",
								props: {},
								content: "C",
							},
						],
					},
				],
			},
		];

		const ops = blocksToOps(blocks);
		const rowOps = ops.filter(
			(op) => op.type === "grid" && op.change.kind === "insert-row",
		);
		expect(rowOps.length).toBe(1);
		const rowChange = (rowOps[0] as InsertTableRowOp).change;
		expect(rowChange.kind).toBe("insert-row");
		if (rowChange.kind === "insert-row") {
			expect(rowChange.index).toBe(2);
		}
	});

	it("generates insert-table-column for columns beyond the seed", () => {
		const blocks: PendingBlock[] = [
			{
				type: "table",
				props: {},
				children: [
					{
						type: "__table_row",
						props: {},
						children: [
							{ type: "__table_cell", props: {}, content: "A" },
							{ type: "__table_cell", props: {}, content: "B" },
							{ type: "__table_cell", props: {}, content: "C" },
						],
					},
				],
			},
		];

		const ops = blocksToOps(blocks);
		const colOps = ops.filter(
			(op) => op.type === "grid" && op.change.kind === "insert-column",
		);
		expect(colOps.length).toBe(1);
		const colChange = (colOps[0] as InsertTableColumnOp).change;
		expect(colChange.kind).toBe("insert-column");
		if (colChange.kind === "insert-column") {
			expect(colChange.index).toBe(2);
		}
	});

	it("generates format-table-cell-text for marks on cells", () => {
		const blocks: PendingBlock[] = [
			{
				type: "table",
				props: {},
				children: [
					{
						type: "__table_row",
						props: {},
						children: [
							{
								type: "__table_cell",
								props: {},
								content: "bold text",
								marks: [{ type: "bold", start: 0, end: 4 }],
							},
						],
					},
				],
			},
		];

		const ops = blocksToOps(blocks);
		const fmtOps = ops.filter((op) => op.type === "format-text" && op.cell);
		expect(fmtOps.length).toBe(1);
		const formatOp = fmtOps[0] as FormatTableCellTextOp;
		expect(formatOp.marks).toEqual({ bold: true });
		expect(formatOp.from).toBe(0);
		expect(formatOp.to).toBe(4);
	});

	it("does not recurse __table children as regular blocks", () => {
		const blocks: PendingBlock[] = [
			{
				type: "table",
				props: {},
				children: [
					{
						type: "__table_row",
						props: {},
						children: [
							{ type: "__table_cell", props: {}, content: "ok" },
						],
					},
				],
			},
		];

		const ops = blocksToOps(blocks);
		const blockOps = ops.filter((op) => op.type === "insert-block");
		expect(blockOps.length).toBe(1);
		expect((blockOps[0] as InsertBlockOp).blockType).toBe("table");
	});

	it("shrinks seeded tables to 1x1 during import materialization", () => {
		const blocks: PendingBlock[] = [
			{
				type: "table",
				props: {},
				children: [
					{
						type: "__table_row",
						props: {},
						children: [
							{
								type: "__table_cell",
								props: {},
								content: "Only",
							},
						],
					},
				],
			},
		];

		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});

		editor.apply(blocksToOps(blocks));

		const imported = editor.lastBlock()!;
		expect(imported.type).toBe("table");
		expect(imported.as("table")!.tableRowCount()).toBe(1);
		expect(imported.as("table")!.tableColumnCount()).toBe(1);
		expect(imported.as("table")!.tableCell(0, 0)?.textContent()).toBe(
			"Only",
		);

		editor.destroy();
	});

	it("shrinks seeded tables to a single column during import materialization", () => {
		const blocks: PendingBlock[] = [
			{
				type: "table",
				props: {},
				children: [
					{
						type: "__table_row",
						props: {},
						children: [
							{ type: "__table_cell", props: {}, content: "A" },
						],
					},
					{
						type: "__table_row",
						props: {},
						children: [
							{ type: "__table_cell", props: {}, content: "B" },
						],
					},
					{
						type: "__table_row",
						props: {},
						children: [
							{ type: "__table_cell", props: {}, content: "C" },
						],
					},
				],
			},
		];

		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});

		editor.apply(blocksToOps(blocks));

		const imported = editor.lastBlock()!;
		expect(imported.as("table")!.tableRowCount()).toBe(3);
		expect(imported.as("table")!.tableColumnCount()).toBe(1);
		expect(imported.as("table")!.tableCell(2, 0)?.textContent()).toBe("C");

		editor.destroy();
	});

	it("expands columns to fit ragged rows beyond the first row", () => {
		const blocks: PendingBlock[] = [
			{
				type: "table",
				props: {},
				children: [
					{
						type: "__table_row",
						props: {},
						children: [
							{ type: "__table_cell", props: {}, content: "A" },
						],
					},
					{
						type: "__table_row",
						props: {},
						children: [
							{ type: "__table_cell", props: {}, content: "B1" },
							{ type: "__table_cell", props: {}, content: "B2" },
							{ type: "__table_cell", props: {}, content: "B3" },
						],
					},
				],
			},
		];

		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});

		editor.apply(blocksToOps(blocks));

		const imported = editor.lastBlock()!;
		expect(imported.as("table")!.tableRowCount()).toBe(2);
		expect(imported.as("table")!.tableColumnCount()).toBe(3);
		expect(imported.as("table")!.tableCell(1, 2)?.textContent()).toBe("B3");

		editor.destroy();
	});

	it("DUR3: passthrough resolve keeps schema-unknown pending blocks at the import filter", () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});
		const normalized = normalizePendingBlocksForImport(
			[
				{ type: "customWidget", props: {}, content: "Ignored" },
				{ type: "heading", props: { level: 2 }, content: "Allowed" },
			],
			editor.documentProfile,
			editor.schema,
		);

		expect(normalized.blocks.map((block) => block.type)).toEqual([
			"customWidget",
			"heading",
		]);
		expect(normalized.violations).toEqual([]);
		expect(editor.schema.resolve("customWidget")?.type).toBe(
			"customWidget",
		);

		editor.destroy();
	});

	it("emits a diagnostic when import normalization drops unknown block types", () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});
		const diagnostics: unknown[] = [];

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		reportPendingBlockImportViolations(
			editor,
			[
				{
					blockType: "customWidget",
					documentProfile: editor.documentProfile,
					capability: null,
					reason: "unknown-block-type",
				},
			],
			"import-test:parse",
		);

		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_IMPORT_001",
				level: "warn",
				source: "import-normalization",
				surface: "import-test:parse",
				documentProfile: "structured",
				droppedBlockTypes: ["customWidget"],
			}),
		);

		editor.destroy();
	});
});

describe("inlineContentToOps", () => {
	it("writes pending content and marks into an existing block at an offset", () => {
		expect(
			inlineContentToOps(
				{
					type: "paragraph",
					props: {},
					content: "big",
					marks: [{ type: "bold", start: 0, end: 3 }],
				},
				"target",
				6,
			),
		).toEqual([
			{
				type: "splice-text",
				blockId: "target",
				from: 6,
				to: 6,
				insert: "big",
			},
			{
				type: "format-text",
				blockId: "target",
				from: 6,
				to: 9,
				marks: { bold: true },
			},
		]);
	});

	it("writes pending segments, counting an inline node as one unit", () => {
		expect(
			inlineContentToOps(
				{
					type: "paragraph",
					props: {},
					segments: [
						{
							type: "text",
							text: "hi",
							attributes: { italic: true },
						},
						{
							type: "node",
							nodeType: "mention",
							props: { id: "m" },
						},
						{ type: "text", text: "!" },
					],
				},
				"target",
				2,
			),
		).toEqual([
			{
				type: "splice-text",
				blockId: "target",
				from: 2,
				to: 2,
				insert: "hi",
			},
			{
				type: "format-text",
				blockId: "target",
				from: 2,
				to: 4,
				marks: { italic: true },
			},
			{
				type: "splice-text",
				blockId: "target",
				from: 4,
				to: 4,
				insert: { nodeType: "mention", props: { id: "m" } },
			},
			{
				type: "splice-text",
				blockId: "target",
				from: 5,
				to: 5,
				insert: "!",
			},
		]);
	});
});
