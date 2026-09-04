// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import {
	createGeometryReader,
	verticalCaretTarget,
	type GeometryReader,
	type GeometryReaderHost,
	type LineBox,
	type Point,
	type Rect,
} from "../index";
import { collapsedRect, singleRunLineBox } from "../types";

const readers: GeometryReaderHost[] = [];

afterEach(() => {
	for (const reader of readers) {
		reader.dispose();
	}
	readers.length = 0;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

function rect(left: number, top: number, width: number, height: number): Rect {
	return {
		x: left,
		y: top,
		width,
		height,
		left,
		top,
		right: left + width,
		bottom: top + height,
	};
}

function mockDOMRect(
	left: number,
	top: number,
	width: number,
	height: number,
): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		toJSON() {
			return {};
		},
	} as DOMRect;
}

function line(
	top: number,
	bottom: number,
	startOffset: number,
	endOffset: number,
	left = 0,
	width = 100,
): LineBox {
	return singleRunLineBox(
		rect(left, top, width, bottom - top),
		startOffset,
		endOffset,
	);
}

function lineMid(top: number, bottom: number): number {
	return (top + bottom) / 2;
}

function mountEditorRoot(): HTMLElement {
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorContent, "");
	document.body.appendChild(root);
	return root;
}

function mountBlock(
	root: HTMLElement,
	blockId: string,
	text: string,
	blockRect?: DOMRect,
): { block: HTMLElement; inline: HTMLElement } {
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.appendChild(document.createTextNode(text));
	block.appendChild(inline);
	root.appendChild(block);
	if (blockRect) {
		vi.spyOn(block, "getBoundingClientRect").mockReturnValue(blockRect);
		vi.spyOn(inline, "getBoundingClientRect").mockReturnValue(blockRect);
	}
	return { block, inline };
}

function createReader(
	root: HTMLElement,
	options: Omit<Parameters<typeof createGeometryReader>[0], "root"> = {},
): GeometryReaderHost {
	const reader = createGeometryReader({
		root,
		observeResize: false,
		observeFonts: false,
		...options,
	});
	readers.push(reader);
	return reader;
}

