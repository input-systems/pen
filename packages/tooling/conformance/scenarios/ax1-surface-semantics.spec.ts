import { expect } from "@playwright/test";
import { analyzeEditorSurface, formatAxeViolations } from "../src/axeSurface";
import { FIXTURE_NAMES } from "../fixtures/catalog";
import { scenario } from "../src/scenario";

for (const fixture of FIXTURE_NAMES) {
	scenario(`AX1: axe surface semantics on ${fixture}`, async (s, page) => {
		await s.load(fixture);
		const results = await analyzeEditorSurface(page);
		expect(
			results.violations,
			formatAxeViolations(results.violations),
		).toEqual([]);
	});
}

scenario(
	"AX1: text editing is a single tab stop in both directions",
	async (s, page) => {
		await s.load("two-paragraph");

		const root = page.locator("[data-pen-editor-root]");
		await root.evaluate((rootElement) => {
			const before = document.createElement("button");
			before.setAttribute("data-ax1-before-editor", "");
			before.textContent = "Before editor";
			rootElement.before(before);
		});
		const before = page.locator("[data-ax1-before-editor]");
		await before.focus();

		await page.keyboard.press("Tab");

		await expect(
			root.locator("[data-pen-field-editor-active-surface]"),
		).toBeFocused();

		await page.keyboard.press("Shift+Tab");

		await expect(before).toBeFocused();
	},
);

scenario(
	"AX1: tabbing back into a block selection focuses its accessible surface",
	async (s, page) => {
		await s.load("two-paragraph");
		await s.apply([
			{
				type: "insert-block",
				blockId: "ax1-divider",
				blockType: "divider",
				props: {},
				position: { after: "two-p1" },
			},
		]);

		await page.locator('[data-block-id="ax1-divider"]').click();
		const root = page.locator("[data-pen-editor-root]");
		const sink = root.locator(":scope > [data-pen-focus-sink]");
		await expect(sink).toHaveAttribute("role", "group");

		await root.evaluate((rootElement) => {
			const before = document.createElement("button");
			before.textContent = "Before editor";
			rootElement.before(before);
			before.focus();
		});
		await expect(root).toHaveAttribute("tabindex", "0");

		await page.keyboard.press("Tab");

		await expect(sink).toBeFocused();
		await expect(root).toHaveAttribute("tabindex", "-1");
	},
);
