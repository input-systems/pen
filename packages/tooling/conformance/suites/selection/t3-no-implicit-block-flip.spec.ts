import { expect, test, type Page } from "@playwright/test";
import type { DocumentOp } from "@input/pen-types";
import { loadavg } from "node:os";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import type { ScenarioApi, SerializedSelection } from "../../src/types";
import { readSelection } from "../specHelpers";

const BLOCK_COUNT = 51;
const FIRST_ID = "empty-p1";
const LAST_ID = "t3-p50";
const LAST_TEXT = "P50";

/**
 * Tall enough for all 51 paragraphs, so the pointer drag is one uninterrupted
 * sweep. Scrolling between `mouse.down` and `mouse.move` is a different
 * scenario: WebKit runs its own drag autoscroll against the programmatic
 * scroll, the pointer ends over a block the caller never measured, and the
 * range comes back short — under the >50 blocks this test exists to cross.
 */
const TALL_VIEWPORT = { width: 1280, height: 2000 };

/**
 * T3: a large pointer range stays TextSelection. The v1 count flip
 * (`shouldUseBlockSelection` → `selectBlocks` at >50) is a read
 * escalation, same family as the deleted block-type threshold.
 * Surface mode `block` is a different thing and is not asserted here.
 */

async function seedFiftyOneParagraphs(s: ScenarioApi, page: Page): Promise<void> {
	await s.load("empty");
	const ops: DocumentOp[] = [
		{
			type: "splice-text",
			blockId: FIRST_ID,
			from: 0,
			to: 0,
			insert: "P00"
		},
	];
	for (let index = 1; index < BLOCK_COUNT; index += 1) {
		const blockId = `t3-p${String(index).padStart(2, "0")}`;
		ops.push(
			{
				type: "insert-block",
				blockId,
				blockType: "paragraph",
				props: {},
				position: "last"
			},
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: `P${String(index).padStart(2, "0")}`
			},
		);
	}
	await s.apply(ops);
	await expect(page.locator("[data-pen-editor-block]")).toHaveCount(
		BLOCK_COUNT,
	);
}

async function clickOffset(
	page: Page,
	blockId: string,
	offset: number,
): Promise<void> {
	const block = page.locator(`[data-block-id="${blockId}"]`);
	await block.scrollIntoViewIfNeeded();
	const point = await getInlineOffsetPoint(page, { blockId, offset });
	await page.mouse.click(point.x, point.y);
}

async function dragFirstToLast(page: Page): Promise<void> {
	const from = await getInlineOffsetPoint(page, {
		blockId: FIRST_ID,
		offset: 0
	});
	const to = await getInlineOffsetPoint(page, {
		blockId: LAST_ID,
		offset: LAST_TEXT.length
	});
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 24 });
	await page.mouse.up();
}

async function shiftClickLast(page: Page): Promise<void> {
	const last = page.locator(
		`[data-block-id="${LAST_ID}"] [data-pen-inline-content]`,
	);
	await last.scrollIntoViewIfNeeded();
	await last.click({ modifiers: ["Shift"] });
}

function attachLoadavg(label: string, payload: unknown): Promise<void> {
	const loads = loadavg();
	console.log(`${label} loadavg ${loads.join(" ")}`);
	return test.info().attach(label, {
		body: JSON.stringify({ loadavg: loads, payload }, null, 2),
		contentType: "application/json"
	});
}

function expectFiftyOneBlockText(
	selection: SerializedSelection,
	label: string,
): void {
	const isTextRange =
		selection?.type === "text" &&
		!selection.isCollapsed &&
		selection.anchor.blockId === FIRST_ID &&
		selection.focus.blockId === LAST_ID;
	expect(
		selection,
		formatCheckReport(
			label,
			isTextRange ? "passed" : "failed",
			`selection=${JSON.stringify(selection)}`,
		),
	).toMatchObject({
		type: "text",
		anchor: { blockId: FIRST_ID },
		focus: { blockId: LAST_ID }
	});
}

scenario(
	"T3: 51-block pointer drag stays a multi-block text selection",
	async (s, page) => {
		test.setTimeout(60_000);
		await page.setViewportSize(TALL_VIEWPORT);
		await seedFiftyOneParagraphs(s, page);
		await dragFirstToLast(page);
		const afterDrag = await readSelection(page);
		await attachLoadavg("t3-51-block-drag", afterDrag);
		expectFiftyOneBlockText(
			afterDrag,
			"T3: 51-block drag stays TextSelection",
		);
	},
);

scenario(
	"T3: 51-block Shift+click stays a multi-block text selection",
	async (s, page) => {
		test.setTimeout(60_000);
		await seedFiftyOneParagraphs(s, page);
		await clickOffset(page, FIRST_ID, 0);
		await s.assert.selectionEquals({
			anchor: { blockId: FIRST_ID, offset: 0 },
			focus: { blockId: FIRST_ID, offset: 0 }
		});
		await shiftClickLast(page);
		const afterShift = await readSelection(page);
		await attachLoadavg("t3-51-block-shift-click", afterShift);
		expectFiftyOneBlockText(
			afterShift,
			"T3: 51-block Shift+click stays TextSelection",
		);
	},
);
