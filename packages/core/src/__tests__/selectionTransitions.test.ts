import { describe, expect, it } from "vitest";

import {
	arrowFromBlockSelection,
	clickSelectableBlock,
	convertPointerDrag,
	escalateSelectAll,
	transitionCellSelection,
	type SelectionState,
	type TextSelection,
	type TransitionBlock,
	type TransitionSnapshot,
} from "../selection/transitions";

function block(
	partial: Omit<
		TransitionBlock,
		"parentId" | "containerId" | "containerKind"
	> &
		Partial<
			Pick<TransitionBlock, "parentId" | "containerId" | "containerKind">
		>,
): TransitionBlock {
	return {
		parentId: null,
		containerId: null,
		containerKind: null,
		...partial,
	};
}

function snapshot(
	blocks: TransitionBlock[],
	topLevelIds?: readonly string[],
): TransitionSnapshot {
	const record: Record<string, TransitionBlock> = {};
	for (const entry of blocks) {
		record[entry.id] = entry;
	}
	const blockOrder = blocks.map((entry) => entry.id);
	return {
		blockOrder,
		topLevelIds: topLevelIds ?? blockOrder,
		blocks: record,
	};
}

function text(
	anchor: { blockId: string; offset: number },
	focus: { blockId: string; offset: number } = anchor,
): TextSelection {
	return {
		type: "text",
		anchor,
		focus,
		affinity: "downstream",
		goalX: null,
	};
}

const flatDoc = snapshot([
	block({ id: "p1", kind: "text", length: 8 }),
	block({ id: "p2", kind: "text", length: 5 }),
	block({ id: "img", kind: "structural", length: 0 }),
	block({ id: "p3", kind: "text", length: 3 }),
]);

const listDoc = snapshot([
	block({ id: "intro", kind: "text", length: 4 }),
	block({
		id: "li1",
		kind: "text",
		length: 6,
		containerId: "list-a",
		containerKind: "list",
	}),
	block({
		id: "li2",
		kind: "text",
		length: 4,
		containerId: "list-a",
		containerKind: "list",
	}),
	block({
		id: "li3",
		kind: "text",
		length: 2,
		containerId: "list-a",
		containerKind: "list",
	}),
	block({ id: "outro", kind: "text", length: 7 }),
]);

const tableDoc = snapshot([
	block({ id: "before", kind: "text", length: 4 }),
	block({
		id: "table",
		kind: "structural",
		length: 0,
		grid: { rows: 2, cols: 3 },
	}),
	block({ id: "after", kind: "text", length: 6 }),
]);

