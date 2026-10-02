import type { SelectionState } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import {
	isInlineAtomSelected,
	isInlineAtomSelectedInSlice,
} from "../utils/inlineAtomSelection";

function text(anchor: [string, number], focus: [string, number]): SelectionState {
	return {
		type: "text",
		anchor: { blockId: anchor[0], offset: anchor[1] },
		focus: { blockId: focus[0], offset: focus[1] },
		affinity: "downstream",
		goalX: null,
	};
}

describe("inline atom selection", () => {
	it("SCALE6: an atom is selected by a non-collapsed range inside its block, from the editor selection or the block slice", () => {
		const cases: { selection: SelectionState; offset: number; selected: boolean }[] = [
			{ selection: text(["a", 1], ["a", 3]), offset: 1, selected: true },
			{ selection: text(["a", 3], ["a", 1]), offset: 2, selected: true },
			{ selection: text(["a", 1], ["a", 2]), offset: 2, selected: false },
			{ selection: text(["a", 2], ["a", 2]), offset: 2, selected: false },
			{ selection: text(["a", 0], ["b", 4]), offset: 1, selected: false },
			{ selection: null, offset: 0, selected: false },
		];
		for (const { selection, offset, selected } of cases) {
			expect(isInlineAtomSelected(selection, "a", offset)).toBe(selected);
			const range =
				selection?.type === "text" && selection.anchor.blockId === selection.focus.blockId
					? {
							from: Math.min(selection.anchor.offset, selection.focus.offset),
							to: Math.max(selection.anchor.offset, selection.focus.offset),
						}
					: null;
			const single = selection?.type === "text" && selection.anchor.blockId === "a" && selection.focus.blockId === "a";
			expect(
				isInlineAtomSelectedInSlice({ isAnchor: single, isFocus: single, textRange: range }, offset),
			).toBe(selected);
		}
		expect(
			isInlineAtomSelectedInSlice({ isAnchor: true, isFocus: false, textRange: { from: 0, to: "end" } }, 1),
		).toBe(false);
	});
});
