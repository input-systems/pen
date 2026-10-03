import { describe, expect, it } from "vitest";
import {
	resolveEditedCellText,
	resolveLiveTextSelection,
} from "../selectionReader";

const BLOCK_ID = "table-1";
const ACTIVE = { row: 0, col: 0 } as const;

function editedCell(row: number, col: number, blockId = BLOCK_ID) {
	return {
		type: "cell" as const,
		blockId,
		anchor: { row, col },
		head: { row, col },
		text: { anchor: 1, focus: 2 },
	};
}

describe("resolveEditedCellText (W3.R18)", () => {
	it("FE6: restores the record's CellSelection.text when it names the active cell", () => {
		expect(
			resolveEditedCellText(editedCell(0, 0), BLOCK_ID, ACTIVE),
		).toEqual({ anchor: 1, focus: 2 });
	});

	it("FE6: returns null when the record edits a different cell or table", () => {
		expect(
			resolveEditedCellText(editedCell(1, 0), BLOCK_ID, ACTIVE),
		).toBeNull();
		expect(
			resolveEditedCellText(editedCell(0, 0, "other"), BLOCK_ID, ACTIVE),
		).toBeNull();
	});

	it("FE6: a grid cell selection or a block-level text caret is not addressable inside a cell", () => {
		expect(
			resolveEditedCellText(
				{
					type: "cell",
					blockId: BLOCK_ID,
					head: ACTIVE,
				},
				BLOCK_ID,
				ACTIVE,
			),
		).toBeNull();
		expect(
			resolveEditedCellText(
				{
					type: "text",
					anchor: { blockId: BLOCK_ID, offset: 0 },
					focus: { blockId: BLOCK_ID, offset: 0 },
				},
				BLOCK_ID,
				ACTIVE,
			),
		).toBeNull();
	});
});

const LIVE_BLOCK_ID = "block-1";

describe("resolveLiveTextSelection", () => {
	it("accepts a same-block text selection when no cell is active", () => {
		expect(
			resolveLiveTextSelection(
				{
					type: "text",
					anchor: { blockId: LIVE_BLOCK_ID, offset: 0 },
					focus: { blockId: LIVE_BLOCK_ID, offset: 30 },
				},
				LIVE_BLOCK_ID,
				null,
			),
		).toEqual({
			type: "text",
			anchor: { blockId: LIVE_BLOCK_ID, offset: 0 },
			focus: { blockId: LIVE_BLOCK_ID, offset: 30 },
		});
	});

	it("rejects a selection that ends in another block", () => {
		expect(
			resolveLiveTextSelection(
				{
					type: "text",
					anchor: { blockId: LIVE_BLOCK_ID, offset: 0 },
					focus: { blockId: "block-2", offset: 2 },
				},
				LIVE_BLOCK_ID,
				null,
			),
		).toBeNull();
	});

	it("rejects a non-text selection", () => {
		expect(
			resolveLiveTextSelection({ type: "block" }, LIVE_BLOCK_ID, null),
		).toBeNull();
	});

	it("rejects a block-level selection while a cell is active", () => {
		expect(
			resolveLiveTextSelection(
				{
					type: "text",
					anchor: { blockId: LIVE_BLOCK_ID, offset: 0 },
					focus: { blockId: LIVE_BLOCK_ID, offset: 0 },
				},
				LIVE_BLOCK_ID,
				{ row: 0, col: 0 },
			),
		).toBeNull();
	});
});
