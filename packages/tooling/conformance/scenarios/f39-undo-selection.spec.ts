import { expect, type Page } from "@playwright/test";
import { scenario } from "../src/scenario";
import { blockInlineText, clickOffset, readFocus } from "../suites/specHelpers";

function historyBridge(page: Page) {
	return {
		async undo() {
			await page.evaluate(() => {
				window.__penConformance.undo();
			});
		},
		async redo() {
			await page.evaluate(() => {
				window.__penConformance.redo();
			});
		},
		async stopCapturing() {
			await page.evaluate(() => {
				window.__penConformance.stopCapturing();
			});
		},
	};
}

async function focusOffset(page: Page): Promise<number | undefined> {
	return (await readFocus(page))?.offset;
}

async function focusBlockId(page: Page): Promise<string | undefined> {
	return (await readFocus(page))?.blockId;
}

scenario(
	"F39: restores logical selection on undo and redo",
	async (s, page) => {
		const history = historyBridge(page);
		await s.load("hello-world");
		await clickOffset(page, "hello-p1", 2);
		await s.assert.selectionEquals({
			anchor: { blockId: "hello-p1", offset: 2 },
			focus: { blockId: "hello-p1", offset: 2 },
		});
		await s.keyboard.type("X");

		await s.assert.textContains("HeXllo world");
		await s.assert.selectionEquals({
			anchor: { blockId: "hello-p1", offset: 3 },
			focus: { blockId: "hello-p1", offset: 3 },
		});

		await history.undo();
		await expect
			.poll(() =>
				page.evaluate(() => {
					const selection = window.__penConformance.selection;
					if (selection?.type !== "text") {
						return "";
					}
					return `${selection.anchor.offset}:${selection.focus.offset}:${window.__penConformance.isCollapsed()}`;
				}),
			)
			.toBe("2:2:true");
		await expect
			.poll(() =>
				page.evaluate(() => window.__penConformance.documentText),
			)
			.toBe("Hello world");
		await s.assert.selectionEquals({
			anchor: { blockId: "hello-p1", offset: 2 },
			focus: { blockId: "hello-p1", offset: 2 },
		});
		await s.assert.domMatchesAuthority();

		await history.redo();
		await expect
			.poll(() =>
				page.evaluate(() => window.__penConformance.documentText),
			)
			.toBe("HeXllo world");
		await expect.poll(() => focusOffset(page)).toBe(3);
		await s.assert.textContains("HeXllo world");
		await s.assert.domMatchesAuthority();
	},
);

scenario(
	"F39: moves the DOM caret across blocks on undo and redo",
	async (s, page) => {
		const history = historyBridge(page);
		await s.load("hello-world");
		await clickOffset(page, "hello-p1", 11);
		await s.assert.selectionEquals({
			anchor: { blockId: "hello-p1", offset: 11 },
			focus: { blockId: "hello-p1", offset: 11 },
		});
		await s.keyboard.press("Enter");

		const insertedBlockId = await focusBlockId(page);
		expect(insertedBlockId).toBeTruthy();
		expect(insertedBlockId).not.toBe("hello-p1");
		await s.assert.selectionEquals({
			anchor: { blockId: insertedBlockId!, offset: 0 },
			focus: { blockId: insertedBlockId!, offset: 0 },
		});
		await s.assert.domMatchesAuthority();

		await history.undo();
		await expect.poll(() => focusBlockId(page)).toBe("hello-p1");
		await expect.poll(() => focusOffset(page)).toBe(11);
		expect(
			await page.evaluate(() => window.__penConformance.blockIds),
		).toEqual(["hello-p1"]);
		await s.assert.selectionEquals({
			anchor: { blockId: "hello-p1", offset: 11 },
			focus: { blockId: "hello-p1", offset: 11 },
		});
		await s.assert.domMatchesAuthority();

		await history.redo();
		await expect
			.poll(() =>
				page.evaluate(() => window.__penConformance.blockIds.length),
			)
			.toBe(2);
		const redoneIds = await page.evaluate(
			() => window.__penConformance.blockIds,
		);
		const redoneBlockId = redoneIds.find((id) => id !== "hello-p1");
		expect(redoneBlockId).toBeTruthy();
		await expect(
			page.locator(`[data-pen-editor-block][data-block-id="${redoneBlockId}"]`),
		).toBeVisible();
		await s.assert.domMatchesAuthority();
	},
);

scenario(
	"F39: reconciles repeated history changes outside activeBlockIds during expanded editing",
	async (s, page) => {
		const history = historyBridge(page);
		await s.load("two-paragraph");
		await s.apply([
			{
				type: "insert-block",
				blockId: "f39-p3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "f39-p3",
				from: 0,
				to: 0,
				insert: "Third",
			},
		]);
		// own undo items; yjs otherwise groups by capture timeout
		await history.stopCapturing();

		// single-block editing: the jsdom original (selectedTextDeletion.20)
		await clickOffset(page, "two-p1", 0);
		await s.assert.selectionEquals({
			anchor: { blockId: "two-p1", offset: 0 },
			focus: { blockId: "two-p1", offset: 0 },
		});

		await s.apply([
			{
				type: "splice-text",
				blockId: "f39-p3",
				from: 5,
				to: 5,
				insert: "!",
			},
		]);
		await history.stopCapturing();
		await s.apply([
			{
				type: "splice-text",
				blockId: "f39-p3",
				from: 6,
				to: 6,
				insert: "?",
			},
		]);
		await expect
			.poll(() => blockInlineText(page, "f39-p3"))
			.toBe("Third!?");

		await history.undo();
		await expect
			.poll(() => blockInlineText(page, "f39-p3"))
			.toBe("Third!");
		await history.undo();
		await expect
			.poll(() => blockInlineText(page, "f39-p3"))
			.toBe("Third");
		await history.redo();
		await expect
			.poll(() => blockInlineText(page, "f39-p3"))
			.toBe("Third!");
		await history.redo();
		await expect
			.poll(() => blockInlineText(page, "f39-p3"))
			.toBe("Third!?");
	},
);
