import { expect, test } from "@playwright/test";
import { scenario } from "../../src/scenario";
import { readDocumentText } from "./compose";

scenario(
	"S2 FE2: a composition over a cross-block range deletes the range and composes in the caret's field",
	async (s, page) => {
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));

		await s.load("two-paragraph");
		await page.evaluate(() => {
			window.__penConformance.selectTextRangeById(
				{ blockId: "two-p1", offset: 6 },
				{ blockId: "two-p2", offset: 6 },
			);
		});
		await page.evaluate(() => window.__penConformance.whenIdle());

		// Firefox delivers insertText as a composition, which the expanded
		// host cannot cancel; the other engines send a plain insertText.
		await page.keyboard.insertText("ñ");
		await page.keyboard.type("o");
		await page.evaluate(() => window.__penConformance.whenIdle());

		expect(pageErrors).toEqual([]);
		await expect.poll(() => readDocumentText(page)).toBe("Alpha ñoecho foxtrot");
		await s.assert.domMatchesAuthority();
		const selection = await page.evaluate(
			() => window.__penConformance.selection,
		);
		expect(selection).toMatchObject({
			type: "text",
			anchor: { blockId: "two-p1", offset: 8 },
			focus: { blockId: "two-p1", offset: 8 },
		});
		if (test.info().project.name === "firefox") {
			const compositionStarts = await page.evaluate(
				() =>
					(window as { __compositionStarts?: number }).__compositionStarts ?? 0,
			);
			expect(compositionStarts, "Firefox composes insertText").toBeGreaterThan(0);
		}
	},
	{
		initScript: () => {
			const counted = window as { __compositionStarts?: number };
			counted.__compositionStarts = 0;
			document.addEventListener(
				"compositionstart",
				() => {
					counted.__compositionStarts = (counted.__compositionStarts ?? 0) + 1;
				},
				true,
			);
		},
	},
);
