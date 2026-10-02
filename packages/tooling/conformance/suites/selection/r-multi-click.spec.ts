import { expect, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";

/** Viewport point at the middle of the first block's second character. */
async function pointInFirstWord(page: Page): Promise<{ x: number; y: number }> {
	return page.evaluate(() => {
		const inline = document.querySelector("[data-pen-inline-content]")!;
		const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
		const text = walker.nextNode()!;
		const range = document.createRange();
		range.setStart(text, 1);
		range.setEnd(text, 2);
		const rect = range.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	});
}

async function selectionShape(page: Page): Promise<string> {
	return page.evaluate(() => {
		const state = window.__penConformance.selectionRecord?.state ?? null;
		if (state?.type !== "text") return `not text: ${JSON.stringify(state)}`;
		if (state.anchor.blockId !== state.focus.blockId) return "multi-block";
		return state.anchor.offset === state.focus.offset
			? "collapsed"
			: "range";
	});
}

scenario(
	"R1 S2: a double-click word selection reaches the authority through the reader and the DOM matches it",
	async (s, page) => {
		await s.load("hello-world");
		const point = await pointInFirstWord(page);
		await page.mouse.dblclick(point.x, point.y);

		await expect.poll(() => selectionShape(page)).toBe("range");
		const check = await page.evaluate(() =>
			window.__penConformance.domMatchesAuthority(),
		);
		expect(check.ok, check.reason).toBe(true);
	},
);

scenario(
	"R1 S2: a triple-click leaves the DOM equivalent to the authority",
	async (s, page) => {
		await s.load("hello-world");
		const point = await pointInFirstWord(page);
		await page.mouse.click(point.x, point.y, { clickCount: 3 });

		await expect
			.poll(async () => {
				const check = await page.evaluate(() =>
					window.__penConformance.domMatchesAuthority(),
				);
				return check.ok ? "ok" : (check.reason ?? "mismatch");
			})
			.toBe("ok");
	},
);
