import { expect, type Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { scenario } from "../../src/scenario";

const SURFACES = [
	{ suffix: "", url: undefined },
	{ suffix: " (vue)", url: "/?surface=vue" },
	{ suffix: " (vanilla)", url: "/?surface=vanilla" },
] as const;

async function clickAt(page: Page, blockId: string, offset: number, shift = false): Promise<void> {
	const point = await getInlineOffsetPoint(page, { blockId, offset });
	// `mouse.click` takes no modifiers; hold Shift on the keyboard.
	if (shift) await page.keyboard.down("Shift");
	await page.mouse.click(point.x, point.y);
	if (shift) await page.keyboard.up("Shift");
}

async function textSelection(page: Page): Promise<string> {
	return page.evaluate(() => {
		const state = window.__penConformance.selectionRecord?.state ?? null;
		if (state?.type !== "text") return `not text: ${JSON.stringify(state)}`;
		return `${state.anchor.blockId}:${state.anchor.offset} -> ${state.focus.blockId}:${state.focus.offset}`;
	});
}

/**
 * R1, S2: a shift-click in another block extends the selection from the
 * caret to that block's far edge (the range the content gestures form), on
 * every binding; vanilla and Vue used to collapse to the clicked point. The
 * standing S2 check after each step compares the DOM with the authority.
 */
for (const { suffix, url } of SURFACES) {
	scenario(
		`R1 S2: a shift-click in a later block extends the caret to the end of that block${suffix}`,
		async (s, page) => {
			await s.load("two-paragraph");
			await clickAt(page, "two-p1", 2);
			await expect.poll(() => textSelection(page)).toBe("two-p1:2 -> two-p1:2");

			await clickAt(page, "two-p2", 3, true);
			await expect.poll(() => textSelection(page)).toBe("two-p1:2 -> two-p2:18");
			const check = await page.evaluate(() => window.__penConformance.domMatchesAuthority());
			expect(check.ok, check.reason).toBe(true);
		},
		{ url },
	);

	scenario(
		`R1 S2: a shift-click in an earlier block extends the caret back to the start of that block${suffix}`,
		async (s, page) => {
			await s.load("two-paragraph");
			await clickAt(page, "two-p2", 4);
			await expect.poll(() => textSelection(page)).toBe("two-p2:4 -> two-p2:4");

			await clickAt(page, "two-p1", 1, true);
			await expect.poll(() => textSelection(page)).toBe("two-p2:4 -> two-p1:0");
			const check = await page.evaluate(() => window.__penConformance.domMatchesAuthority());
			expect(check.ok, check.reason).toBe(true);
		},
		{ url },
	);
}
