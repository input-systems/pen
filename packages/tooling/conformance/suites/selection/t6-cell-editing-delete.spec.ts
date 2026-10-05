import { expect, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";

const TABLE_ID = "t6-delete-table";

function cellSurface(page: Page) {
	return page
		.locator(
			`[data-block-id="${TABLE_ID}"] [data-cell-row="0"][data-cell-col="0"] [data-pen-field-editor-surface]`,
		)
		.first();
}

async function readSelectionType(page: Page): Promise<string | null> {
	return page.evaluate(() => window.__penConformance.selection?.type ?? null);
}

scenario(
	"T6/A1: Backspace and Delete in an edited cell remove the range or one grapheme, never the cell",
	async (s, page) => {
		await s.load("hello-world");
		await s.apply([
			{
				type: "insert-block",
				blockId: TABLE_ID,
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: TABLE_ID,
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "Looks like",
			},
		]);

		const cell = cellSurface(page);
		await expect(cell).toBeVisible();
		await cell.dblclick();
		await expect(
			page.locator("[data-pen-field-editor-active-surface]"),
		).toBeVisible();
		await page.keyboard.press("End");

		await page.keyboard.press("Shift+ArrowLeft");
		await page.keyboard.press("Shift+ArrowLeft");
		await page.keyboard.press("Backspace");
		await expect(cell).toHaveText("Looks li");

		await page.keyboard.press("Backspace");
		await expect(cell).toHaveText("Looks l");

		await page.keyboard.press("Home");
		await page.keyboard.press("Delete");
		await expect(cell).toHaveText("ooks l");

		await page.keyboard.press("Shift+ArrowRight");
		await page.keyboard.press("Shift+ArrowRight");
		await page.keyboard.press("Delete");
		await expect(cell).toHaveText("ks l");

		expect(await readSelectionType(page)).toBe("cell");
	},
);
