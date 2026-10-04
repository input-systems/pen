import { expect, type Page } from "@playwright/test";
import { scenario } from "../src/scenario";

const AX3_URL = "/?ax3=1";
const BOLD = '[data-pen-toolbar] [data-pen-toolbar-toggle][data-format="bold"]';
const FIELD = "[data-pen-field-editor-active-surface]";

/** Counts the press events that reach the document, in order. */
async function recordPressEvents(page: Page): Promise<void> {
	await page.evaluate(() => {
		const seen: string[] = [];
		(window as Window & { __ax3Press?: string[] }).__ax3Press = seen;
		for (const type of ["pointerdown", "mousedown"] as const) {
			document.addEventListener(type, () => seen.push(type), true);
		}
	});
}

async function pressEvents(page: Page): Promise<string[]> {
	return page.evaluate(() => (window as Window & { __ax3Press?: string[] }).__ax3Press ?? []);
}

/**
 * AX3: a toolbar pointer press keeps focus in the field by preventing the
 * `mousedown` default only. Cancelling `pointerdown` would suppress the
 * compatibility mouse events, so no `mousedown` would reach host handlers,
 * document outside-press listeners or composed triggers.
 */
scenario(
	"AX3: a toolbar pointer press still fires mousedown and keeps focus in the field",
	async (s, page) => {
		await s.load("hello-world");
		await expect(page.locator(FIELD)).toBeFocused();
		await recordPressEvents(page);

		await page.locator(BOLD).click();

		expect(await pressEvents(page)).toEqual(["pointerdown", "mousedown"]);
		await expect(page.locator(FIELD)).toBeFocused();
		await expect(page.locator(BOLD)).toHaveAttribute("aria-pressed", "true");
	},
	{ url: AX3_URL },
);

scenario(
	"AX3: a toolbar pointer press closes an open slash menu and keeps focus in the field",
	async (s, page) => {
		await s.load("hello-world", { pointer: false });
		const blockId = await page.evaluate(() => window.__penConformance.blockIds[0]!);
		await s.apply([{ type: "splice-text", blockId, from: 0, to: 11, insert: "" }]);
		await s.keyboard.type("/head");
		await expect(page.locator("[data-pen-slash-menu-item]").first()).toBeVisible();
		// The unstyled harness lays the open menu over the toolbar; lift the
		// toolbar clear of it so the press lands on the control.
		await page.locator("[data-pen-toolbar]").first().evaluate((toolbar: HTMLElement) => {
			Object.assign(toolbar.style, { position: "fixed", right: "0", bottom: "0", zIndex: "2147483647" });
		});

		await page.locator(BOLD).click();

		await expect(page.locator("[data-pen-slash-menu-item]")).toHaveCount(0);
		await expect(page.locator(FIELD)).toBeFocused();
	},
	{ url: AX3_URL },
);
