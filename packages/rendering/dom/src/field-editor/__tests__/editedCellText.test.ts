import { describe, expect, it } from "vitest";
import { resolveEditedCellText } from "../selectionAuthority";

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
