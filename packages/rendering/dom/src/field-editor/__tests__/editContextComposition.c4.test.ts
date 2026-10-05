import { describe, expect, it } from "vitest";
import {
	commitEditContextComposition,
	deferEditContextCompositionDelta,
	openEditContextComposition,
	openEditContextCompositionAround,
	updateEditContextComposition,
	type EditContextComposition,
} from "../editContextComposition";

const BLOCK = "b1";

function applyEdits(
	composition: EditContextComposition,
	updates: Array<[number, number, string]>,
): { composition: EditContextComposition; buffer: string } {
	let buffer = composition.baseText;
	let current = composition;
	for (const [start, end, text] of updates) {
		buffer = buffer.slice(0, start) + text + buffer.slice(end);
		current = updateEditContextComposition(current, { start, end, text })
			.composition;
	}
	return { composition: current, buffer };
}

/** What the buffer shows: the base with the replaced range swapped. */
function shown(composition: EditContextComposition): string {
	const { baseText, replaced, text } = composition;
	if (!replaced) return baseText;
	return baseText.slice(0, replaced.start) + text + baseText.slice(replaced.end);
}

describe("C4 EditContext composition state", () => {
	it("C4: updates inside the composed text keep the replaced range and track the buffer", () => {
		const { composition, buffer } = applyEdits(
			openEditContextComposition(BLOCK, "Hello world"),
			[
				[5, 5, "n"],
				[5, 6, "ni"],
				[5, 7, "nih"],
				[5, 8, "niha"],
				[5, 9, "nihao"],
				[5, 10, "你好"],
			],
		);
		expect(composition.replaced).toEqual({ start: 5, end: 5 });
		expect(composition.text).toBe("你好");
		expect(shown(composition)).toBe(buffer);
		expect(commitEditContextComposition(composition)).toEqual({
			diff: [{ type: "insert", offset: 5, text: "你好" }],
			caret: 7,
		});
	});

	it("C4: a composition over a selection replaces exactly that range", () => {
		const { composition, buffer } = applyEdits(
			openEditContextComposition(BLOCK, "Hello world"),
			[
				[6, 11, "せ"],
				[6, 7, "せかい"],
				[6, 9, "世界"],
			],
		);
		expect(composition.replaced).toEqual({ start: 6, end: 11 });
		expect(shown(composition)).toBe(buffer);
		expect(commitEditContextComposition(composition)).toEqual({
			diff: [
				{ type: "delete", offset: 6, length: 5 },
				{ type: "insert", offset: 6, text: "世界" },
			],
			caret: 8,
		});
	});

	it("C4: an update reaching past the composed text grows the replaced range", () => {
		const { composition, buffer } = applyEdits(
			openEditContextComposition(BLOCK, "Hello world"),
			[
				[5, 5, "ka"],
				[4, 8, "化"],
			],
		);
		expect(buffer).toBe("Hell化world");
		expect(composition.replaced).toEqual({ start: 4, end: 6 });
		expect(composition.text).toBe("化");
		expect(shown(composition)).toBe(buffer);
	});

	it("C4: the paint edit is the update at the composition's shift in the field", () => {
		const first = updateEditContextComposition(
			openEditContextComposition(BLOCK, "Hello world"),
			{ start: 5, end: 5, text: "n" },
		);
		expect(first.paint).toEqual({ offset: 5, deleteLength: 0, text: "n" });
		const second = updateEditContextComposition(first.composition, {
			start: 5,
			end: 6,
			text: "ni",
		});
		expect(second.paint).toEqual({ offset: 5, deleteLength: 1, text: "ni" });
	});

	it("C4: the first update's resolved range wins over its buffer range (FE9)", () => {
		const { composition, paint } = updateEditContextComposition(
			openEditContextComposition(BLOCK, "Hello world"),
			{ start: 11, end: 11, text: "n" },
			{ start: 5, end: 5 },
		);
		expect(composition.replaced).toEqual({ start: 5, end: 5 });
		expect(paint.offset).toBe(5);
		// Later ranges are read against where the IME put the composition.
		const next = updateEditContextComposition(composition, {
			start: 11,
			end: 12,
			text: "ni",
		});
		expect(next.composition.text).toBe("ni");
		expect(next.paint).toEqual({ offset: 5, deleteLength: 1, text: "ni" });
	});

	it("C4: an empty composition commits nothing", () => {
		const { composition } = applyEdits(
			openEditContextComposition(BLOCK, "Hello world"),
			[
				[6, 11, "k"],
				[6, 7, ""],
			],
		);
		expect(commitEditContextComposition(composition)).toBeNull();
		expect(
			commitEditContextComposition(
				openEditContextComposition(BLOCK, "Hello world"),
			),
		).toBeNull();
	});

	it("C2: the commit rebases over deferred deltas, keeping a remote insert inside the replaced range", () => {
		let { composition } = applyEdits(
			openEditContextComposition(BLOCK, "Hello world"),
			[[6, 11, "せ"]],
		);
		// Remote: "X" at 0, then "Y" inside "world" ("XHello woYrld").
		composition = deferEditContextCompositionDelta(composition, [
			{ insert: "X" },
		]);
		composition = deferEditContextCompositionDelta(composition, [
			{ retain: 9 },
			{ insert: "Y" },
		]);
		composition = updateEditContextComposition(composition, {
			start: 6,
			end: 7,
			text: "世界",
		}).composition;

		const commit = commitEditContextComposition(composition)!;
		let text = "XHello woYrld";
		for (const op of commit.diff) {
			text =
				op.type === "insert"
					? text.slice(0, op.offset) + op.text + text.slice(op.offset)
					: text.slice(0, op.offset) + text.slice(op.offset + op.length);
		}
		expect(text).toBe("XHello Y世界");
		expect(commit.caret).toBe(10);
	});

	it("C2: remote inserts before a composition at the end shift the commit", () => {
		let composition = applyEdits(
			openEditContextComposition(BLOCK, "Hello world"),
			[[11, 11, "n"]],
		).composition;
		for (let index = 0; index < 4; index++) {
			composition = deferEditContextCompositionDelta(composition, [
				{ insert: "X" },
			]);
		}
		composition = updateEditContextComposition(composition, {
			start: 11,
			end: 12,
			text: "你",
		}).composition;
		expect(commitEditContextComposition(composition)).toEqual({
			diff: [{ type: "insert", offset: 15, text: "你" }],
			caret: 16,
		});
	});

	it("C1: a composition opened around a rewound update replaces nothing", () => {
		const composition = openEditContextCompositionAround(
			BLOCK,
			"Hello world",
			11,
			"nihao",
		);
		expect(shown(composition)).toBe("Hello worldnihao");
		expect(composition.field).toBe("composed");
		expect(commitEditContextComposition(composition)?.caret).toBe(16);
	});
});
