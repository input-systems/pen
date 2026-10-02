import { expect } from "@playwright/test";
import { scenario } from "../../src/scenario";

scenario(
	"P1: an engine-rejected write is reported, not retried",
	async (s, page) => {
		await s.load("hello-world");
		await s.selectText(0, 2);
		s.expectDiagnostic("selection-projection-mismatch");
		await page.evaluate(() => window.__penConformance.installSelectionWriteFault());
		await page.evaluate(() => {
			const blockId = window.__penConformance.blockIds[0]!;
			window.__penConformance.selectTextById(blockId, 4, 4);
		});
		await expect
			.poll(() =>
				page.evaluate(() =>
					window.__penConformance.diagnostics.filter(
						(event) => event.code === "selection-projection-mismatch",
					).length,
				),
			)
			.toBe(1);
		const fault = await page.evaluate(() => window.__penConformance.selectionWriteFault);
		expect(fault.dropped).toBe(1);
		// The projection wrote once, saw the mismatch, and did not write again.
		expect(fault.writes).toBe(1);
	},
	{ axe: false },
);
