import { describe, expect, it } from "vitest";

import {
	TestBlockMapLike,
	TestTableContentLike,
	createEditor,
} from "./editorCore.testHelpers";

describe("@input/pen-core table operations: row, column, and cell commands", () => {
	it("insert-block with table type produces seeded 2x2 grid", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		const block = editor.getBlock("t1")!;
		expect(block.type).toBe("table");
		expect(block.as("table")!.tableRowCount()).toBe(2);
		expect(block.as("table")!.tableColumnCount()).toBe(2);

		const cell = block.as("table")!.tableCell(0, 0)!;
		expect(cell).not.toBeNull();
		expect(cell.id).toEqual(expect.any(String));
		expect(cell.textContent()).toBe("");

		editor.destroy();
	});

	it("insert-table-row adds a row matching existing column count", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "insert-row", index: 2 },
			},
		]);

		const block = editor.getBlock("t1")!;
		expect(block.as("table")!.tableRowCount()).toBe(3);
		expect(block.as("table")!.tableColumnCount()).toBe(2);
		expect(block.as("table")!.tableCell(2, 0)).not.toBeNull();
		expect(block.as("table")!.tableCell(2, 1)).not.toBeNull();

		editor.destroy();
	});

	it("repairs table width from the widest row when legacy rows are short", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "insert-column", index: 2 },
			},
		]);

		const blockMap = editor.internals.doc.blocks.get(
			"t1",
		) as TestBlockMapLike;
		const tableContent = blockMap.get(
			"tableContent",
		) as TestTableContentLike;
		const firstRow = tableContent.get(0);
		firstRow.get("cells").delete(2, 1);

		let block = editor.getBlock("t1")!;
		expect(block.as("table")!.tableColumnCount()).toBe(3);

		editor.apply([
			{
				type: "grid",
				blockId: "t1",
				change: {
					kind: "insert-row",
					index: block.as("table")!.tableRowCount(),
				},
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 2 },
				from: 0,
				to: 0,
				insert: "Recovered",
			},
		]);

		block = editor.getBlock("t1")!;
		expect(block.as("table")!.tableRowCount()).toBe(3);
		expect(block.as("table")!.tableCell(0, 2)?.textContent()).toBe(
			"Recovered",
		);
		expect(block.as("table")!.tableCell(2, 0)).not.toBeNull();
		expect(block.as("table")!.tableCell(2, 1)).not.toBeNull();
		expect(block.as("table")!.tableCell(2, 2)).not.toBeNull();

		editor.destroy();
	});

	it("insert-table-column adds a column to all rows", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "insert-column", index: 2 },
			},
		]);

		const block = editor.getBlock("t1")!;
		expect(block.as("table")!.tableRowCount()).toBe(2);
		expect(block.as("table")!.tableColumnCount()).toBe(3);
		expect(block.as("table")!.tableCell(0, 2)).not.toBeNull();
		expect(block.as("table")!.tableCell(1, 2)).not.toBeNull();

		editor.destroy();
	});

	it("delete-table-row removes a row", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "delete-row", index: 0 },
			},
		]);

		expect(editor.getBlock("t1")!.as("table")!.tableRowCount()).toBe(1);

		editor.destroy();
	});

	it("delete-table-column removes a column from all rows", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "delete-column", index: 0 },
			},
		]);

		expect(editor.getBlock("t1")!.as("table")!.tableColumnCount()).toBe(1);

		editor.destroy();
	});

	it("insert-table-cell-text writes text into a specific cell", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 1 },
				from: 0,
				to: 0,
				insert: "Hello",
			},
		]);

		const cell = editor.getBlock("t1")!.as("table")!.tableCell(0, 1)!;
		expect(cell.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("delete-table-cell-text removes text from a specific cell", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 1,
				to: 4,
				insert: "",
			},
		]);

		const cell = editor.getBlock("t1")!.as("table")!.tableCell(0, 0)!;
		expect(cell.textContent()).toBe("Ho");

		editor.destroy();
	});

	it("format-table-cell-text applies formatting to cell text", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "bold text",
			},
			{
				type: "format-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 4,
				marks: { bold: true },
			},
		]);

		const cell = editor.getBlock("t1")!.as("table")!.tableCell(0, 0)!;
		const deltas = cell.textDeltas();
		expect(deltas[0].insert).toBe("bold");
		expect(deltas[0].attributes).toEqual({ bold: true });
		expect(deltas[1].insert).toBe(" text");

		editor.destroy();
	});

	it("convert-block to table seeds tableContent", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "set-props",
				blockId: "b1",
				props: { type: "table", ...{} },
			},
		]);

		const block = editor.getBlock("b1")!;
		expect(block.type).toBe("table");
		expect(block.as("table")!.tableRowCount()).toBe(2);
		expect(block.as("table")!.tableColumnCount()).toBe(2);

		editor.destroy();
	});
});
