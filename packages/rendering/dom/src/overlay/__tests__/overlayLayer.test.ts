// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	createOverlayLayerElement,
	OverlayLayerPainter,
} from "../overlayLayer";
import type { OverlayPaintItem } from "../types";

const OPTIONS = { variant: "default", solidCaret: false } as const;

function item(
	patch: Partial<OverlayPaintItem> &
		Pick<OverlayPaintItem, "key" | "kind">,
): OverlayPaintItem {
	return {
		contributor: "test",
		x: 12,
		y: 34,
		width: 100,
		height: 20,
		paint: "layer",
		epoch: 0,
		...patch,
	};
}

/** One painted item of every kind and caret role. */
function everyKind(epoch = 1): OverlayPaintItem[] {
	return [
		item({
			key: "local",
			kind: "caret",
			role: "local",
			blockId: "b1",
			offset: 3,
			affinity: "upstream",
			width: 0,
			epoch,
		}),
		item({
			key: "anchor",
			kind: "caret",
			role: "endpoint",
			endpoint: "anchor",
			blockId: "b2",
			offset: 0,
			affinity: "downstream",
			width: 0,
		}),
		item({
			key: "remote:7",
			kind: "caret",
			role: "remote",
			blockId: "b1",
			offset: 1,
			affinity: "downstream",
			width: 0,
			attributes: { "data-client-id": "7", onclick: "alert(1)" },
		}),
		item({ key: "outline:b3", kind: "block-outline", blockId: "b3" }),
		item({
			key: "span",
			kind: "block-span",
			fromBlockId: "b4",
			toBlockId: "b9",
		}),
		item({
			key: "cells",
			kind: "cell-range",
			blockId: "t1",
			anchorCell: { row: 0, col: 1 },
			headCell: { row: 2, col: 3 },
		}),
		item({ key: "range:0", kind: "range" }),
	];
}

function setup(): {
	layer: HTMLElement;
	painter: OverlayLayerPainter;
} {
	const layer = createOverlayLayerElement(document);
	document.body.append(layer);
	return { layer, painter: new OverlayLayerPainter(layer) };
}

function paintedItems(layer: HTMLElement): HTMLElement[] {
	return [...layer.querySelectorAll<HTMLElement>("[data-pen-overlay-item]")];
}

/** Item kind, with carets told apart by block and offset. */
function nodeKey(node: HTMLElement): string | undefined {
	return node.dataset.penOverlayItem === "caret"
		? `caret:${node.getAttribute("data-offset")}:${node.getAttribute("data-block-id")}`
		: node.dataset.penOverlayItem;
}

