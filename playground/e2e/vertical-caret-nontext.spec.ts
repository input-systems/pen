import { expect, test } from "@playwright/test";
import {
	clickParagraphText,
	openPlayground,
	readFocusSinkOwnsDocumentFocus,
	readSelection,
	replaceWithParagraphThenNonText,
} from "./penPlayground.utils";

test.describe("N2 / G5 / HOST9 vertical caret onto non-text", () => {
	test("ArrowDown onto an image writes BlockSelection and parks focus on the sink", async ({
		page,
	}) => {
		await openPlayground(page);
		const { paragraphId, nonTextId } = await replaceWithParagraphThenNonText(
			page,
			{ blockId: "e2e-image", blockType: "image" },
		);

		await clickParagraphText(page, paragraphId);
		await page.keyboard.press("ArrowDown");

		await expect
			.poll(async () => readSelection(page))
			.toEqual({
				type: "block",
				blockIds: [nonTextId],
				head: nonTextId,
			});
		await expect
			.poll(async () => readFocusSinkOwnsDocumentFocus(page))
			.toBe(true);
	});

	test("ArrowDown onto a table enters its first-row edge cell (T5)", async ({
		page,
	}) => {
		await openPlayground(page);
		const { paragraphId, nonTextId } = await replaceWithParagraphThenNonText(
			page,
			{ blockId: "e2e-table", blockType: "table" },
		);

		await clickParagraphText(page, paragraphId);
		await page.keyboard.press("ArrowDown");

		await expect
			.poll(async () => {
				const selection = await readSelection(page);
				if (selection?.type !== "cell") {
					return selection;
				}
				return {
					type: selection.type,
					blockId: selection.blockId,
					anchor: selection.anchor,
					head: selection.head,
				};
			})
			.toEqual({
				type: "cell",
				blockId: nonTextId,
				anchor: { row: 0, col: 0 },
				head: { row: 0, col: 0 },
			});
	});
});