describe("GeometryReader G1", () => {
	it("G1: Range.getClientRects over text nodes, never per-character spans", () => {
		const root = mountEditorRoot();
		mountBlock(root, "p1", "Hello world");
		const getClientRects = vi.fn(function (this: Range) {
			return [mockDOMRect(10, 20, 80, 16)] as unknown as DOMRectList;
		});
		const previous = Object.getOwnPropertyDescriptor(
			Range.prototype,
			"getClientRects",
		);
		Object.defineProperty(Range.prototype, "getClientRects", {
			configurable: true,
			writable: true,
			value: getClientRects,
		});
		const createElement = vi.spyOn(document, "createElement");

		try {
			const reader = createReader(root);
			const rects = reader.rangeRects({
				anchor: { blockId: "p1", offset: 0 },
				focus: { blockId: "p1", offset: 5 },
			});

			expect(getClientRects).toHaveBeenCalled();
			expect(rects).toEqual([rect(10, 20, 80, 16)]);
			const spanCreates = createElement.mock.calls.filter(
				([tag]) => tag === "span",
			);
			expect(spanCreates).toEqual([]);
		} finally {
			if (previous) {
				Object.defineProperty(
					Range.prototype,
					"getClientRects",
					previous,
				);
			} else {
				delete (Range.prototype as { getClientRects?: unknown })
					.getClientRects;
			}
		}
	});

	it("G1: atom caret uses the host element rect, not character spans", () => {
		const root = mountEditorRoot();
		const { inline } = mountBlock(root, "p1", "");
		inline.replaceChildren();
		const host = document.createElement("span");
		host.setAttribute(DATA_ATTRS.inlineAtomHost, "");
		const before = document.createElement("span");
		before.setAttribute(DATA_ATTRS.inlineAtomCaretBoundary, "");
		before.setAttribute(DATA_ATTRS.inlineAtomCaretSide, "before");
		before.appendChild(document.createTextNode("\u200B"));
		const chip = document.createElement("span");
		chip.setAttribute(DATA_ATTRS.inlineAtom, "");
		chip.textContent = "x";
		const after = document.createElement("span");
		after.setAttribute(DATA_ATTRS.inlineAtomCaretBoundary, "");
		after.setAttribute(DATA_ATTRS.inlineAtomCaretSide, "after");
		after.appendChild(document.createTextNode("\u200B"));
		host.append(before, chip, after);
		inline.appendChild(host);
		vi.spyOn(host, "getBoundingClientRect").mockReturnValue(
			mockDOMRect(40, 8, 12, 16),
		);

		const reader = createReader(root);
		const caret = reader.caretRect(
			{ blockId: "p1", offset: 0 },
			"downstream",
		);

		expect(caret).toEqual(collapsedRect(40, 8, 16));
	});

	it("G3: zero-width getClientRects ghosts are not unioned into run boxes", () => {
		const root = mountEditorRoot();
		mountBlock(root, "p1", "abאבcd", mockDOMRect(24, 0, 51, 20));
		const ink = mockDOMRect(24, 0, 51, 20);
		const ghost = mockDOMRect(0, 0, 0, 20);
		const getClientRects = vi.fn(
			() => [ghost, ink] as unknown as DOMRectList,
		);
		const previous = Object.getOwnPropertyDescriptor(
			Range.prototype,
			"getClientRects",
		);
		Object.defineProperty(Range.prototype, "getClientRects", {
			configurable: true,
			writable: true,
			value: getClientRects,
		});

		try {
			const reader = createReader(root);
			const line = reader.lineBoxes("p1")[0];
			expect(line, "G3: expected a line box").toBeTruthy();
			expect(line?.runs[0]?.rect.left).toBe(24);
			expect(line?.runs[0]?.rect.width).toBe(51);
			expect(
				Math.min(
					...(line?.runs.map((geo) => geo.rect.left) ?? [
						Number.POSITIVE_INFINITY,
					]),
				),
			).toBe(24);
		} finally {
			if (previous) {
				Object.defineProperty(
					Range.prototype,
					"getClientRects",
					previous,
				);
			} else {
				delete (Range.prototype as { getClientRects?: unknown })
					.getClientRects;
			}
		}
	});
});

