import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import { G5_WRAP_BLOCK } from "../../src/g5Geometry";
import { FocusPoint, midpoint } from "../specHelpers";

async function readFocusPoint(page: Page): Promise<FocusPoint> {
	return page.evaluate(() => {
		const selection = window.__penConformance.selection;
		if (selection?.type !== "text") {
			return null;
		}
		return {
			blockId: selection.focus.blockId,
			offset: selection.focus.offset,
		};
	});
}

async function readGeometryDiagnostics(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		window.__penConformance.diagnostics
			.filter((event) => event.code === "caret-geometry-unavailable")
			.map((event) => event.code),
	);
}

/** Same narrow width the G5 algorithm scenario uses to force two line boxes. */
async function forceWrap(page: Page): Promise<void> {
	await page.evaluate((blockId) => {
		const block = document.querySelector(`[data-block-id="${blockId}"]`);
		if (!(block instanceof HTMLElement)) {
			return;
		}
		block.style.maxWidth = "40px";
		const inline = block.querySelector("[data-pen-inline-content]");
		if (!(inline instanceof HTMLElement)) {
			return;
		}
		inline.style.display = "block";
		inline.style.width = "40px";
		inline.style.maxWidth = "40px";
		inline.style.font =
			'16px / 20px ui-monospace, "Courier New", Menlo, monospace';
		inline.style.wordBreak = "break-all";
		inline.style.overflowWrap = "anywhere";
	}, G5_WRAP_BLOCK);
}

scenario(
	"G5: ArrowDown from mid-paragraph lands on the visually adjacent block",
	async (s, page) => {
		await s.load("two-paragraph");
		await s.selectText(0, 6);

		const before = await readFocusPoint(page);
		await page.keyboard.press("ArrowDown");
		const after = await readFocusPoint(page);
		const diagnostics = await readGeometryDiagnostics(page);

		await test.info().attach("g5-arrow-down-across-blocks", {
			body: JSON.stringify({ before, after, diagnostics }, null, 2),
			contentType: "application/json",
		});

		expect(
			after?.blockId,
			formatCheckReport(
				"G5: live ArrowDown mid-paragraph crosses to the next block",
				after?.blockId === "two-p2" ? "passed" : "failed",
				`focus ${JSON.stringify(before)} -> ${JSON.stringify(after)}; diagnostics=${JSON.stringify(diagnostics)}`,
			),
		).toBe("two-p2");
		expect(
			diagnostics,
			formatCheckReport(
				"G5: no caret-geometry-unavailable diagnostic",
				diagnostics.length === 0 ? "passed" : "failed",
				`the host never registered a vertical caret measure: ${JSON.stringify(diagnostics)}`,
			),
		).toEqual([]);
		await s.assert.domMatchesAuthority();
	},
);

scenario(
	"G5: ArrowDown from the first wrapped line lands on the next line of the same block",
	async (s, page) => {
		await s.load("g5-geometry");
		await forceWrap(page);
		await s.geometry.invalidate();
		await expect
			.poll(
				async () =>
					(await s.geometry.lineBoxes(G5_WRAP_BLOCK)).length,
			)
			.toBeGreaterThanOrEqual(2);

		const lines = await s.geometry.lineBoxes(G5_WRAP_BLOCK);
		const firstLine = lines[0];
		expect(
			firstLine,
			"G5 wrapped keystroke: expected a first line box",
		).toBeTruthy();
		await s.selectText(0, midpoint(firstLine!));

		const before = await readFocusPoint(page);
		await page.keyboard.press("ArrowDown");
		const after = await readFocusPoint(page);
		const diagnostics = await readGeometryDiagnostics(page);

		await test.info().attach("g5-arrow-down-wrapped-line", {
			body: JSON.stringify(
				{ lines, before, after, diagnostics },
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			after?.blockId,
			formatCheckReport(
				"G5: live ArrowDown stays inside the wrapped block",
				after?.blockId === G5_WRAP_BLOCK ? "passed" : "failed",
				`focus ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
			),
		).toBe(G5_WRAP_BLOCK);
		expect(
			after?.offset ?? -1,
			formatCheckReport(
				"G5: live ArrowDown reaches the second wrapped line",
				(after?.offset ?? -1) >= firstLine!.endOffset
					? "passed"
					: "failed",
				`offset ${before?.offset} -> ${after?.offset}, first line ends at ${firstLine!.endOffset}; diagnostics=${JSON.stringify(diagnostics)}`,
			),
		).toBeGreaterThanOrEqual(firstLine!.endOffset);
		expect(
			diagnostics,
			formatCheckReport(
				"G5: no caret-geometry-unavailable diagnostic",
				diagnostics.length === 0 ? "passed" : "failed",
				`the host never registered a vertical caret measure: ${JSON.stringify(diagnostics)}`,
			),
		).toEqual([]);
	},
);
