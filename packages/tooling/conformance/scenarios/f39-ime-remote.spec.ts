import { expect } from "@playwright/test";
import { scenario } from "../src/scenario";

scenario(
	"F39 C2: preserves remote edits that land during IME composition",
	async (s, page) => {
		await s.load("hello-world");
		await s.keyboard.press("End");

		const surface = page.locator(
			"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
		);
		await surface.dispatchEvent("compositionstart");

		await page.evaluate(() => {
			window.__penConformance.remoteApply([
				{
					type: "splice-text",
					blockId: "hello-p1",
					from: 0,
				to: 0,
				insert: "X",
				},
			]);
		});

		const during = await page.evaluate(() => ({
			authority: window.__penConformance.documentText,
			dom:
				document.querySelector("[data-pen-inline-content]")
					?.textContent ?? "",
		}));
		expect(during.authority).toContain("XHello");
		expect(during.dom, "C2: the composed field DOM is untouched").not.toContain(
			"X",
		);

		await surface.dispatchEvent("compositionend");

		await expect
			.poll(() =>
				page.evaluate(() => window.__penConformance.documentText),
			)
			.toContain("XHello");
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						document.querySelector("[data-pen-inline-content]")
							?.textContent ?? "",
				),
			)
			.toContain("XHello");
		await s.assert.textContains("XHello");
		await s.assert.domMatchesAuthority();
	},
	{
		initScript: () => {
			delete (globalThis as { EditContext?: unknown }).EditContext;
			delete (window as { EditContext?: unknown }).EditContext;
		},
	},
);
