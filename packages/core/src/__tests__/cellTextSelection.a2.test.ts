import type { DiagnosticEvent, SelectionRecord } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import {
	caretLeft,
	caretLineEnd,
	caretRight,
	getEditorSelectionRecord,
} from "../index";
import {
	createCommandEditor,
	createCommandHarness,
} from "../commands/__tests__/fixture";

const TABLE_ID = "t";

function createTableEditor(cellText = "alpha") {
	const editor = createCommandEditor([{ id: TABLE_ID, type: "table" }]);
	editor.apply([
		{
			type: "splice-text",
			blockId: TABLE_ID,
			cell: { row: 0, col: 0 },
			from: 0,
			to: 0,
			insert: cellText,
		},
	]);
	return editor;
}

function recordOf(editor: ReturnType<typeof createTableEditor>) {
	return getEditorSelectionRecord(editor)!;
}

function editCell(
	editor: ReturnType<typeof createTableEditor>,
	anchor: number,
	focus = anchor,
): void {
	editor.setSelection({
		type: "cell",
		blockId: TABLE_ID,
		anchor: { row: 0, col: 0 },
		head: { row: 0, col: 0 },
		text: { anchor, focus },
	});
}

describe("CellSelection.text (W3.R18)", () => {
	it("A2: cell selections with different text are not equal", () => {
		const editor = createTableEditor();
		const versions: SelectionRecord[] = [];
		editCell(editor, 1);
		editor.onSelectionChange((record) => versions.push(record));

		editCell(editor, 1);
		expect(versions).toHaveLength(0);

		editCell(editor, 2);
		expect(versions).toHaveLength(1);
		expect(versions[0]?.state).toMatchObject({
			type: "cell",
			text: { anchor: 2, focus: 2 },
		});

		editor.selectCell(TABLE_ID, 0, 0);
		expect(versions).toHaveLength(2);
		expect(editor.selection).not.toHaveProperty("text");
		editor.destroy();
	});

	it("A1: cell text with anchor ≠ head is rejected with a diagnostic", () => {
		const editor = createTableEditor();
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => diagnostics.push(event));
		editCell(editor, 1);
		const before = recordOf(editor);

		editor.setSelection({
			type: "cell",
			blockId: TABLE_ID,
			anchor: { row: 0, col: 0 },
			head: { row: 1, col: 1 },
			text: { anchor: 0, focus: 0 },
		});

		expect(recordOf(editor)).toEqual(before);
		expect(diagnostics.map((event) => event.code)).toContain(
			"selection-invalid-cell-text",
		);
		editor.destroy();
	});

	it("A1: cell text offsets clamp to the cell's logical length", () => {
		const editor = createTableEditor("abc");
		editCell(editor, 99, -4);

		expect(editor.selection).toMatchObject({
			type: "cell",
			text: { anchor: 3, focus: 0 },
		});
		expect(recordOf(editor).state).toMatchObject({
			type: "cell",
			text: { anchor: 3, focus: 0 },
		});
		editor.destroy();
	});

	it("AS1: an in-cell caret survives a remote insert before it in the same cell", () => {
		const editor = createTableEditor("alpha");
		editCell(editor, 3);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: TABLE_ID,
					cell: { row: 0, col: 0 },
					from: 0,
					to: 0,
					insert: "XY",
				},
			],
			{ origin: "collaborator" },
		);

		expect(editor.selection).toMatchObject({
			type: "cell",
			text: { anchor: 5, focus: 5 },
		});
		expect(recordOf(editor).origin).toBe("mapped");
		editor.destroy();
	});

	it("AS2: an insert in another cell leaves the in-cell caret and its version alone", () => {
		const editor = createTableEditor("alpha");
		editCell(editor, 3);
		const version = recordOf(editor).version;

		editor.apply([
			{
				type: "splice-text",
				blockId: TABLE_ID,
				cell: { row: 1, col: 1 },
				from: 0,
				to: 0,
				insert: "elsewhere",
			},
		]);

		expect(recordOf(editor).version).toBe(version);
		expect(editor.selection).toMatchObject({
			text: { anchor: 3, focus: 3 },
		});
		editor.destroy();
	});

	it("AS2: typing at the in-cell caret carries it past the insert", () => {
		const editor = createTableEditor("alpha");
		editCell(editor, 5);

		editor.apply([
			{
				type: "splice-text",
				blockId: TABLE_ID,
				cell: { row: 0, col: 0 },
				from: 5,
				to: 5,
				insert: "!",
			},
		]);

		expect(editor.selection).toMatchObject({
			text: { anchor: 6, focus: 6 },
		});
		editor.destroy();
	});

	it("T6: in-cell ArrowRight writes CellSelection.text", () => {
		const editor = createTableEditor("alpha");
		const registry = createCommandHarness(editor);
		editCell(editor, 2);

		expect(registry.dispatch(caretRight, { extend: false })).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "cell",
			anchor: { row: 0, col: 0 },
			head: { row: 0, col: 0 },
			text: { anchor: 3, focus: 3 },
		});

		expect(registry.dispatch(caretLeft, { extend: true })).toBe(true);
		expect(registry.dispatch(caretLeft, { extend: true })).toBe(true);
		expect(editor.selection).toMatchObject({
			text: { anchor: 3, focus: 1 },
		});

		expect(registry.dispatch(caretLineEnd, { extend: false })).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "cell",
			text: { anchor: 5, focus: 5 },
		});
		editor.destroy();
	});
});