describe("selection transitions", () => {
	describe("T1", () => {
		it("T1: field text selection escalates to whole-block text", () => {
			const next = escalateSelectAll(
				flatDoc,
				text({ blockId: "p1", offset: 2 }),
			);

			expect(next).toEqual(
				text(
					{ blockId: "p1", offset: 0 },
					{ blockId: "p1", offset: 8 },
				),
			);
		});

		it("T1: whole-block text with no container escalates to top-level BlockSelection", () => {
			const whole = text(
				{ blockId: "p2", offset: 0 },
				{ blockId: "p2", offset: 5 },
			);

			expect(escalateSelectAll(flatDoc, whole)).toEqual({
				type: "block",
				blockIds: ["p1", "p2", "img", "p3"],
				head: "p3",
			});
		});

		it("T1: whole-block text inside a list escalates to the list's blocks", () => {
			const whole = text(
				{ blockId: "li2", offset: 0 },
				{ blockId: "li2", offset: 4 },
			);

			expect(escalateSelectAll(listDoc, whole)).toEqual({
				type: "block",
				blockIds: ["li1", "li2", "li3"],
				head: "li3",
			});
		});

		it("T1: container BlockSelection escalates to all top-level blocks", () => {
			const listBlocks: SelectionState = {
				type: "block",
				blockIds: ["li1", "li2", "li3"],
				head: "li3",
			};

			expect(escalateSelectAll(listDoc, listBlocks)).toEqual({
				type: "block",
				blockIds: ["intro", "li1", "li2", "li3", "outro"],
				head: "outro",
			});
		});

		it("T1: the next rung is computed from the current state, not a counter", () => {
			const field = text({ blockId: "li1", offset: 1 });
			const whole = escalateSelectAll(listDoc, field);
			const container = escalateSelectAll(listDoc, whole);
			const top = escalateSelectAll(listDoc, container);
			const again = escalateSelectAll(listDoc, top);

			expect(whole).toEqual(
				text(
					{ blockId: "li1", offset: 0 },
					{ blockId: "li1", offset: 6 },
				),
			);
			expect(container).toEqual({
				type: "block",
				blockIds: ["li1", "li2", "li3"],
				head: "li3",
			});
			expect(top).toEqual({
				type: "block",
				blockIds: ["intro", "li1", "li2", "li3", "outro"],
				head: "outro",
			});
			expect(again).toEqual(top);
		});

		it("T1: empty-block caret skips the field rung", () => {
			const emptyDoc = snapshot([
				block({ id: "empty", kind: "text", length: 0 }),
				block({ id: "next", kind: "text", length: 2 }),
			]);

			expect(
				escalateSelectAll(
					emptyDoc,
					text({ blockId: "empty", offset: 0 }),
				),
			).toEqual({
				type: "block",
				blockIds: ["empty", "next"],
				head: "next",
			});
		});

		it("T1: document-first entry covers all content on the first press", () => {
			expect(
				escalateSelectAll(
					flatDoc,
					text({ blockId: "p2", offset: 2 }),
					"document-first",
				),
			).toEqual(
				text(
					{ blockId: "p1", offset: 0 },
					{ blockId: "p3", offset: 3 },
				),
			);
		});

		it("T1: document-first from no selection covers all content", () => {
			expect(escalateSelectAll(flatDoc, null, "document-first")).toEqual(
				text(
					{ blockId: "p1", offset: 0 },
					{ blockId: "p3", offset: 3 },
				),
			);
		});

		it("T1: document-first escalates to BlockSelection on the second press", () => {
			const content = escalateSelectAll(
				flatDoc,
				text({ blockId: "p2", offset: 2 }),
				"document-first",
			);
			const blocks = escalateSelectAll(
				flatDoc,
				content,
				"document-first",
			);

			expect(blocks).toEqual({
				type: "block",
				blockIds: ["p1", "p2", "img", "p3"],
				head: "p3",
			});
			expect(
				escalateSelectAll(flatDoc, blocks, "document-first"),
			).toEqual(blocks);
		});

		it("T1: document-first reaches all content across containers in one press", () => {
			expect(
				escalateSelectAll(
					listDoc,
					text({ blockId: "li2", offset: 1 }),
					"document-first",
				),
			).toEqual(
				text(
					{ blockId: "intro", offset: 0 },
					{ blockId: "outro", offset: 7 },
				),
			);
		});

		it("T1: document-first ends at a structural last block's unit extent", () => {
			const trailingImage = snapshot([
				block({ id: "p1", kind: "text", length: 4 }),
				block({ id: "img", kind: "structural", length: 0 }),
			]);

			expect(
				escalateSelectAll(
					trailingImage,
					text({ blockId: "p1", offset: 1 }),
					"document-first",
				),
			).toEqual(
				text(
					{ blockId: "p1", offset: 0 },
					{ blockId: "img", offset: 1 },
				),
			);
		});

		it("T1: document-first over an empty document goes straight to BlockSelection", () => {
			const emptyDoc = snapshot([
				block({ id: "empty", kind: "text", length: 0 }),
			]);

			expect(
				escalateSelectAll(
					emptyDoc,
					text({ blockId: "empty", offset: 0 }),
					"document-first",
				),
			).toEqual({
				type: "block",
				blockIds: ["empty"],
				head: "empty",
			});
		});

		it("T1: document-first does not walk a BlockSelection backwards", () => {
			const listBlocks: SelectionState = {
				type: "block",
				blockIds: ["li1", "li2", "li3"],
				head: "li3",
			};

			expect(
				escalateSelectAll(listDoc, listBlocks, "document-first"),
			).toEqual({
				type: "block",
				blockIds: ["intro", "li1", "li2", "li3", "outro"],
				head: "outro",
			});
		});
	});

	describe("T2", () => {
		it("T2: pointer crossing a text-block boundary becomes multi-block text", () => {
			const next = convertPointerDrag(
				flatDoc,
				text({ blockId: "p1", offset: 3 }),
				{ blockId: "p2", offset: 2 },
			);

			expect(next).toEqual(
				text(
					{ blockId: "p1", offset: 3 },
					{ blockId: "p2", offset: 2 },
				),
			);
		});

		it("T2: dragging across a structural block stays a text selection", () => {
			const next = convertPointerDrag(
				flatDoc,
				text({ blockId: "p1", offset: 0 }),
				{ blockId: "p3", offset: 3 },
			);

			expect(next?.type).toBe("text");
			expect(next).toEqual(
				text(
					{ blockId: "p1", offset: 0 },
					{ blockId: "p3", offset: 3 },
				),
			);
		});

		it("T2: full-coverage multi-block text does not flip to BlockSelection", () => {
			const next = convertPointerDrag(
				flatDoc,
				text({ blockId: "p1", offset: 0 }),
				{ blockId: "p2", offset: 5 },
			);

			expect(next?.type).toBe("text");
			expect(escalateSelectAll(flatDoc, next)?.type).toBe("block");
		});

		type Point = [blockId: string, offset: number];
		it.each<[string, Point, Point, [Point, Point]]>([
			["a structural focus covers the block in the drag direction (forward)", ["p2", 2], ["img", 0], [["p2", 2], ["img", 1]]],
			["a structural focus covers the block in the drag direction (backward)", ["p3", 1], ["img", 1], [["p3", 1], ["img", 0]]],
			["a structural anchor covers from the drag's start side", ["img", 1], ["p3", 2], [["img", 0], ["p3", 2]]],
			["within one block the focus is clamped, not covered", ["p1", 2], ["p1", 99], [["p1", 2], ["p1", 8]]],
		])("T2: %s", (_name, [anchorId, anchorOffset], [focusId, focusOffset], [from, to]) => {
			expect(
				convertPointerDrag(flatDoc, text({ blockId: anchorId, offset: anchorOffset }), {
					blockId: focusId,
					offset: focusOffset,
				}),
			).toEqual(text({ blockId: from[0], offset: from[1] }, { blockId: to[0], offset: to[1] }));
		});
	});

	describe("T3", () => {
		it("T3: full-coverage text over ≥2 blocks escalates to BlockSelection on select-all", () => {
			const covered = text(
				{ blockId: "p1", offset: 0 },
				{ blockId: "p2", offset: 5 },
			);

			expect(escalateSelectAll(flatDoc, covered)).toEqual({
				type: "block",
				blockIds: ["p1", "p2"],
				head: "p2",
			});
		});

		it("T3: the pointer path never flips partial or whole-block text", () => {
			const partial = convertPointerDrag(
				flatDoc,
				text({ blockId: "p1", offset: 2 }),
				{ blockId: "p2", offset: 1 },
			);
			const single = convertPointerDrag(
				flatDoc,
				text({ blockId: "p1", offset: 0 }),
				{ blockId: "p1", offset: 8 },
			);

			expect(partial).toEqual(
				text({ blockId: "p1", offset: 2 }, { blockId: "p2", offset: 1 }),
			);
			expect(single).toEqual(
				text({ blockId: "p1", offset: 0 }, { blockId: "p1", offset: 8 }),
			);
		});
	});

	describe("T4", () => {
		it("T4: ArrowDown/Right collapse to the start of the block after head", () => {
			const sel: SelectionState = {
				type: "block",
				blockIds: ["p1"],
				head: "p1",
			};

			expect(
				arrowFromBlockSelection(flatDoc, sel, "down", false),
			).toEqual(text({ blockId: "p2", offset: 0 }));
			expect(
				arrowFromBlockSelection(flatDoc, sel, "right", false),
			).toEqual(text({ blockId: "p2", offset: 0 }));
		});

		it("T4: ArrowDown on the last block collapses to the end of head", () => {
			const sel: SelectionState = {
				type: "block",
				blockIds: ["p3"],
				head: "p3",
			};

			expect(
				arrowFromBlockSelection(flatDoc, sel, "down", false),
			).toEqual(text({ blockId: "p3", offset: 3 }));
		});

		it("T4: ArrowUp/Left collapse to the end of the block before head", () => {
			const sel: SelectionState = {
				type: "block",
				blockIds: ["p2"],
				head: "p2",
			};

			expect(arrowFromBlockSelection(flatDoc, sel, "up", false)).toEqual(
				text({ blockId: "p1", offset: 8 }),
			);
			expect(
				arrowFromBlockSelection(flatDoc, sel, "left", false),
			).toEqual(text({ blockId: "p1", offset: 8 }));
		});

		it("T4: ArrowUp on the first block collapses to the start of head", () => {
			const sel: SelectionState = {
				type: "block",
				blockIds: ["p1"],
				head: "p1",
			};

			expect(arrowFromBlockSelection(flatDoc, sel, "up", false)).toEqual(
				text({ blockId: "p1", offset: 0 }),
			);
		});

		it("T4: Shift+Arrow grows and shrinks blockIds at head", () => {
			const start: SelectionState = {
				type: "block",
				blockIds: ["p2"],
				head: "p2",
			};
			const grown = arrowFromBlockSelection(flatDoc, start, "down", true);
			const grownBack = arrowFromBlockSelection(
				flatDoc,
				start,
				"up",
				true,
			);
			const shrunk = arrowFromBlockSelection(flatDoc, grown, "up", true);

			expect(grown).toEqual({
				type: "block",
				blockIds: ["p2", "img"],
				head: "img",
			});
			expect(grownBack).toEqual({
				type: "block",
				blockIds: ["p1", "p2"],
				head: "p1",
			});
			expect(shrunk).toEqual({
				type: "block",
				blockIds: ["p2"],
				head: "p2",
			});
		});

		it("T4: collapsing onto a structural neighbor yields BlockSelection", () => {
			const sel: SelectionState = {
				type: "block",
				blockIds: ["p2"],
				head: "p2",
			};

			expect(
				arrowFromBlockSelection(flatDoc, sel, "down", false),
			).toEqual({
				type: "block",
				blockIds: ["img"],
				head: "img",
			});
		});
	});

	describe("T5", () => {
		it("T5: clicking a structural block sets BlockSelection with that block as head", () => {
			expect(clickSelectableBlock(flatDoc, "img")).toEqual({
				type: "block",
				blockIds: ["img"],
				head: "img",
			});
		});

		it("T5: clicking a text block sets a collapsed text selection at the pointer offset", () => {
			expect(clickSelectableBlock(flatDoc, "p1", 4)).toEqual(
				text({ blockId: "p1", offset: 4 }),
			);
			expect(clickSelectableBlock(flatDoc, "p1", 99)).toEqual(
				text({ blockId: "p1", offset: 8 }),
			);
		});
	});

	describe("T6", () => {
		it("T6: pointer drag across cells updates CellSelection head", () => {
			const active: SelectionState = {
				type: "cell",
				blockId: "table",
				anchor: { row: 0, col: 0 },
				head: { row: 0, col: 0 },
			};

			expect(
				transitionCellSelection(tableDoc, active, {
					source: "pointer",
					cell: { row: 1, col: 2 },
				}),
			).toEqual({
				type: "cell",
				blockId: "table",
				anchor: { row: 0, col: 0 },
				head: { row: 1, col: 2 },
			});
		});

		it("T6: Shift+Arrow from an active cell extends the cell range", () => {
			const active: SelectionState = {
				type: "cell",
				blockId: "table",
				anchor: { row: 0, col: 1 },
				head: { row: 0, col: 1 },
			};

			expect(
				transitionCellSelection(tableDoc, active, {
					source: "keyboard",
					direction: "right",
					extend: true,
				}),
			).toEqual({
				type: "cell",
				blockId: "table",
				anchor: { row: 0, col: 1 },
				head: { row: 0, col: 2 },
			});
		});

		it("T6: arrow at the grid edge leaves via T4 relative to the table block", () => {
			const bottom: SelectionState = {
				type: "cell",
				blockId: "table",
				anchor: { row: 1, col: 0 },
				head: { row: 1, col: 0 },
			};

			expect(
				transitionCellSelection(tableDoc, bottom, {
					source: "keyboard",
					direction: "down",
					extend: false,
				}),
			).toEqual(text({ blockId: "after", offset: 0 }));
		});

		it("T6: interior arrow without shift moves a collapsed cell", () => {
			const active: SelectionState = {
				type: "cell",
				blockId: "table",
				anchor: { row: 0, col: 0 },
				head: { row: 0, col: 0 },
			};

			expect(
				transitionCellSelection(tableDoc, active, {
					source: "keyboard",
					direction: "down",
					extend: false,
				}),
			).toEqual({
				type: "cell",
				blockId: "table",
				anchor: { row: 1, col: 0 },
				head: { row: 1, col: 0 },
			});
		});
	});
});
