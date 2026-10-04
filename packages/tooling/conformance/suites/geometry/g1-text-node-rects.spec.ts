import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import { clickOffset, logLoad } from "../../src/specHelpers";

const HELLO_ID = "hello-p1";
const HELLO_MID = 5;

type InlineShape = {
	textNodeCount: number;
	elementChildCount: number;
	charSpanCount: number;
	text: string;
};

type NativeCaretBox = {
	left: number;
	top: number;
	height: number;
};

async function readInlineShape(
	page: Page,
	blockId: string,
): Promise<InlineShape | null> {
	return page.evaluate((id) => {
		const block = document.querySelector(`[data-block-id="${id}"]`);
		const inline = block?.querySelector("[data-pen-inline-content]");
		if (!(inline instanceof HTMLElement)) {
			return null;
		}
		const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
		let textNodeCount = 0;
		while (walker.nextNode()) {
			textNodeCount += 1;
		}
		const elements = [...inline.querySelectorAll("*")];
		const charSpanCount = elements.filter((node) => {
			if (!(node instanceof HTMLElement)) {
				return false;
			}
			if (node.hasAttribute("data-pen-inline-atom")) {
				return false;
			}
			const text = node.textContent ?? "";
			return text.length === 1 && node.childElementCount === 0;
		}).length;
		return {
			textNodeCount,
			elementChildCount: elements.length,
			charSpanCount,
			text: inline.textContent ?? "",
		};
	}, blockId);
}

async function readNativeCaretBox(
	page: Page,
	blockId: string,
	offset: number,
): Promise<NativeCaretBox | null> {
	return page.evaluate(
		({ id, at }) => {
			const block = document.querySelector(`[data-block-id="${id}"]`);
			const inline = block?.querySelector("[data-pen-inline-content]");
			if (!(inline instanceof HTMLElement)) {
				return null;
			}
			const walker = document.createTreeWalker(
				inline,
				NodeFilter.SHOW_TEXT,
			);
			let remaining = at;
			let target: Text | null = null;
			let offsetInNode = 0;
			while (walker.nextNode()) {
				const node = walker.currentNode;
				if (!(node instanceof Text)) {
					continue;
				}
				if (remaining <= node.data.length) {
					target = node;
					offsetInNode = remaining;
					break;
				}
				remaining -= node.data.length;
			}
			if (!target) {
				return null;
			}
			const range = document.createRange();
			if (offsetInNode < target.data.length) {
				range.setStart(target, offsetInNode);
				range.setEnd(target, offsetInNode + 1);
			} else if (offsetInNode > 0) {
				range.setStart(target, offsetInNode - 1);
				range.setEnd(target, offsetInNode);
			} else {
				return null;
			}
			const rects = [...range.getClientRects()].filter(
				(rect) => rect.width > 0 || rect.height > 0,
			);
			const box = rects[0];
			if (!box) {
				return null;
			}
			return {
				left: offsetInNode < target.data.length ? box.left : box.right,
				top: box.top,
				height: box.height,
			};
		},
		{ id: blockId, at: offset },
	);
}

scenario(
	"G1: hello-world inline is a text node, not per-character spans",
	async (s, page) => {
		const loads = logLoad("G1-spans");
		await s.load("hello-world");
		await clickOffset(page, HELLO_ID, HELLO_MID);
		const shape = await readInlineShape(page, HELLO_ID);
		await test.info().attach("g1-spans", {
			body: JSON.stringify({ loadavg: loads, shape }, null, 2),
			contentType: "application/json",
		});

		expect(
			shape,
			formatCheckReport(
				"G1: inline content is mounted",
				shape ? "passed" : "failed",
			),
		).not.toBeNull();
		expect(
			shape!.textNodeCount,
			formatCheckReport(
				"G1: text lives in text nodes (Range.getClientRects target)",
				shape!.textNodeCount > 0 ? "passed" : "failed",
				`textNodeCount=${shape!.textNodeCount}`,
			),
		).toBeGreaterThan(0);
		expect(
			shape!.charSpanCount,
			formatCheckReport(
				"G1: never per-character spans",
				shape!.charSpanCount === 0 ? "passed" : "failed",
				`charSpanCount=${shape!.charSpanCount} elementChildCount=${shape!.elementChildCount}`,
			),
		).toBe(0);
	},
);

