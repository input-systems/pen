import { expect, test, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";

test.skip(
	({ browserName }) => browserName !== "chromium",
	"Chromium only: the R1 window transitions are engine-neutral state",
);

/** Runs `move` on block 0 and resolves once its `selectionchange` arrived. */
async function moveNativeRange(
	page: Page,
	move: "element-start" | { anchor: number; focus: number },
) {
	await page.evaluate(async (move) => {
		const inline = document.querySelector("[data-pen-inline-content]")!;
		const text = document
			.createTreeWalker(inline, NodeFilter.SHOW_TEXT)
			.nextNode()!;
		const changed = new Promise<void>((resolve) => {
			document.addEventListener("selectionchange", () => resolve(), {
				once: true,
			});
		});
		const selection = document.getSelection()!;
		if (move === "element-start") {
			selection.collapse(inline, 0);
		} else {
			selection.setBaseAndExtent(text, move.anchor, text, move.focus);
		}
		await changed;
	}, move);
}

async function record(page: Page) {
	return page.evaluate(async () => {
		await window.__penConformance.whenIdle();
		const state = window.__penConformance.selectionRecord?.state;
		return state?.type === "text"
			? [state.anchor.offset, state.focus.offset]
			: null;
	});
}

scenario(
	"R1: the selectionchange after contextmenu closes the window even when it echoes the record",
	async (s, page) => {
		await s.load("two-paragraph", { pointer: false });
		await s.selectText(0, 0);
		expect(await record(page)).toEqual([0, 0]);

		await page.evaluate(() => {
			document
				.querySelector("[data-pen-inline-content]")!
				.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		});
		// A different raw range at the same logical caret: step 3 echo.
		await moveNativeRange(page, "element-start");
		expect(await record(page)).toEqual([0, 0]);

		// The window is closed, so a later out-of-gesture range is
		// divergence: refused and projected back (I4, P2).
		await moveNativeRange(page, { anchor: 2, focus: 5 });
		await expect.poll(() => record(page)).toEqual([0, 0]);
		await s.assert.domMatchesAuthority();
	},
);
