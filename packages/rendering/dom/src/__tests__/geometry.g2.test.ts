// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createGeometryReader,
	type GeometryReaderHost,
	type LineBox,
	type Point,
	type Rect,
} from "../geometry";
import { singleRunLineBox } from "../geometry/types";
import { DomScheduler } from "../scheduler";

let frameQueue: FrameRequestCallback[] = [];

function installMockRaf(): void {
	frameQueue = [];
	vi.stubGlobal(
		"requestAnimationFrame",
		(callback: FrameRequestCallback): number => {
			frameQueue.push(callback);
			return frameQueue.length;
		},
	);
}

function flushFrame(): void {
	const batch = frameQueue.splice(0);
	for (const callback of batch) {
		callback(0);
	}
}

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

function line(
	top: number,
	bottom: number,
	startOffset: number,
	endOffset: number,
): LineBox {
	return singleRunLineBox(
		rect(0, top, 100, bottom - top),
		startOffset,
		endOffset,
	);
}

describe("GeometryReader G2 cache (injected measure)", () => {
	const readers: GeometryReaderHost[] = [];

	beforeEach(() => {
		installMockRaf();
	});

	afterEach(() => {
		for (const reader of readers) {
			reader.dispose();
		}
		readers.length = 0;
		document.body.replaceChildren();
		vi.unstubAllGlobals();
	});

	it("G2: injected measure is cached per block until commit, resize, or font generation changes", () => {
		const root = document.createElement("div");
		const caretRect = vi.fn((point: Point) =>
			point.blockId === "a" ? rect(0, 0, 0, 16) : rect(0, 20, 0, 16),
		);
		const reader = createGeometryReader({
			root,
			commitId: 1,
			observeResize: false,
			observeFonts: false,
			measure: { caretRect },
		});
		readers.push(reader);

		const a: Point = { blockId: "a", offset: 0 };
		const b: Point = { blockId: "b", offset: 0 };

		expect(reader.caretRect(a, "downstream")).toEqual(rect(0, 0, 0, 16));
		expect(reader.caretRect(a, "downstream")).toEqual(rect(0, 0, 0, 16));
		expect(caretRect).toHaveBeenCalledTimes(1);

		expect(reader.caretRect(b, "downstream")).toEqual(rect(0, 20, 0, 16));
		expect(caretRect).toHaveBeenCalledTimes(2);

		reader.setBlockCommitId("a", 2);
		expect(reader.caretRect(a, "downstream")).toEqual(rect(0, 0, 0, 16));
		expect(reader.caretRect(b, "downstream")).toEqual(rect(0, 20, 0, 16));
		expect(caretRect).toHaveBeenCalledTimes(3);

		reader.bumpResizeGeneration();
		reader.caretRect(a, "downstream");
		reader.caretRect(b, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(5);

		reader.bumpFontGeneration();
		reader.caretRect(a, "downstream");
		reader.caretRect(b, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(7);

		reader.bumpScrollGeneration();
		reader.caretRect(a, "downstream");
		reader.caretRect(b, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(9);
	});

	it("G2: invalidation probes only named blocks", () => {
		let shifted = false;
		const blockRect = vi.fn((blockId: string) =>
			rect(0, Number(blockId.slice(1)) * 20 + (shifted && blockId === "b7" ? 5 : 0), 100, 16),
		);
		const caretRect = vi.fn((point: Point) => rect(0, Number(point.blockId.slice(1)) * 20, 0, 16));
		const reader = createGeometryReader({
			root: document.createElement("div"),
			commitId: 1,
			observeResize: false,
			observeFonts: false,
			measure: { caretRect, blockRect },
		});
		readers.push(reader);
		for (let index = 0; index < 100; index += 1) {
			reader.caretRect({ blockId: `b${index}`, offset: 0 }, "downstream");
		}
		blockRect.mockClear();
		caretRect.mockClear();

		reader.invalidateBlocks(["b3"], 2);
		expect(blockRect).toHaveBeenCalledTimes(0);

		// b7 moved without being named: the next read of it re-measures.
		shifted = true;
		reader.caretRect({ blockId: "b7", offset: 0 }, "downstream");
		expect(caretRect).toHaveBeenCalledTimes(1);
	});

	it("G2: a scroll that moves the root drops cached viewport-relative rects", () => {
		const scroller = document.createElement("div");
		const root = document.createElement("div");
		scroller.append(root);
		document.body.append(scroller);

		let caretTop = 100;
		const caretRect = vi.fn(() => rect(0, caretTop, 0, 16));
		const reader = createGeometryReader({
			root,
			commitId: 1,
			observeResize: false,
			observeFonts: false,
			measure: { caretRect },
		});
		readers.push(reader);

		const point: Point = { blockId: "a", offset: 0 };
		expect(reader.caretRect(point, "downstream")).toEqual(
			rect(0, 100, 0, 16),
		);

		// the scroller moves the root, so the cached viewport top is wrong
		caretTop = 40;
		scroller.dispatchEvent(new Event("scroll"));

		expect(reader.caretRect(point, "downstream")).toEqual(
			rect(0, 40, 0, 16),
		);
		expect(caretRect).toHaveBeenCalledTimes(2);
	});

	it("G2: the scroll listener lets go of a root that left the tree", () => {
		const scroller = document.createElement("div");
		const root = document.createElement("div");
		scroller.append(root);
		document.body.append(scroller);

		const caretRect = vi.fn(() => rect(0, 100, 0, 16));
		const reader = createGeometryReader({
			root,
			commitId: 1,
			observeResize: false,
			observeFonts: false,
			measure: { caretRect },
		});
		readers.push(reader);

		const point: Point = { blockId: "a", offset: 0 };
		reader.caretRect(point, "downstream");

		root.remove();
		// first scroll after the unmount detaches the listener, so the document
		// stops referencing the reader and the root it holds
		scroller.dispatchEvent(new Event("scroll"));
		scroller.append(root);
		scroller.dispatchEvent(new Event("scroll"));

		expect(caretRect).toHaveBeenCalledTimes(1);
	});

	it("G2: a scroll outside the root keeps the cache warm", () => {
		const sibling = document.createElement("div");
		const root = document.createElement("div");
		document.body.append(sibling, root);

		const caretRect = vi.fn(() => rect(0, 100, 0, 16));
		const reader = createGeometryReader({
			root,
			commitId: 1,
			observeResize: false,
			observeFonts: false,
			measure: { caretRect },
		});
		readers.push(reader);

		const point: Point = { blockId: "a", offset: 0 };
		reader.caretRect(point, "downstream");
		sibling.dispatchEvent(new Event("scroll"));
		reader.caretRect(point, "downstream");

		expect(caretRect).toHaveBeenCalledTimes(1);
	});

	it("G2: scheduler read-phase invalidation drops only the summary's blocks", () => {
		const root = document.createElement("div");
		const lineBoxes = vi.fn((blockId: string) => [
			line(blockId === "a" ? 0 : 20, blockId === "a" ? 16 : 36, 0, 4),
		]);
		const reader = createGeometryReader({
			root,
			commitId: 1,
			observeResize: false,
			observeFonts: false,
			measure: { lineBoxes },
		});
		readers.push(reader);

		expect(reader.lineBoxes("a")).toHaveLength(1);
		expect(reader.lineBoxes("b")).toHaveLength(1);
		expect(lineBoxes).toHaveBeenCalledTimes(2);

		const scheduler = new DomScheduler("root-a", { geometry: reader });
		scheduler.acceptCommit({
			commitId: 2,
			origin: { type: "user" },
			summary: {
				commitId: 2,
				blockText: [{ blockId: "a", splices: [], formatRanges: [] }],
				structural: [],
				affectedBlockIds: ["a"],
			},
			selectionBefore: {
				state: null,
				version: 1,
				origin: "programmatic",
				commitId: 1,
			},
			selectionAfter: {
				state: null,
				version: 2,
				origin: "programmatic",
				commitId: 2,
			},
			source: "apply",
			diagnostics: [],
		});

		const generation = reader.generation;
		flushFrame();
		expect(reader.generation).toBeGreaterThan(generation);

		expect(reader.lineBoxes("a")).toHaveLength(1);
		expect(reader.lineBoxes("b")).toHaveLength(1);
		expect(lineBoxes).toHaveBeenCalledTimes(3);
	});

	it("G3: injected lineBoxes stay single-run", () => {
		const root = document.createElement("div");
		const boxes = [line(0, 16, 0, 8)];
		const reader = createGeometryReader({
			root,
			observeResize: false,
			observeFonts: false,
			measure: { lineBoxes: () => boxes },
		});
		readers.push(reader);

		expect(reader.lineBoxes("p1")).toEqual(boxes);
		expect(reader.lineBoxes("p1")[0]?.runs).toHaveLength(1);
		expect(reader.lineBoxes("p1")[0]?.runs[0]?.run).toEqual({
			from: 0,
			to: 8,
			level: 0,
		});
	});
});