scenario(
	"G1: caretRect at a latin offset matches native Range.getClientRects",
	async (s, page) => {
		const loads = logLoad("G1-rects");
		await s.load("hello-world");
		await clickOffset(page, HELLO_ID, HELLO_MID);
		await s.geometry.invalidate();
		const compare = await s.geometry.compare([
			{ blockId: HELLO_ID, offset: HELLO_MID, affinity: "downstream" },
		]);
		const native = await readNativeCaretBox(page, HELLO_ID, HELLO_MID);
		const pen =
			compare.compares[0]?.fromScratch ?? compare.compares[0]?.cached;
		await test.info().attach("g1-rects", {
			body: JSON.stringify(
				{ loadavg: loads, compare, native, pen },
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			native,
			formatCheckReport(
				"G1: native Range.getClientRects produced ink",
				native ? "passed" : "failed",
			),
		).not.toBeNull();
		expect(
			pen,
			formatCheckReport(
				"G1: GeometryReader caretRect produced ink",
				pen ? "passed" : "failed",
				`missing=${compare.missingCount}`,
			),
		).not.toBeNull();
		const dx = Math.abs(pen!.left - native!.left);
		const dy = Math.abs(pen!.top - native!.top);
		const dh = Math.abs(pen!.height - native!.height);
		expect(
			dx <= 1 && dy <= 1 && dh <= 1,
			formatCheckReport(
				"G1: Pen caretRect matches native getClientRects within 1px",
				dx <= 1 && dy <= 1 && dh <= 1 ? "passed" : "failed",
				`dx=${dx} dy=${dy} dh=${dh} pen=${JSON.stringify(pen)} native=${JSON.stringify(native)}`,
			),
		).toBe(true);
	},
);

scenario(
	"G1: atom caretRect comes from the atom host element, not a text-node slice",
	async (s, page) => {
		const loads = logLoad("G1-atom");
		await s.load("hello-world");
		await s.apply([
			{
				type: "splice-text",
				blockId: HELLO_ID,
				from: HELLO_MID,
				to: HELLO_MID,
				insert: {
					nodeType: "mention",
					props: { id: "user-ada", label: "Ada" },
				},
			},
		]);
		await expect(page.locator("[data-pen-inline-atom]")).toBeVisible();
		await clickOffset(page, HELLO_ID, HELLO_MID);
		await s.geometry.invalidate();
		const compare = await s.geometry.compare([
			{ blockId: HELLO_ID, offset: HELLO_MID, affinity: "downstream" },
		]);
		const atom = await page.evaluate(() => {
			const node = document.querySelector(
				"[data-pen-inline-atom], [data-pen-inline-atom-host]",
			);
			if (!(node instanceof HTMLElement)) {
				return null;
			}
			const box = node.getBoundingClientRect();
			return {
				left: box.left,
				right: box.right,
				top: box.top,
				height: box.height,
			};
		});
		const pen =
			compare.compares[0]?.fromScratch ?? compare.compares[0]?.cached;
		await test.info().attach("g1-atom", {
			body: JSON.stringify(
				{ loadavg: loads, compare, atom, pen },
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			atom,
			formatCheckReport(
				"G1: mention atom host is measurable",
				atom ? "passed" : "failed",
			),
		).not.toBeNull();
		expect(
			pen,
			formatCheckReport(
				"G1: caretRect at the atom edge is measurable",
				pen ? "passed" : "failed",
			),
		).not.toBeNull();
		const onHost =
			pen!.left + 1 >= atom!.left - 2 && pen!.left <= atom!.right + 2;
		expect(
			onHost,
			formatCheckReport(
				"G1: atom caretRect sits on the atom host box",
				onHost ? "passed" : "failed",
				`pen.left=${pen!.left} atom=${JSON.stringify(atom)}`,
			),
		).toBe(true);
	},
);
