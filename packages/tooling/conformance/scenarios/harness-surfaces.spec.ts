import { expect } from "@playwright/test";
import { scenario } from "../src/scenario";

/**
 * SCALE6 groundwork: the harness mounts the same session on the React, Vue,
 * and vanilla surfaces. Each must be live — editable through its own field
 * editor — before any renderer count on it is trusted.
 */
for (const surface of ["react", "vue", "vanilla"] as const) {
	scenario(
		`SCALE1: the ${surface} surface mounts the harness session and takes typing`,
		async (s, page) => {
			await s.load("hello-world");
			await expect(page.locator("[data-pen-editor-root]")).toHaveCount(1);
			await page.evaluate(() => window.__penConformance.focusText(0));
			await page.keyboard.press("End");
			await page.keyboard.type(" again");

			await expect
				.poll(() => page.evaluate(() => window.__penConformance.documentText))
				.toBe("Hello world again");
		},
		{ url: `/?surface=${surface}` },
	);
}
