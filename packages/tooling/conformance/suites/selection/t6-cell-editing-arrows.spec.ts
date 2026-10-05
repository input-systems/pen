import { expect, test, type Page } from "@playwright/test";
import { loadavg } from "node:os";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import { installKeyProbe, readKeyProbe } from "../input/keys";

const TABLE_ID = "t6-edit-table";

async function readNativeCellOffset(page: Page): Promise<number | null> {
	return page.evaluate(() => {
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface][data-cell-row][data-cell-col]",
		);
		if (!(surface instanceof HTMLElement)) {
			return null;
		}
		const selection = surface.ownerDocument.getSelection();
		if (!selection || selection.rangeCount === 0) {
			return null;
		}
		const range = selection.getRangeAt(0);
		if (!surface.contains(range.startContainer)) {
			return null;
		}
		const prefix = surface.ownerDocument.createRange();
		prefix.selectNodeContents(surface);
		prefix.setEnd(range.startContainer, range.startOffset);
		return prefix.toString().length;
	});
}

async function readSelectionType(page: Page): Promise<string | null> {
	return page.evaluate(() => window.__penConformance.selection?.type ?? null);
}

async function readCellTextFocus(page: Page): Promise<number | null> {
	return page.evaluate(() => {
		const selection = window.__penConformance.selection;
		return selection?.type === "cell"
			? (selection.text?.focus ?? null)
			: null;
	});
}

scenario(
	"T6: ArrowLeft in an edited cell is a caret command and moves the cell caret",
	async (s, page) => {
		const loads = loadavg();
		console.log(`T6-cell-edit-arrows loadavg ${loads.join(" ")}`);

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
				insert: "cell",
			},
		]);

		const cell = page
			.locator(
				`[data-block-id="${TABLE_ID}"] [data-cell-row="0"][data-cell-col="0"]`,
			)
			.first();
		await expect(cell).toBeVisible();
		await cell.dblclick();
		await expect(
			page.locator("[data-pen-field-editor-active-surface]"),
		).toBeVisible();

		await installKeyProbe(page);
		const before = await readNativeCellOffset(page);
		await page.keyboard.press("ArrowLeft");
		const after = await readNativeCellOffset(page);
		const probe = await readKeyProbe(page);
		const arrow = probe.find((entry) => entry.key === "ArrowLeft");
		const selectionType = await readSelectionType(page);
		const textFocus = await readCellTextFocus(page);

		await test.info().attach("t6-cell-edit-arrow", {
			body: JSON.stringify(
				{
					loadavg: loads,
					before,
					after,
					probe,
					selectionType,
					textFocus,
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			arrow ? "seen" : "missing",
			formatCheckReport(
				"T6: ArrowLeft reached the edited cell",
				arrow ? "passed" : "failed",
				`probe=${JSON.stringify(probe)}`,
			),
		).toBe("seen");
		expect(
			arrow!.defaultPrevented,
			formatCheckReport(
				"T6: cell-editing ArrowLeft preventDefaults",
				arrow!.defaultPrevented ? "passed" : "failed",
				`defaultPrevented=${arrow!.defaultPrevented}`,
			),
		).toBe(true);
		expect(
			before != null && after != null && after === before - 1,
			formatCheckReport(
				"T6: cell caret stepped one grapheme left",
				before != null && after != null && after === before - 1
					? "passed"
					: "failed",
				`offset ${before} → ${after}`,
			),
		).toBe(true);
		expect(
			selectionType,
			formatCheckReport(
				"T6: in-cell arrow leaves CellSelection on the authority",
				selectionType === "cell" ? "passed" : "failed",
				`selectionType=${selectionType}`,
			),
		).toBe("cell");
		expect(
			textFocus,
			formatCheckReport(
				"T6: the moved cell caret is the authority's CellSelection.text",
				textFocus !== null && textFocus === after ? "passed" : "failed",
				`text.focus=${textFocus} native=${after}`,
			),
		).toBe(after);
	},
);
