import { expect, type Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { scenario } from "../../src/scenario";

/**
 * P focus targets (W3.R16, D18): the revealed sink for block and cell
 * selections, the editor root for `null`, never a block element. Escape
 * writes the record and its projection places focus.
 */

const BLOCK_ID = "hello-p1";

async function activeTarget(page: Page): Promise<string> {
	return page.evaluate(() => {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) return "none";
		if (active.hasAttribute("data-pen-focus-sink")) {
			const hidden = active.getAttribute("aria-hidden") === "true";
			return `sink:${active.getAttribute("role") ?? "none"}:${hidden ? "hidden" : "revealed"}`;
		}
		if (active.hasAttribute("data-pen-editor-root")) return "root";
		if (active.closest("[data-block-id]")) return "block-or-field";
		return active === document.body ? "body" : "other";
	});
}

async function clickInText(page: Page, offset: number): Promise<void> {
	const point = await getInlineOffsetPoint(page, { blockId: BLOCK_ID, offset });
	await page.mouse.click(point.x, point.y);
	await expect.poll(() => activeTarget(page)).toBe("block-or-field");
}

scenario(
	"HOST9: Escape from a text caret leaves focus on the revealed sink",
	async (s, page) => {
		await s.load("hello-world");
		await clickInText(page, 3);
		await s.keyboard.press("Escape");
		await expect
			.poll(() => page.evaluate(() => window.__penConformance.selection?.type))
			.toBe("block");
		await expect.poll(() => activeTarget(page)).toBe("sink:group:revealed");
	},
);

scenario(
	"HOST9: Escape from a block selection to null leaves focus on the editor root",
	async (s, page) => {
		await s.load("hello-world");
		await clickInText(page, 3);
		await s.keyboard.press("Escape");
		await expect.poll(() => activeTarget(page)).toBe("sink:group:revealed");
		await s.keyboard.press("Escape");
		await expect
			.poll(() => page.evaluate(() => window.__penConformance.selection))
			.toBeNull();
		await expect.poll(() => activeTarget(page)).toBe("root");
	},
);

scenario("P: deactivate with a block selection focuses the sink", async (s, page) => {
	await s.load("hello-world");
	await s.apply([
		{
			type: "insert-block",
			blockId: "focus-divider",
			blockType: "divider",
			props: {},
			position: "last",
		},
	]);
	await clickInText(page, 2);
	const divider = page.locator('[data-block-id="focus-divider"]');
	await divider.click();
	await expect
		.poll(() => page.evaluate(() => window.__penConformance.selection))
		.toMatchObject({ type: "block", blockIds: ["focus-divider"] });
	await expect.poll(() => activeTarget(page)).toBe("sink:group:revealed");
});