describe("A5: a table props or meta change is not a structure change", () => {
	function editSecondCell(
		editor: ReturnType<typeof createTableEditor>,
	): void {
		editor.apply([
			{
				type: "splice-text",
				blockId: TABLE_ID,
				cell: { row: 0, col: 1 },
				from: 0,
				to: 0,
				insert: "bravo",
			},
		]);
		editor.setSelection({
			type: "cell",
			blockId: TABLE_ID,
			anchor: { row: 0, col: 1 },
			head: { row: 0, col: 1 },
			text: { anchor: 3, focus: 3 },
		});
	}

	it("A5: a collaborator set-props on the table keeps the edited cell and its text", () => {
		const editor = createTableEditor();
		editSecondCell(editor);
		const before = recordOf(editor);

		editor.apply(
			[
				{
					type: "set-props",
					blockId: TABLE_ID,
					props: { hasHeaderRow: false },
				},
			],
			{ origin: "collaborator" },
		);

		expect(editor.getBlock(TABLE_ID)?.props).toMatchObject({
			hasHeaderRow: false,
		});
		expect(recordOf(editor)).toEqual(before);
		editor.destroy();
	});

	it("A5: a set-meta on the table keeps the edited cell and its text", () => {
		const editor = createTableEditor();
		editSecondCell(editor);
		const before = recordOf(editor);

		editor.apply(
			[
				{
					type: "set-meta",
					blockId: TABLE_ID,
					namespace: "review",
					data: { note: "x" },
				},
			],
			{ origin: "collaborator" },
		);

		expect(recordOf(editor)).toEqual(before);
		editor.destroy();
	});

	it("A5: a set-props summary on a table is block-props-changed, not table-changed", () => {
		const editor = createTableEditor();
		const structural: string[] = [];
		editor.on("commit", (event) => {
			for (const change of event.summary.structural) {
				structural.push(change.type);
			}
		});

		editor.apply([
			{
				type: "set-props",
				blockId: TABLE_ID,
				props: { hasHeaderRow: false },
			},
		]);

		expect(structural).toEqual(["block-props-changed"]);
		editor.destroy();
	});

	it("A5: a table structure change resets to a collapsed text selection in the first cell", () => {
		const editor = createTableEditor();
		editSecondCell(editor);

		editor.apply(
			[
				{
					type: "grid",
					blockId: TABLE_ID,
					change: { kind: "insert-row", index: 0 },
				},
			],
			{ origin: "collaborator" },
		);

		expect(editor.selection).toEqual({
			type: "cell",
			blockId: TABLE_ID,
			anchor: { row: 0, col: 0 },
			head: { row: 0, col: 0 },
			text: { anchor: 0, focus: 0 },
		});
		expect(recordOf(editor).origin).toBe("mapped");
		editor.destroy();
	});
});