describe("GeometryReader G2", () => {
	it("G2: per-block cache keyed by commitId, resize generation, and font generation", () => {
		const root = mountEditorRoot();
		const caretRect = vi.fn((point: Point) =>
			point.blockId === "a" ? rect(0, 0, 0, 16) : rect(0, 20, 0, 16),
		);
		const reader = createReader(root, {
			commitId: 1,
			measure: { caretRect },
		});

		const a: Point = { blockId: "a", offset: 0 };
		const b: Point = { blockId: "b", offset: 0 };

		expect(reader.caretRect(a, "downstream")).toEqual(rect(0, 0, 0, 16));
		expect(reader.caretRect(a, "downstream")).toEqual(rect(0, 0, 0, 16));
		expect(caretRect).toHaveBeenCalledTimes(1);

		expect(reader.caretRect(b, "downstream")).toEqual(rect(0, 20, 0, 16));
		expect(caretRect).toHaveBeenCalledTimes(2);

		const generationAfterWarm = reader.generation;
		reader.setCommitId(2);
		expect(reader.generation).toBeGreaterThan(generationAfterWarm);
		expect(reader.caretRect(a, "downstream")).toEqual(rect(0, 0, 0, 16));
		expect(reader.caretRect(b, "downstream")).toEqual(rect(0, 20, 0, 16));
		expect(caretRect).toHaveBeenCalledTimes(4);

		reader.setBlockCommitId("a", 3);
		expect(reader.caretRect(a, "downstream")).toEqual(rect(0, 0, 0, 16));
		expect(reader.caretRect(b, "downstream")).toEqual(rect(0, 20, 0, 16));
		expect(caretRect).toHaveBeenCalledTimes(5);

		reader.bumpResizeGeneration();
		reader.caretRect(a, "downstream");
		reader.caretRect(b, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(7);

		reader.bumpFontGeneration();
		reader.caretRect(a, "downstream");
		reader.caretRect(b, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(9);

		reader.invalidateBlocks(["a"], 4);
		reader.caretRect(a, "downstream");
		reader.caretRect(b, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(10);
	});

	it("G2: a miss caches null so a same-generation retry does not remasure", () => {
		const root = mountEditorRoot();
		const blockRect = vi.fn(() => null);
		const reader = createReader(root, {
			measure: { blockRect },
		});

		expect(reader.blockRect("missing")).toBeNull();
		expect(reader.blockRect("missing")).toBeNull();
		expect(blockRect).toHaveBeenCalledTimes(1);
	});

	it("G2: a height-unchanged edit drops only the named block", () => {
		const root = mountEditorRoot();
		const boxes: Record<string, Rect> = {
			a: rect(0, 0, 100, 16),
			b: rect(0, 20, 100, 16),
		};
		const caretRect = vi.fn((point: Point) =>
			point.blockId === "a" ? rect(0, 0, 0, 16) : rect(0, 20, 0, 16),
		);
		const reader = createReader(root, {
			measure: {
				caretRect,
				blockRect: (blockId) => boxes[blockId] ?? null,
			},
		});
		const a: Point = { blockId: "a", offset: 0 };
		const b: Point = { blockId: "b", offset: 0 };

		reader.caretRect(a, "downstream");
		reader.caretRect(b, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(2);

		reader.invalidateBlocks(["a"], 2);
		reader.caretRect(a, "downstream");
		reader.caretRect(b, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(3);
	});

	it("G2: a Y-shifting edit drops cached followers whose live box moved", () => {
		const root = mountEditorRoot();
		const boxes: Record<string, Rect> = {
			a: rect(0, 0, 100, 16),
			b: rect(0, 20, 100, 16),
		};
		const caretRect = vi.fn((point: Point) =>
			point.blockId === "a"
				? rect(0, boxes.a?.top ?? 0, 0, boxes.a?.height ?? 16)
				: rect(0, boxes.b?.top ?? 0, 0, boxes.b?.height ?? 16),
		);
		const reader = createReader(root, {
			measure: {
				caretRect,
				blockRect: (blockId) => boxes[blockId] ?? null,
			},
		});
		const a: Point = { blockId: "a", offset: 0 };
		const b: Point = { blockId: "b", offset: 0 };

		reader.caretRect(a, "downstream");
		reader.caretRect(b, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(2);

		boxes.a = rect(0, 0, 100, 32);
		boxes.b = rect(0, 36, 100, 16);
		reader.invalidateBlocks(["a"], 2);
		reader.caretRect(a, "downstream");
		reader.caretRect(b, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(4);
	});

	it("G2: getBlockCommitId participates in the cache key when commitId is passed in", () => {
		const root = mountEditorRoot();
		const commits = new Map<string, number>([["p1", 10]]);
		const lineBoxes = vi.fn(() => [line(0, 16, 0, 4)]);
		const reader = createReader(root, {
			getBlockCommitId: (blockId) => commits.get(blockId) ?? 0,
			measure: { lineBoxes },
		});

		expect(reader.lineBoxes("p1")).toHaveLength(1);
		expect(reader.lineBoxes("p1")).toHaveLength(1);
		expect(lineBoxes).toHaveBeenCalledTimes(1);

		commits.set("p1", 11);
		reader.invalidateBlocks(["p1"], 11);
		expect(reader.lineBoxes("p1")).toHaveLength(1);
		expect(lineBoxes).toHaveBeenCalledTimes(2);
	});
});

describe("GeometryReader G5", () => {
	function mockReader(config: {
		lines: Record<string, readonly LineBox[]>;
		rects: Record<string, Rect>;
		hits: Array<{ x: number; y: number; point: Point }>;
	}): GeometryReader & { blockIds(): readonly string[] } {
		return {
			generation: 1,
			caretRect(point, affinity) {
				const boxes = config.lines[point.blockId] ?? [];
				// a boundary offset belongs to both lines; affinity picks the
				// side, as the real reader does at wraps and `\n`.
				const containing = boxes.filter(
					(lineBox) =>
						point.offset >= lineBox.startOffset &&
						point.offset <= lineBox.endOffset,
				);
				const box =
					(affinity === "upstream"
						? containing[0]
						: containing[containing.length - 1]) ?? boxes[0];
				if (!box) return null;
				return collapsedRect(50, box.top, box.bottom - box.top);
			},
			rangeRects: () => [],
			lineBoxes: (blockId) => config.lines[blockId] ?? [],
			pointAt(x, y) {
				const hit = config.hits.find(
					(entry) => entry.x === x && Math.abs(entry.y - y) < 1,
				);
				return hit?.point ?? null;
			},
			blockRect: (blockId) => config.rects[blockId] ?? null,
			blockIds: () => Object.keys(config.rects),
		};
	}

	it("G5: verticalCaretTarget is deterministic across wrapped lines, empty blocks, atoms, and block boundaries", () => {
		const wrapped = mockReader({
			lines: {
				wrap: [line(0, 16, 0, 10), line(16, 32, 10, 20)],
			},
			rects: { wrap: rect(0, 0, 200, 32) },
			hits: [
				{
					x: 40,
					y: lineMid(16, 32),
					point: { blockId: "wrap", offset: 14 },
				},
			],
		});
		expect(
			verticalCaretTarget(
				wrapped,
				{ blockId: "wrap", offset: 4 },
				"down",
				40,
			),
		).toEqual({
			point: { blockId: "wrap", offset: 14 },
			goalX: 40,
		});

		const empty = mockReader({
			lines: {
				empty: [line(40, 56, 0, 0)],
				prev: [line(0, 16, 0, 3)],
			},
			rects: {
				prev: rect(0, 0, 200, 16),
				empty: rect(0, 40, 200, 16),
			},
			hits: [
				{
					x: 12,
					y: lineMid(40, 56),
					point: { blockId: "empty", offset: 0 },
				},
			],
		});
		expect(
			verticalCaretTarget(
				empty,
				{ blockId: "prev", offset: 1 },
				"down",
				12,
			),
		).toEqual({
			point: { blockId: "empty", offset: 0 },
			goalX: 12,
		});

		const atoms = mockReader({
			lines: {
				atoms: [line(0, 18, 0, 2), line(18, 36, 2, 4)],
			},
			rects: { atoms: rect(0, 0, 200, 36) },
			hits: [
				{
					x: 8,
					y: lineMid(18, 36),
					point: { blockId: "atoms", offset: 3 },
				},
			],
		});
		expect(
			verticalCaretTarget(
				atoms,
				{ blockId: "atoms", offset: 1 },
				"down",
				8,
			),
		).toEqual({
			point: { blockId: "atoms", offset: 3 },
			goalX: 8,
		});

		const blocks = mockReader({
			lines: {
				a: [line(0, 16, 0, 5)],
				b: [line(32, 48, 0, 7)],
			},
			rects: {
				a: rect(0, 0, 200, 16),
				b: rect(0, 32, 200, 16),
			},
			hits: [
				{
					x: 64,
					y: lineMid(32, 48),
					point: { blockId: "b", offset: 2 },
				},
				{
					x: 64,
					y: lineMid(0, 16),
					point: { blockId: "a", offset: 3 },
				},
			],
		});
		const down = verticalCaretTarget(
			blocks,
			{ blockId: "a", offset: 3 },
			"down",
			64,
		);
		const up = verticalCaretTarget(
			blocks,
			{ blockId: "b", offset: 2 },
			"up",
			64,
		);
		expect(down).toEqual({ point: { blockId: "b", offset: 2 }, goalX: 64 });
		expect(
			verticalCaretTarget(
				blocks,
				{ blockId: "a", offset: 3 },
				"down",
				64,
			),
		).toEqual(down);
		expect(up?.goalX).toBe(64);
		expect(up?.point.blockId).toBe("a");
	});

	it("G5: persists goalX from the current caret when none is supplied", () => {
		const reader = mockReader({
			lines: {
				p: [line(0, 16, 0, 8, 10, 80), line(16, 32, 8, 16, 10, 80)],
			},
			rects: { p: rect(10, 0, 80, 32) },
			hits: [
				{
					x: 50,
					y: lineMid(16, 32),
					point: { blockId: "p", offset: 11 },
				},
			],
		});
		expect(
			verticalCaretTarget(reader, { blockId: "p", offset: 3 }, "down"),
		).toEqual({
			point: { blockId: "p", offset: 11 },
			goalX: 50,
		});
	});

	it("G5: ArrowUp leaves the current block when the shared edge hit-tests back onto it", () => {
		const reader = mockReader({
			lines: {
				a: [line(0, 16, 0, 10)],
				b: [line(16, 32, 0, 10)],
			},
			rects: {
				a: rect(0, 0, 200, 16),
				b: rect(0, 16, 200, 16),
			},
			hits: [
				{ x: 64, y: 16, point: { blockId: "b", offset: 10 } },
				{
					x: 64,
					y: lineMid(0, 16),
					point: { blockId: "a", offset: 0 },
				},
			],
		});
		expect(
			verticalCaretTarget(reader, { blockId: "b", offset: 0 }, "up", 64),
		).toEqual({ point: { blockId: "a", offset: 0 }, goalX: 64 });
	});

	it("G5: ArrowUp from the start of a line after `\\n` reaches the line above", () => {
		// "first line\nsecond": offset 11 is the end of line one and the start
		// of line two. The caret is drawn downstream, so up must leave line two.
		const reader = mockReader({
			lines: {
				p: [line(0, 16, 0, 11), line(16, 32, 11, 17)],
			},
			rects: { p: rect(0, 0, 200, 32) },
			hits: [
				{
					x: 50,
					y: lineMid(0, 16),
					point: { blockId: "p", offset: 9 },
				},
			],
		});
		expect(
			verticalCaretTarget(
				reader,
				{ blockId: "p", offset: 11 },
				"up",
				null,
				"downstream",
			),
		).toEqual({ point: { blockId: "p", offset: 9 }, goalX: 50 });
		// the default is the drawn side too, so callers without a selection
		// affinity get the same landing.
		expect(
			verticalCaretTarget(reader, { blockId: "p", offset: 11 }, "up"),
		).toEqual({ point: { blockId: "p", offset: 9 }, goalX: 50 });
		// upstream is the end of line one; there is no line above it.
		expect(
			verticalCaretTarget(
				reader,
				{ blockId: "p", offset: 11 },
				"up",
				null,
				"upstream",
			),
		).toEqual({ point: { blockId: "p", offset: 11 }, goalX: 50 });
	});

	it("G5: ArrowUp from an empty trailing line after `\\n` reaches the line above", () => {
		// "first line\n": the trailing break owns an empty line box (RI5).
		const reader = mockReader({
			lines: {
				p: [line(0, 16, 0, 11), line(16, 32, 11, 11)],
			},
			rects: { p: rect(0, 0, 200, 32) },
			hits: [
				{
					x: 50,
					y: lineMid(0, 16),
					point: { blockId: "p", offset: 9 },
				},
			],
		});
		expect(
			verticalCaretTarget(reader, { blockId: "p", offset: 11 }, "up"),
		).toEqual({ point: { blockId: "p", offset: 9 }, goalX: 50 });
	});
});
