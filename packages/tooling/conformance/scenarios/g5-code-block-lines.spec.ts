import { expect, type Page } from "@playwright/test";
import {
	CODE_BLOCK_LINES_ID,
	CODE_BLOCK_TRAILING_ID,
} from "../fixtures/catalog";
import { scenario } from "../src/scenario";
import type { GeometryLineBox, ScenarioApi } from "../src/types";
import { readFocus } from "../suites/specHelpers";

async function expectFocus(
	page: Page,
	blockId: string,
	offset: number,
): Promise<void> {
	await expect.poll(async () => readFocus(page)).toEqual({ blockId, offset });
}

async function placeCaret(
	s: ScenarioApi,
	page: Page,
	blockIndex: number,
	offset: number,
): Promise<void> {
	await page.evaluate((index) => {
		window.__penConformance.focusText(index);
	}, blockIndex);
	await s.selectText(blockIndex, offset);
}

async function readLines(
	s: ScenarioApi,
	blockId: string,
	count: number,
): Promise<GeometryLineBox[]> {
	await s.geometry.invalidate();
	await expect
		.poll(async () => (await s.geometry.lineBoxes(blockId)).length)
		.toBe(count);
	return s.geometry.lineBoxes(blockId);
}

async function clickLine(
	page: Page,
	blockId: string,
	line: GeometryLineBox,
	fromLeft: number,
): Promise<void> {
	const box = await page
		.locator(`[data-block-id="${blockId}"] [data-pen-inline-content]`)
		.boundingBox();
	if (!box) {
		throw new Error(`no inline surface for ${blockId}`);
	}
	await page.mouse.click(box.x + fromLeft, (line.top + line.bottom) / 2);
}

scenario("G5: a blank line inside a code block owns a line box", async (s) => {
	await s.load("code-block");
	const lines = await readLines(s, CODE_BLOCK_LINES_ID, 3);
	expect(lines.map((line) => [line.startOffset, line.endOffset])).toEqual([
		[0, 4],
		[4, 5],
		[5, 10],
	]);
});

scenario(
	"G5: ArrowUp from a trailing blank line in a code block steps onto the blank line above",
	async (s, page) => {
		await s.load("code-block");
		await placeCaret(s, page, 2, 5);
		await s.keyboard.press("ArrowUp");
		await expectFocus(page, CODE_BLOCK_TRAILING_ID, 4);
		await s.keyboard.press("ArrowUp");
		await expectFocus(page, CODE_BLOCK_TRAILING_ID, 0);
	},
);

scenario(
	"G5: ArrowDown walks a code block's blank line instead of skipping it",
	async (s, page) => {
		await s.load("code-block");
		await placeCaret(s, page, 1, 0);
		await s.keyboard.press("ArrowDown");
		await expectFocus(page, CODE_BLOCK_LINES_ID, 4);
		await s.keyboard.press("ArrowDown");
		await expectFocus(page, CODE_BLOCK_LINES_ID, 5);
	},
);

scenario(
	"G4: a click on a code block's blank line places the caret on that line",
	async (s, page) => {
		await s.load("code-block");
		const lines = await readLines(s, CODE_BLOCK_LINES_ID, 3);
		await clickLine(page, CODE_BLOCK_LINES_ID, lines[1]!, 40);
		await expectFocus(page, CODE_BLOCK_LINES_ID, 4);
	},
);

scenario(
	"G4: a click on a code block's blank line collapses an existing selection onto that line",
	async (s, page) => {
		await s.load("code-block");
		await placeCaret(s, page, 1, 5);
		await s.keyboard.press("Shift+End");
		await expect
			.poll(async () =>
				page.evaluate(() => window.__penConformance.isCollapsed()),
			)
			.toBe(false);
		const lines = await readLines(s, CODE_BLOCK_LINES_ID, 3);
		await clickLine(page, CODE_BLOCK_LINES_ID, lines[1]!, 40);
		await expectFocus(page, CODE_BLOCK_LINES_ID, 4);
	},
);

scenario(
	"G4 / G5: after a click on a code block text line, arrows move line by line",
	async (s, page) => {
		await s.load("code-block");
		const lines = await readLines(s, CODE_BLOCK_LINES_ID, 3);
		// right of "there", so the click lands at the end of the line
		await clickLine(page, CODE_BLOCK_LINES_ID, lines[2]!, 200);
		await expectFocus(page, CODE_BLOCK_LINES_ID, 10);
		await s.keyboard.press("ArrowUp");
		await expectFocus(page, CODE_BLOCK_LINES_ID, 4);
		await s.keyboard.press("ArrowUp");
		await expectFocus(page, CODE_BLOCK_LINES_ID, 3);
	},
);
