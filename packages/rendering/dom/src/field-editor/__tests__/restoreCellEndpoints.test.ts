import { describe, expect, it } from "vitest";
import { resolveRestoreCellEndpoints } from "../selectionAuthority";

const BLOCK_ID = "table-1";
const ACTIVE = { row: 0, col: 0 } as const;

describe("resolveRestoreCellEndpoints", () => {
	it("uses the cell stamp that names the active cell", () => {
		expect(
			resolveRestoreCellEndpoints(
				{
					blockId: BLOCK_ID,
					anchorOffset: 1,
					focusOffset: 1,
					cell: ACTIVE,
				},
				ACTIVE,
			),
		).toEqual({
			blockId: BLOCK_ID,
			anchorOffset: 1,
			focusOffset: 1,
			cell: ACTIVE,
		});
	});

	it("returns null when the stamp names a different cell", () => {
		expect(
			resolveRestoreCellEndpoints(
				{
					blockId: BLOCK_ID,
					anchorOffset: 5,
					focusOffset: 5,
					cell: { row: 1, col: 0 },
				},
				ACTIVE,
			),
		).toBeNull();
	});

	it("does not treat a block-level stamp as addressable inside a cell", () => {
		expect(
			resolveRestoreCellEndpoints(
				{
					blockId: BLOCK_ID,
					anchorOffset: 0,
					focusOffset: 0,
				},
				ACTIVE,
			),
		).toBeNull();
	});
});
