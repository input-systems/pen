import type {
	BlockDecoration,
	Decoration,
	InlineDecoration,
} from "@input/pen-types";
import { describe, expect, it } from "vitest";

import {
	createDecorationSet,
	emptyDecorationSet,
	updateDecorationsForAffectedBlocks,
} from "../editor/decorations";

function inlineDec(
	blockId: string,
	from: number,
	to: number,
	mark = "x",
): InlineDecoration {
	return {
		type: "inline",
		blockId,
		from,
		to,
		attributes: { mark },
	};
}

function blockDec(blockId: string, mark = "x"): BlockDecoration {
	return {
		type: "block",
		blockId,
		attributes: { mark },
	};
}

describe("SCALE2 decoration scoping (F.2)", () => {
	it("SCALE2: a one-block update keeps the untouched forBlock array by identity", () => {
		const previous = createDecorationSet([
			inlineDec("a", 0, 2, "keep-a"),
			inlineDec("b", 0, 3, "keep-b"),
			blockDec("c", "keep-c"),
		]);
		const untouchedB = previous.forBlock("b");
		const untouchedC = previous.forBlock("c");
		const previousA = previous.forBlock("a");

		const next = updateDecorationsForAffectedBlocks(
			previous,
			["a"],
			[inlineDec("a", 0, 4, "next-a")],
		);

		expect(next).not.toBe(previous);
		expect(next.forBlock("a")).not.toBe(previousA);
		expect(next.forBlock("a")).toEqual([inlineDec("a", 0, 4, "next-a")]);
		expect(next.forBlock("b")).toBe(untouchedB);
		expect(next.forBlock("c")).toBe(untouchedC);
		expect(next.forBlock("b")).toEqual(untouchedB);
	});

	it("SCALE2: equal decorations for the affected block return the previous set by identity", () => {
		const previous = createDecorationSet([
			inlineDec("a", 0, 2, "same"),
			inlineDec("b", 0, 3, "keep-b"),
		]);
		const untouchedB = previous.forBlock("b");

		const next = updateDecorationsForAffectedBlocks(
			previous,
			["a"],
			[inlineDec("a", 0, 2, "same")],
		);

		expect(next).toBe(previous);
		expect(next.forBlock("b")).toBe(untouchedB);
	});

	it("SCALE2: an empty affected set is a no-op and keeps the set object", () => {
		const previous = createDecorationSet([inlineDec("a", 0, 1)]);
		expect(
			updateDecorationsForAffectedBlocks(
				previous,
				[],
				[inlineDec("a", 0, 9)],
			),
		).toBe(previous);
	});

	it("SCALE2: decorations for blocks outside the affected set are ignored", () => {
		const previous = createDecorationSet([
			inlineDec("a", 0, 1, "old-a"),
			inlineDec("b", 0, 1, "old-b"),
		]);
		const untouchedB = previous.forBlock("b");

		const next = updateDecorationsForAffectedBlocks(
			previous,
			["a"],
			[inlineDec("a", 0, 2, "new-a"), inlineDec("b", 0, 9, "smuggle-b")],
		);

		expect(next.forBlock("a")).toEqual([inlineDec("a", 0, 2, "new-a")]);
		expect(next.forBlock("b")).toBe(untouchedB);
		expect(next.forBlock("b")).toEqual([inlineDec("b", 0, 1, "old-b")]);
	});

	it("SCALE2: clearing the affected block drops only that index entry", () => {
		const previous = createDecorationSet([
			inlineDec("a", 0, 1),
			inlineDec("b", 0, 1),
		]);
		const untouchedB = previous.forBlock("b");

		const next = updateDecorationsForAffectedBlocks(previous, ["a"], []);

		expect(next.forBlock("a")).toBe(
			emptyDecorationSet().forBlock("missing"),
		);
		expect(next.forBlock("a")).toHaveLength(0);
		expect(next.forBlock("b")).toBe(untouchedB);
	});
});
