import { expect, type Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../src/domGeometry";
import { scenario } from "../src/scenario";

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
		const caretPoint = await getInlineOffsetPoint(page, {
			blockId: "hello-p1",
			offset: 2,
		});
		await page.mouse.click(caretPoint.x, caretPoint.y);

		const caret = page.locator("[data-pen-editor-caret]");
		await expect(caret).toBeVisible();
		await expect(caret).toHaveAttribute("data-block-id", "hello-p1");
		await expect(caret).toHaveAttribute("data-offset", "2");

		const collapsed = await page.evaluate(() => {
			const caretElement = document.querySelector(
				"[data-pen-editor-caret]",
			);
			const overlay = document.querySelector("[data-pen-overlay-layer]");
			const surface = document.querySelector(
				"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
			);
			if (
				!(caretElement instanceof HTMLElement) ||
				!(overlay instanceof HTMLElement) ||
				!(surface instanceof HTMLElement)
			) {
				return null;
			}
			const rect = caretElement.getBoundingClientRect();
			return {
				// No blink token on this URL: the host animation token
				// resolves to none (the 500ms type-pause is retired).
				animationName: getComputedStyle(caretElement).animationName,
				caretColor: surface.style.caretColor,
				overlayVisible: overlay.hasAttribute("data-caret-visible"),
				width: rect.width,
				height: rect.height,
				left: rect.left,
				top: rect.top,
			};
		});
		expect(collapsed).not.toBeNull();
		expect(collapsed?.animationName).toBe("none");
		expect(collapsed?.caretColor).toBe("transparent");
		expect(collapsed?.overlayVisible).toBe(true);
		expect(collapsed?.width).toBeGreaterThan(0);
		expect(collapsed?.height).toBeGreaterThan(0);
		expect(collapsed?.left).toBeGreaterThan(0);
		expect(collapsed?.top).toBeGreaterThan(0);

		const rangeStart = await getInlineOffsetPoint(page, {
			blockId: "hello-p1",
			offset: 1,
		});
		await page.mouse.click(rangeStart.x, rangeStart.y);
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
		const expanded = await page.evaluate(() => {
			const overlay = document.querySelector("[data-pen-overlay-layer]");
			const surface = document.querySelector(
				"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
			);
			return {
				overlayVisible:
					overlay instanceof HTMLElement &&
					overlay.hasAttribute("data-caret-visible"),
				caretColor:
					surface instanceof HTMLElement ? surface.style.caretColor : null,
			};
		});
		expect(expanded.overlayVisible).toBe(false);
		expect(expanded.caretColor).not.toBe("transparent");
	},
	{ url: CUSTOM_CARET },
);

scenario(
	"F39 O: typing restarts the caret blink once per character with no timer",
	async (s, page) => {
		await s.load("hello-world");
		const caretPoint = await getInlineOffsetPoint(page, {
			blockId: "hello-p1",
			offset: 2,
		});
		await page.mouse.click(caretPoint.x, caretPoint.y);
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
