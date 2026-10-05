import { expect, type Page } from "@playwright/test";
import { readCaretOverlay } from "../src/overlayLayer";
import { scenario } from "../src/scenario";
import { clickOffset } from "../suites/specHelpers";

const CUSTOM_CARET = "/?customCaret=1";

type CaretIdentity = { epoch: number; tagged: boolean };

/** The caret's blink epoch, and whether it is still the node `tagCaret` marked. */
async function caretIdentity(page: Page): Promise<CaretIdentity | null> {
	return page.evaluate(() => {
		const caret = document.querySelector("[data-pen-editor-caret]");
		if (!(caret instanceof HTMLElement)) {
			return null;
		}
		return {
			epoch: Number(caret.getAttribute("data-pen-caret-epoch")),
			tagged: (caret as HTMLElement & { __f39?: boolean }).__f39 === true,
		};
	});
}

async function tagCaret(page: Page): Promise<void> {
	await page.evaluate(() => {
		const caret = document.querySelector("[data-pen-editor-caret]");
		if (caret instanceof HTMLElement) {
			(caret as HTMLElement & { __f39?: boolean }).__f39 = true;
		}
	});
}

scenario(
	"F39 HOST6: renders a custom local caret for collapsed selections only",
	async (s, page) => {
		await s.load("hello-world");
		await clickOffset(page, "hello-p1", 2);

		const caret = page.locator("[data-pen-editor-caret]");
		await expect(caret).toBeVisible();
		await expect(caret).toHaveAttribute("data-block-id", "hello-p1");
		await expect(caret).toHaveAttribute("data-offset", "2");

		// No blink token on this URL: the host animation token resolves to
		// none (the 500ms type-pause is retired).
		expect(await caret.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
		const collapsed = await readCaretOverlay(page);
		expect(collapsed.caretColor).toBe("transparent");
		expect(collapsed.caretVisible).toBe(true);
		expect(collapsed.caret?.width).toBeGreaterThan(0);
		expect(collapsed.caret?.height).toBeGreaterThan(0);
		expect(collapsed.caret?.left).toBeGreaterThan(0);
		expect(collapsed.caret?.top).toBeGreaterThan(0);

		await clickOffset(page, "hello-p1", 1);
		await page.keyboard.down("Shift");
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowRight");
		await page.keyboard.up("Shift");
		await expect
			.poll(() =>
				page.evaluate(() => {
					const selection = window.__penConformance.selection;
					return (
						selection?.type === "text" &&
						!window.__penConformance.isCollapsed()
					);
				}),
			)
			.toBe(true);
		await expect(page.locator("[data-pen-editor-caret]")).toHaveCount(0);
		const expanded = await readCaretOverlay(page);
		expect(expanded.caretVisible).toBe(false);
		expect(expanded.caretColor).not.toBe("transparent");
	},
	{ url: CUSTOM_CARET },
);

scenario(
	"F39 O: typing restarts the caret blink once per character with no timer",
	async (s, page) => {
		await s.load("hello-world");
		await clickOffset(page, "hello-p1", 2);
		await expect(page.locator("[data-pen-editor-caret]")).toHaveCount(1);
		const start = await caretIdentity(page);
		expect(start).not.toBeNull();

		// One character per step: each user commit restarts the blink by
		// replacing the caret element in the write phase (D9). No clock: the
		// step waits on the epoch attribute itself.
		let epoch = start!.epoch;
		for (const character of ["a", "b", "c"]) {
			await tagCaret(page);
			await page.keyboard.type(character);
			await expect
				.poll(async () => (await caretIdentity(page))?.epoch)
				.toBe(epoch + 1);
			const after = await caretIdentity(page);
			expect(after?.tagged, `F39 O: "${character}" replaced the caret node`).toBe(
				false,
			);
			epoch += 1;
		}
		expect(epoch - start!.epoch).toBe(3);
		expect(
			await page.evaluate(() => window.__penConformance.documentText),
		).toContain("Heabcllo");
	},
	{ url: CUSTOM_CARET },
);
