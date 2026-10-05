import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { CellSelection, Editor } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";
import { handleFieldEditorKeyDown } from "../keyHandling";
import { keyEvent, spyDispatch } from "./fieldEditorFixtures.testHelpers";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

const CELL = { blockId: "t", row: 0, col: 0 };

const CELL_YTEXT = {
	length: 4,
	toString: () => "cell",
	toDelta: () => [{ insert: "cell" }],
	insert: () => {},
	delete: () => {},
};

/** Table `t` whose cell (0, 0) holds "cell", edited through a cell controller. */
function editedCell(selection: CellSelection | null) {
	const editor = createEditor({ schema: defaultSchema });
	editors.push(editor);
	editor.apply(
		[
			{ type: "insert-block", blockId: "t", blockType: "table", props: {}, position: "last" },
			{ type: "splice-text", blockId: "t", cell: { row: 0, col: 0 }, from: 0, to: 0, insert: "cell" },
		],
		{ origin: "user" },
	);
	if (selection) editor.setSelection(selection);
	else editor.selectCell("t", 0, 0);
	const diagnostics: Array<{ code: string }> = [];
	editor.on("diagnostic", (event) => {
		diagnostics.push(event as { code: string });
	});
	const fieldEditor = {
		focusBlockId: "t",
		inputMode: "table" as const,
		activeCellCoord: CELL,
		activateCell: () => {},
		activateTextSelection: () => {},
		syncCellTextSelection: (cell: typeof CELL, anchor: number, focus: number) => {
			editor.setSelection(
				{
					type: "cell",
					blockId: cell.blockId,
					anchor: { row: cell.row, col: cell.col },
					head: { row: cell.row, col: cell.col },
					text: { anchor, focus },
				},
				{ origin: "keyboard" },
			);
		},
		deactivate: () => {},
		selectAllBehavior: "block-first" as const,
	};
	const press = (event: KeyboardEvent, start: number, end = start) =>
		handleFieldEditorKeyDown({
			event,
			editor,
			fieldEditor,
			ytext: CELL_YTEXT,
			range: { start, end },
		});
	return { editor, diagnostics, press };
}

function cellSelection(anchor: number, focus: number): CellSelection {
	return {
		type: "cell",
		blockId: "t",
		anchor: { row: 0, col: 0 },
		head: { row: 0, col: 0 },
		text: { anchor, focus },
	};
}

describe("handleTableCellKey arrows", () => {
	it("T6: ArrowRight in an edited cell dispatches pen.caretRight, preventDefaults and moves CellSelection.text", () => {
		const { editor, press } = editedCell(cellSelection(1, 1));
		const dispatched = spyDispatch(editor);

		const event = keyEvent("ArrowRight");
		expect(press(event, 1)).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(dispatched).toContain("pen.caretRight");
		expect(editor.selection).toMatchObject({
			type: "cell",
			head: { row: 0, col: 0 },
			text: { anchor: 2, focus: 2 },
		});
	});

	it("T6: a cell with no caret in the record takes the field's range before the motion", () => {
		const { editor, press } = editedCell(null);

		expect(press(keyEvent("ArrowLeft"), 3)).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "cell",
			text: { anchor: 2, focus: 2 },
		});
	});
});

describe("FE6: mark accelerators in an edited cell", () => {
	it("FE6: Mod-b fails closed on keydown and reports cell-capability-unsupported", () => {
		const { diagnostics, press } = editedCell(cellSelection(0, 4));
		const event = keyEvent("b", { metaKey: true });

		expect(press(event, 0, 4)).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "cell-capability-unsupported",
				capability: "marks",
				mark: "bold",
			}),
		]);
	});

	it("FE6: a shifted accelerator is not a mark toggle and passes through", () => {
		const { diagnostics, press } = editedCell(cellSelection(0, 4));
		const event = keyEvent("b", { metaKey: true, shiftKey: true });

		press(event, 0, 4);

		expect(event.defaultPrevented).toBe(false);
		expect(diagnostics).toEqual([]);
	});
});
