import { expect, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";
import { clickOffset, readSelection } from "../specHelpers";

/**
 * HOST9, P1: a record a `selectionChange` listener writes supersedes the record it
 * was called for, and the projection ends at the newer one.
 */

const FIRST_ID = "hello-p1";
const LAST_TEXT_ID = "clamp-p3";
const DIVIDER_ID = "clamp-divider";

async function readRangeAndFocus(page: Page) {
	return page.evaluate((dividerId) => {
		const domSelection = document.getSelection();
		const range =
			domSelection && domSelection.rangeCount > 0
				? domSelection.getRangeAt(0)
				: null;
		const divider = document.querySelector(`[data-block-id="${dividerId}"]`);
		const root = document.querySelector("[data-pen-editor-root]");
		return {
			rangeReachesDivider:
				range !== null && divider !== null && range.intersectsNode(divider),
			focusInEditor: root !== null && root.contains(document.activeElement),
		};
	}, DIVIDER_ID);
}

scenario(
	"HOST9, P1: select-all a listener rewrites projects the rewritten range and keeps focus",
	async (s, page) => {
		await s.load("hello-world");
		await s.apply([
			{ type: "insert-block", blockId: "clamp-p2", blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: "clamp-p2", from: 0, to: 0, insert: "Second" },
			{ type: "insert-block", blockId: LAST_TEXT_ID, blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: LAST_TEXT_ID, from: 0, to: 0, insert: "Third" },
			{ type: "insert-block", blockId: DIVIDER_ID, blockType: "divider", props: {}, position: "last" },
		]);
		await page.evaluate(
			(dividerId) => window.__penConformance.installSelectionRewriteListener(dividerId),
			DIVIDER_ID,
		);
		await clickOffset(page, FIRST_ID, 2);
		await s.keyboard.press("ControlOrMeta+a");
		await expect
			.poll(() => readSelection(page))
			.toMatchObject({
				type: "text",
				anchor: { blockId: FIRST_ID, offset: 0 },
				focus: { blockId: LAST_TEXT_ID, offset: 5 },
			});
		await page.evaluate(() => window.__penConformance.whenIdle());
		await s.assert.domMatchesAuthority();
		expect(await readRangeAndFocus(page)).toEqual({
			rangeReachesDivider: false,
			focusInEditor: true,
		});
	},
);
