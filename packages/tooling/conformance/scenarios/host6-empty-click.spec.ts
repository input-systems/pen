import { expect, test } from "@playwright/test";
import { analyzeEditorWcag22Aa, formatAxeViolations } from "../src/axeSurface";

test("HOST6: empty unstyled document activates from an editor-root click", async ({
	page,
}) => {
	await page.goto("/?unstyled=1&customCaret=1");
	await page.evaluate(() => {
		window.__penConformance.load("empty");
	});
	await expect(page.locator('[data-fixture="empty"]')).toBeVisible();
	await expect(page.locator("[data-pen-editor-root]")).toBeVisible();

	const metrics = await page.evaluate(() => {
		const root = document.querySelector("[data-pen-editor-root]");
		const inline = document.querySelector("[data-pen-inline-content]");
		if (!(root instanceof HTMLElement) || !(inline instanceof HTMLElement)) {
			return null;
		}
		const rootBox = root.getBoundingClientRect();
		const inlineBox = inline.getBoundingClientRect();
		const x = rootBox.left + rootBox.width / 2;
		const y = rootBox.top + rootBox.height / 2;
		const hit = document.elementFromPoint(x, y);
		return {
			inlineWidth: inlineBox.width,
			inlineHeight: inlineBox.height,
			rootWidth: rootBox.width,
			rootHeight: rootBox.height,
			hitTag: hit instanceof HTMLElement ? hit.tagName.toLowerCase() : null,
			hitInline: hit instanceof HTMLElement && hit === inline,
			stylesheets: [...document.styleSheets]
				.map((sheet) => sheet.href)
				.filter((href) => href != null && href.includes("styles.css")),
		};
	});

	expect(metrics).not.toBeNull();
	expect(metrics?.stylesheets).toEqual([]);
	expect(metrics?.inlineWidth).toBe(0);
	expect(metrics?.inlineHeight).toBeGreaterThan(0);
	expect(metrics?.hitInline).toBe(false);

	const rootBox = await page.locator("[data-pen-editor-root]").boundingBox();
	expect(rootBox).not.toBeNull();
	if (!rootBox) {
		return;
	}
	await page.mouse.click(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);

	const caret = page.locator("[data-pen-editor-caret]");
	await expect(caret).toBeVisible();
	await expect(caret).toHaveAttribute("data-block-id", "empty-p1");
	const caretBox = await caret.boundingBox();
	expect(caretBox).not.toBeNull();
	expect(caretBox?.width).toBeGreaterThan(0);
	expect(caretBox?.height).toBeGreaterThan(0);

	await page.keyboard.type("x");

	const after = await page.evaluate(() => ({
		documentText: window.__penConformance.documentText,
		activeSurface: Boolean(
			document.querySelector("[data-pen-field-editor-active-surface]"),
		),
	}));
	expect(after.activeSurface).toBe(true);
	expect(after.documentText).toContain("x");

	const results = await analyzeEditorWcag22Aa(page);
	expect(
		results.violations,
		formatAxeViolations(results.violations, "HOST6 empty click: axe WCAG 2.2 AA"),
	).toEqual([]);
});
