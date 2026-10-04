import { expect, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import type { SerializedSelection } from "../../src/types";
import {
	attachLoadavg,
	clickOffset,
	readSelection,
} from "../../src/specHelpers";

const TWO_P2_TEXT = "Delta echo foxtrot";
const SELECT_ALL = process.platform === "darwin" ? "Meta+a" : "Control+a";

async function escalateToBlockSelection(page: Page): Promise<SerializedSelection> {
	await page.keyboard.press(SELECT_ALL);
	await page.keyboard.press(SELECT_ALL);
	return readSelection(page);
}

scenario(
	"T4: ArrowDown from a multi-block BlockSelection lands a caret at the end of head",
	async (s, page) => {
		await s.load("two-paragraph");
		await clickOffset(page, "two-p1", 0);
		await s.assert.selectionEquals({
			anchor: { blockId: "two-p1", offset: 0 },
			focus: { blockId: "two-p1", offset: 0 },
		});

		const afterSelectAll = await escalateToBlockSelection(page);
		await attachLoadavg("t4-arrowdown-block", afterSelectAll);
		expect(
			afterSelectAll,
			formatCheckReport(
				"T4: two Mod-a keystrokes become BlockSelection",
				afterSelectAll?.type === "block" ? "passed" : "failed",
				`selection=${JSON.stringify(afterSelectAll)}`,
			),
		).toMatchObject({
			type: "block",
			blockIds: ["two-p1", "two-p2"],
		});

		await page.keyboard.press("ArrowDown");
		const afterArrow = await readSelection(page);
		await attachLoadavg("t4-arrowdown-after", afterArrow);
		expect(
			afterArrow,
			formatCheckReport(
				"T4: ArrowDown collapses to a caret at the end of head",
				afterArrow?.type === "text" &&
					afterArrow.focus.blockId === "two-p2" &&
					afterArrow.focus.offset === TWO_P2_TEXT.length
					? "passed"
					: "failed",
				`selection=${JSON.stringify(afterArrow)}`,
			),
		).toMatchObject({
			type: "text",
			anchor: { blockId: "two-p2", offset: TWO_P2_TEXT.length },
			focus: { blockId: "two-p2", offset: TWO_P2_TEXT.length },
		});
	},
);

scenario(
	"T4: Shift+ArrowUp from a multi-block BlockSelection shrinks blockIds at head",
	async (s, page) => {
		await s.load("two-paragraph");
		await clickOffset(page, "two-p1", 0);
		await s.assert.selectionEquals({
			anchor: { blockId: "two-p1", offset: 0 },
			focus: { blockId: "two-p1", offset: 0 },
		});

		const afterSelectAll = await escalateToBlockSelection(page);
		expect(
			afterSelectAll,
			formatCheckReport(
				"T4: two Mod-a keystrokes become BlockSelection",
				afterSelectAll?.type === "block" ? "passed" : "failed",
				`selection=${JSON.stringify(afterSelectAll)}`,
			),
		).toMatchObject({
			type: "block",
			blockIds: ["two-p1", "two-p2"],
		});

		await page.keyboard.press("Shift+ArrowUp");
		const afterShift = await readSelection(page);
		await attachLoadavg("t4-shift-arrowup", afterShift);
		expect(
			afterShift,
			formatCheckReport(
				"T4: Shift+ArrowUp shrinks blockIds at head",
				afterShift?.type === "block" &&
					afterShift.blockIds.length === 1 &&
					afterShift.blockIds[0] === "two-p1"
					? "passed"
					: "failed",
				`selection=${JSON.stringify(afterShift)}`,
			),
		).toMatchObject({
			type: "block",
			blockIds: ["two-p1"],
		});
	},
);
