// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import {
	createGeometryReader,
	type GeometryReaderHost,
	type LineBox,
	type Point,
	type Rect,
} from "../index";
import { collapsedRect } from "../types";

const readers: GeometryReaderHost[] = [];

type CaretHitDocument = {
	caretPositionFromPoint?: (
		x: number,
		y: number,
	) => { offsetNode: Node; offset: number } | null;
	caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretDoc(): CaretHitDocument {
	return document as unknown as CaretHitDocument;
}

afterEach(() => {
	for (const reader of readers) {
		reader.dispose();
	}
	readers.length = 0;
	document.body.replaceChildren();
	caretDoc().caretPositionFromPoint = undefined;
	caretDoc().caretRangeFromPoint = undefined;
	vi.restoreAllMocks();
});

const ARABIC = "مرحبا";

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
	dir?: "ltr" | "rtl",
): { block: HTMLElement; inline: HTMLElement } {
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	if (dir) {
		block.setAttribute("dir", dir);
	}
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

describe("GeometryReader G3", () => {
	it("G3: empty-line caretRect uses the degenerate run edge named by affinity", () => {
		const root = mountEditorRoot();
		mountBlock(root, "p1", "", mockDOMRect(0, 0, 40, 16));
		const reader = createReader(root);

		expect(
			reader.caretRect({ blockId: "p1", offset: 0 }, "downstream"),
		).toEqual(collapsedRect(40, 0, 16));
		expect(
			reader.caretRect({ blockId: "p1", offset: 0 }, "upstream"),
		).toEqual(collapsedRect(0, 0, 16));
	});

	it("G3: LineBox.runs on dir=rtl hosts uses odd embedding level", () => {
		const root = mountEditorRoot();
		mountBlock(root, "p1", ARABIC, mockDOMRect(0, 0, 80, 16), "rtl");
		const reader = createReader(root);
		const box = reader.lineBoxes("p1")[0];
		expect(box?.runs).toEqual([
			{
				run: { from: 0, to: ARABIC.length, level: 1 },
				rect: rect(0, 0, 80, 16),
			},
		]);

		expect(
			reader.caretRect({ blockId: "p1", offset: 0 }, "downstream"),
		).toEqual(collapsedRect(80, 0, 16));
		expect(
			reader.caretRect(
				{ blockId: "p1", offset: ARABIC.length },
				"upstream",
			),
		).toEqual(collapsedRect(0, 0, 16));
	});

	it("G3: single-run wrap still returns the affinity-named line-box edge", () => {
		const root = mountEditorRoot();
		mountBlock(root, "p1", "abcdefghij", mockDOMRect(0, 0, 100, 32));
		const lines: readonly LineBox[] = [
			{
				top: 0,
				bottom: 16,
				startOffset: 0,
				endOffset: 5,
				runs: [
					{
						run: { from: 0, to: 5, level: 0 },
						rect: rect(0, 0, 100, 16),
					},
				],
			},
			{
				top: 16,
				bottom: 32,
				startOffset: 5,
				endOffset: 10,
				runs: [
					{
						run: { from: 5, to: 10, level: 0 },
						rect: rect(0, 16, 100, 16),
					},
				],
			},
		];
		const reader = createReader(root, {
			measure: { lineBoxes: () => lines },
		});

		expect(
			reader.caretRect({ blockId: "p1", offset: 5 }, "downstream"),
		).toEqual(collapsedRect(0, 16, 16));
		expect(
			reader.caretRect({ blockId: "p1", offset: 5 }, "upstream"),
		).toEqual(collapsedRect(100, 0, 16));
	});

	it("G3: measure.caretRect receives affinity and caches each side separately", () => {
		const root = mountEditorRoot();
		const caretRect = vi.fn(
			(point: Point, affinity: "upstream" | "downstream") =>
				affinity === "upstream"
					? rect(8, 0, 0, 16)
					: rect(24, 0, 0, 16),
		);
		const reader = createReader(root, {
			measure: { caretRect },
		});
		const point: Point = { blockId: "p1", offset: 3 };

		expect(reader.caretRect(point, "downstream")).toEqual(
			rect(24, 0, 0, 16),
		);
		expect(reader.caretRect(point, "upstream")).toEqual(rect(8, 0, 0, 16));
		expect(caretRect).toHaveBeenCalledTimes(2);
		expect(caretRect).toHaveBeenNthCalledWith(1, point, "downstream");
		expect(caretRect).toHaveBeenNthCalledWith(2, point, "upstream");

		expect(reader.caretRect(point, "downstream")).toEqual(
			rect(24, 0, 0, 16),
		);
		expect(reader.caretRect(point, "upstream")).toEqual(rect(8, 0, 0, 16));
		expect(caretRect).toHaveBeenCalledTimes(2);
	});
});

describe("GeometryReader G4", () => {
	it("G4: pointAt resolves through caretPositionFromPoint", () => {
		const root = mountEditorRoot();
		const { inline } = mountBlock(
			root,
			"p1",
			"Hello",
			mockDOMRect(0, 0, 100, 16),
		);
		const text = inline.firstChild as Text;
		const hit = vi.fn(() => ({ offsetNode: text, offset: 2 }));
		caretDoc().caretPositionFromPoint = hit;
		const reader = createReader(root);

		expect(reader.pointAt(20, 8)).toEqual({ blockId: "p1", offset: 2 });
		expect(hit).toHaveBeenCalledWith(20, 8);
	});

	it("G4: pointAt falls back to caretRangeFromPoint when caretPositionFromPoint is missing", () => {
		const root = mountEditorRoot();
		const { inline } = mountBlock(
			root,
			"p1",
			"Hello",
			mockDOMRect(0, 0, 100, 16),
		);
		const text = inline.firstChild as Text;
		const range = document.createRange();
		range.setStart(text, 4);
		range.collapse(true);
		const hit = vi.fn(() => range);
		caretDoc().caretRangeFromPoint = hit;
		const reader = createReader(root);

		expect(reader.pointAt(40, 8)).toEqual({ blockId: "p1", offset: 4 });
		expect(hit).toHaveBeenCalledWith(40, 8);
	});

	it("G4: coordinates in the vertical band snap to the nearer block edge", () => {
		const root = mountEditorRoot();
		mountBlock(root, "p1", "Hello", mockDOMRect(100, 0, 80, 16));
		const reader = createReader(root);

		expect(reader.pointAt(10, 8)).toEqual({ blockId: "p1", offset: 0 });
		expect(reader.pointAt(300, 8)).toEqual({ blockId: "p1", offset: 5 });
	});

	it("G4: measure.pointAt is used when provided", () => {
		const root = mountEditorRoot();
		const pointAt = vi.fn(() => ({ blockId: "x", offset: 7 }));
		const reader = createReader(root, {
			measure: { pointAt },
		});

		expect(reader.pointAt(12, 34)).toEqual({ blockId: "x", offset: 7 });
		expect(pointAt).toHaveBeenCalledWith(12, 34);
	});

	it("G4: pointAt returns null when the root has no blocks", () => {
		const root = mountEditorRoot();
		const reader = createReader(root);

		expect(reader.pointAt(0, 0)).toBeNull();
	});

	it("G5 EM6: caretRect(0) of a placeholder-only block measures the br leading edge", () => {
		const root = mountEditorRoot();
		const { inline } = mountBlock(
			root,
			"empty",
			"",
			mockDOMRect(0, 40, 100, 16),
		);
		inline.replaceChildren();
		const placeholder = document.createElement("br");
		placeholder.setAttribute(DATA_ATTRS.emptyBlock, "");
		inline.appendChild(placeholder);
		vi.spyOn(placeholder, "getBoundingClientRect").mockReturnValue(
			mockDOMRect(8, 40, 0, 18),
		);
		const reader = createReader(root);

		expect(
			reader.caretRect({ blockId: "empty", offset: 0 }, "downstream"),
		).toEqual(collapsedRect(8, 40, 18));
	});

	it("G5 EM6: pointAt inside an empty placeholder resolves to offset 0", () => {
		const root = mountEditorRoot();
		const { inline } = mountBlock(
			root,
			"empty",
			"",
			mockDOMRect(0, 40, 100, 16),
		);
		inline.replaceChildren();
		const placeholder = document.createElement("br");
		placeholder.setAttribute(DATA_ATTRS.emptyBlock, "");
		inline.appendChild(placeholder);
		caretDoc().caretPositionFromPoint = () => ({
			offsetNode: placeholder,
			offset: 0,
		});
		const reader = createReader(root);

		expect(reader.pointAt(10, 48)).toEqual({ blockId: "empty", offset: 0 });
	});
});