describe("overlay layer painter (OV1, OV2, AX7)", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("OV2: painted items use translate3d and never set left or top", () => {
		const { layer, painter } = setup();
		painter.apply(everyKind(), OPTIONS);

		const nodes = paintedItems(layer);
		expect(nodes).toHaveLength(7);
		for (const node of nodes) {
			expect(node.style.transform).toBe("translate3d(12px, 34px, 0)");
			expect(node.style.position).toBe("absolute");
			expect(node.style.left).toBe("0px");
			expect(node.style.top).toBe("0px");
			expect(node.style.right).toBe("");
			expect(node.style.bottom).toBe("");
		}
		const outline = layer.querySelector<HTMLElement>(
			'[data-pen-overlay-item="block-outline"]',
		);
		expect(outline?.style.width).toBe("100px");
		expect(outline?.style.height).toBe("20px");
		const local = layer.querySelector<HTMLElement>("[data-pen-editor-caret]");
		expect(local?.style.height).toBe("20px");
		expect(local?.getAttribute("data-affinity")).toBe("upstream");
		expect(local?.getAttribute("data-offset")).toBe("3");
		expect(layer.style.position).toBe("absolute");
		expect(layer.style.left).toBe("0px");
		expect(layer.style.top).toBe("0px");
	});

	it("OV1: equal keys from different contributors paint separate nodes", () => {
		const { layer, painter } = setup();
		const builtIn = item({
			key: "range:first",
			kind: "range",
			contributor: "selection",
		});
		const host = item({
			key: "range:first",
			kind: "block-outline",
			blockId: "b1",
			contributor: "host",
		});
		painter.apply([builtIn, host], OPTIONS);
		expect(paintedItems(layer).map((node) => node.dataset.penOverlayItem)).toEqual(
			["range", "block-outline"],
		);

		// Dropping the host item leaves the built-in node untouched.
		const [rangeNode] = paintedItems(layer);
		painter.apply([builtIn], OPTIONS);
		expect(paintedItems(layer)).toEqual([rangeNode]);
	});

	it("AX7: the layer and every item carry aria-hidden true and pointer-events none inline", () => {
		const { layer, painter } = setup();
		painter.apply(everyKind(), OPTIONS);

		expect(layer.getAttribute("aria-hidden")).toBe("true");
		expect(layer.style.pointerEvents).toBe("none");
		const nodes = paintedItems(layer);
		expect(new Set(nodes.map((node) => node.dataset.penOverlayItem))).toEqual(
			new Set(["caret", "block-outline", "block-span", "cell-range", "range"]),
		);
		for (const node of nodes) {
			expect(node.getAttribute("aria-hidden")).toBe("true");
			expect(node.style.pointerEvents).toBe("none");
		}
		const remote = layer.querySelector<HTMLElement>("[data-client-id]");
		expect(remote?.hasAttribute("onclick")).toBe(false);
	});

	it("OV1: repainting an identical plan performs zero DOM mutations", () => {
		const { layer, painter } = setup();
		painter.apply(everyKind(), OPTIONS);
		const observer = new MutationObserver(() => {});
		observer.observe(layer, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		});

		painter.apply(everyKind(), OPTIONS);

		expect(observer.takeRecords()).toHaveLength(0);
		observer.disconnect();
	});

	it("O: an epoch change replaces only the local caret element", () => {
		const { layer, painter } = setup();
		painter.apply(everyKind(1), OPTIONS);
		const before = new Map(paintedItems(layer).map((node) => [nodeKey(node), node]));
		const caretBefore = layer.querySelector("[data-pen-editor-caret]");

		painter.apply(everyKind(2), OPTIONS);

		const caretAfter = layer.querySelector("[data-pen-editor-caret]");
		expect(caretAfter).not.toBe(caretBefore);
		expect(caretBefore?.isConnected).toBe(false);
		expect(caretAfter?.getAttribute("data-pen-caret-epoch")).toBe("2");
		for (const node of paintedItems(layer)) {
			if (node === caretAfter) {
				continue;
			}
			expect(before.get(nodeKey(node))).toBe(node);
		}
	});

	it("AX6: a solid caret plan paints the local caret with animation none; endpoint and remote carets never blink", () => {
		const { layer, painter } = setup();
		painter.apply(everyKind(), OPTIONS);
		const local = layer.querySelector<HTMLElement>("[data-pen-editor-caret]");
		expect(local?.style.animation).toContain("--pen-editor-caret-animation");
		for (const node of layer.querySelectorAll<HTMLElement>(
			'[data-pen-overlay-item="caret"]:not([data-pen-editor-caret])',
		)) {
			expect(node.style.animation).toBe("none");
		}

		painter.apply(everyKind(), { variant: "default", solidCaret: true });
		expect(local?.style.animation).toBe("none");
	});

	it("OV3: items a binding paints are left out of the layer", () => {
		const { layer, painter } = setup();
		painter.apply(
			[
				item({
					key: "local",
					kind: "caret",
					role: "local",
					blockId: "b1",
					offset: 0,
					affinity: "downstream",
					paint: "binding",
				}),
			],
			OPTIONS,
		);
		expect(paintedItems(layer)).toHaveLength(0);
	});
});
