import { expect, type Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import type { ScenarioApi } from "../../src/types";
import {
	attachLoadavg,
	clickOffset,
	readSelection,
} from "../specHelpers";

const P1_ID = "two-p1";
const P2_ID = "two-p2";
const DIVIDER_ID = "n2-d1";
const P1_TEXT = "Alpha bravo charlie";
const P2_TEXT = "Delta echo foxtrot";
const CUT = 2;
const PREFIX = P1_TEXT.slice(0, CUT);

async function readSnapshot(page: Page) {
	return page.evaluate(() => window.__penConformance.documentSnapshot());
}

async function dragFromParagraphOntoDivider(page: Page): Promise<void> {
	await clickOffset(page, P1_ID, CUT);
	const from = await getInlineOffsetPoint(page, {
		blockId: P1_ID,
		offset: CUT,
	});
	const divider = page.locator(`[data-block-id="${DIVIDER_ID}"]`);
	await expect(divider).toBeVisible();
	const box = await divider.boundingBox();
	expect(
		box,
		formatCheckReport(
			"N2: divider is on screen for the drag",
			box ? "passed" : "failed",
		),
	).toBeTruthy();
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.8, {
		steps: 10,
	});
	await page.mouse.up();
}

async function insertDivider(s: ScenarioApi): Promise<void> {
	await s.apply([
		{
			type: "insert-block",
			blockId: DIVIDER_ID,
			blockType: "divider",
			props: {},
			position: { after: P1_ID },
		},
	]);
}

async function expectPrefixKept(page: Page, label: string): Promise<void> {
	const afterDelete = await readSnapshot(page);
	await attachLoadavg(label, afterDelete);
	const p1 = afterDelete.blocks.find((block) => block.id === P1_ID);
	const dividerBlock = afterDelete.blocks.find(
		(block) => block.id === DIVIDER_ID,
	);
	const p2 = afterDelete.blocks.find((block) => block.id === P2_ID);
	expect(
		p1?.text,
		formatCheckReport(
			"N2: paragraph prefix survived",
			p1?.text === PREFIX ? "passed" : "failed",
			`p1=${p1?.text ?? "missing"} ids=${afterDelete.blockOrder.join(",")}`,
		),
	).toBe(PREFIX);
	expect(
		dividerBlock,
		formatCheckReport(
			"N2: divider was deleted",
			dividerBlock == null ? "passed" : "failed",
			`ids=${afterDelete.blockOrder.join(",")}`,
		),
	).toBeUndefined();
	expect(
		p2?.text,
		formatCheckReport(
			"N2: following paragraph was not deleted",
			p2?.text === P2_TEXT ? "passed" : "failed",
			`p2=${p2?.text ?? "missing"}`,
		),
	).toBe(P2_TEXT);
}

scenario(
	"N2: Backspace on a pointer mixed-boundary range keeps the paragraph prefix",
	async (s, page) => {
		await s.load("two-paragraph");
		await insertDivider(s);
		await dragFromParagraphOntoDivider(page);
		const afterDrag = await readSelection(page);
		await attachLoadavg("n2-mixed-boundary-drag", afterDrag);
		await page.keyboard.press("Backspace");
		await expectPrefixKept(page, "n2-mixed-boundary-delete");
	},
);

scenario(
	"N2: Delete on a pointer mixed-boundary range matches Backspace",
	async (s, page) => {
		await s.load("two-paragraph");
		await insertDivider(s);
		await dragFromParagraphOntoDivider(page);
		const afterDrag = await readSelection(page);
		await attachLoadavg("n2-mixed-boundary-delete-key-drag", afterDrag);
		await page.keyboard.press("Delete");
		await expectPrefixKept(page, "n2-mixed-boundary-delete-key");
	},
);
