import { expect, test } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import {
	blockBox,
	expectCheck,
	itemsOfKind,
	near,
	readSettledLayer,
} from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import { attachJson, attachLoadavg, readSelection } from "../specHelpers";

const DIVIDER_ID = "o3-d1";
const AFTER_ID = "two-p1";
const TABLE_ID = "o3-table";

scenario(
	"O3: clicking a divider becomes BlockSelection drawn as an overlay outline",
	async (s, page) => {
		await s.load("two-paragraph");
		await s.apply([
			{
				type: "insert-block",
				blockId: DIVIDER_ID,
				blockType: "divider",
				props: {},
				position: { after: AFTER_ID },
			},
		]);
		const divider = page.locator(
			`[data-pen-editor-block][data-block-id="${DIVIDER_ID}"]`,
		);
		await expect(divider).toBeVisible();
		await divider.click();

		const selection = await readSelection(page);
		const layer = await readSettledLayer(page);
		const outlines = itemsOfKind(layer, "block-outline");
		const box = await blockBox(page, DIVIDER_ID);
		const selected = await divider.evaluate((node) =>
			node.hasAttribute("data-selected"),
		);
		await attachLoadavg("o3-block", { selection, layer, box, selected });

		expect(selection).toMatchObject({ type: "block", blockIds: [DIVIDER_ID] });
		expect(
			outlines.map((item) => item.blockId),
			formatCheckReport("O3: one outline names the divider", outlines.length === 1 ? "passed" : "failed"),
		).toEqual([DIVIDER_ID]);
		const outline = outlines[0]!;
		expectCheck(
			"O3: the outline sits on the divider's box within 1px",
			near(outline.box.left, box.left) &&
				near(outline.box.top, box.top) &&
				near(outline.box.width, box.width) &&
				near(outline.box.height, box.height),
			`outline=${JSON.stringify(outline.box)} block=${JSON.stringify(box)}`,
		);
		expect(itemsOfKind(layer, "caret"), "O3: no caret during block selection").toEqual([]);
		expect(selected, "O3: data-selected stays as a styling hook").toBe(true);
	},
);

scenario(
	"O3: a grid cell selection draws one cell-range outline around the selected cells",
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
		]);
		const cell = (row: number, col: number) =>
			page
				.locator(
					`[data-pen-editor-block][data-block-id="${TABLE_ID}"] [data-pen-table-cell][data-cell-row="${row}"][data-cell-col="${col}"]`,
				)
				.first();
		await expect(cell(0, 0)).toBeVisible();
		await cell(0, 0).click();
		await expect
			.poll(() => readSelection(page))
			.toMatchObject({ type: "cell", blockId: TABLE_ID });
		await page.keyboard.press("Shift+ArrowRight");
		await page.keyboard.press("Shift+ArrowDown");
		await expect
			.poll(() => readSelection(page))
			.toMatchObject({
				type: "cell",
				blockId: TABLE_ID,
				anchor: { row: 0, col: 0 },
				head: { row: 1, col: 1 },
			});

		const layer = await readSettledLayer(page);
		const ranges = itemsOfKind(layer, "cell-range");
		const corners = await page.evaluate((blockId) => {
			const box = (row: number, col: number) => {
				const node = document.querySelector(
					`[data-pen-editor-block][data-block-id="${blockId}"] [data-pen-table-cell][data-cell-row="${row}"][data-cell-col="${col}"]`,
				);
				const rect = node?.getBoundingClientRect();
				return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
			};
			return { start: box(0, 0), end: box(1, 1) };
		}, TABLE_ID);
		await attachJson("o3-cell", { layer, corners });

		expect(ranges).toHaveLength(1);
		const range = ranges[0]!;
		expect(range.blockId).toBe(TABLE_ID);
		expect(corners.start).not.toBeNull();
		expect(corners.end).not.toBeNull();
		expectCheck(
			"O3: the cell outline covers anchor..head",
			near(range.box.left, corners.start!.left) &&
				near(range.box.top, corners.start!.top) &&
				near(range.box.right, corners.end!.right) &&
				near(range.box.bottom, corners.end!.bottom),
			`range=${JSON.stringify(range.box)} cells=${JSON.stringify(corners)}`,
		);
		expect(itemsOfKind(layer, "caret")).toEqual([]);
	},
);

scenario(
	"O3: a block selection of more than 50 blocks paints one span and at most two block reads",
	async (s, page) => {
		test.setTimeout(120_000);
		await s.load("scale-1k", { pointer: false });
		const ids = await page.evaluate(() => window.__penConformance.preorderBlockIds);
		expect(ids.length).toBeGreaterThan(50);

		await page.evaluate(() => window.__penConformance.startOverlayProbe());
		await page.evaluate((blockIds) => {
			window.__penConformance.selectBlocksById(blockIds);
		}, ids);
		const layer = await readSettledLayer(page);
		const counts = await page.evaluate(() =>
			window.__penConformance.stopOverlayProbe(),
		);
		await attachJson("o3-span", { counts, items: layer.items });

		const spans = itemsOfKind(layer, "block-span");
		expect(itemsOfKind(layer, "block-outline")).toEqual([]);
		expect(spans).toHaveLength(1);
		expect(spans[0]!.fromBlockId).toBe(ids[0]);
		expect(spans[0]!.toBlockId).toBe(ids[ids.length - 1]);
		// Per flush: a flush that ran queued writes re-reads once in a
		// paint-only follow-up (OV1 stale-after-write), so the window total
		// counts that flush too.
		expect(
			counts.maxBlockRectReadsPerFlush,
			formatCheckReport(
				"O3: a contiguous run costs at most two block reads per flush",
				counts.maxBlockRectReadsPerFlush <= 2 ? "passed" : "failed",
				`per-flush max=${counts.maxBlockRectReadsPerFlush} total=${counts.blockRectReads} flushes=${counts.flushes}`,
			),
		).toBeLessThanOrEqual(2);
	},
);
