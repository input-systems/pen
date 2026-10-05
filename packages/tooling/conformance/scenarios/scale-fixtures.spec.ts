import { mixedFixtureIdentity } from "@input/pen-test";
import { expect, test } from "@playwright/test";
import { SCALE_FIXTURE_ROOT_COUNTS, type ScaleFixtureName } from "../fixtures/catalog";
import { scenario } from "../src/scenario";

/**
 * SCALE1: the scale fixtures mount whole in a real browser with the counts
 * their arithmetic states. PRs mount 1k and 5k; the nightly large job
 * (`SCALE_FIXTURES=all`) adds 10k. 50k is opt-in (`SCALE_FIXTURES=50k`):
 * at 2026-10-02 the React surface does not finish mounting it — the page
 * dies or exceeds 240s on macos-arm64 — until W2's render path lands (D30).
 */
const PR_FIXTURES: readonly ScaleFixtureName[] = ["scale-1k", "scale-5k"];
const FIXTURES_BY_ENV: Readonly<Record<string, readonly ScaleFixtureName[]>> = {
	all: [...PR_FIXTURES, "scale-10k"],
	"50k": ["scale-50k"],
};
const FIXTURES = FIXTURES_BY_ENV[process.env.SCALE_FIXTURES ?? ""] ?? PR_FIXTURES;

for (const name of FIXTURES) {
	scenario(
		`SCALE1: ${name} mounts every block with the identity its arithmetic states`,
		async (_s, page) => {
			test.setTimeout(240_000);
			const identity = mixedFixtureIdentity(SCALE_FIXTURE_ROOT_COUNTS[name]);
			// s.load waits 5s for the first block; a 50k React mount takes longer
			// until W2 (D30), so scale fixtures load with a mount-sized wait.
			await page.evaluate((fixtureName) => {
				window.__penConformance.load(fixtureName);
			}, name);
			await expect(page.locator(`[data-fixture="${name}"]`)).toBeVisible({ timeout: 180_000 });
			await expect
				.poll(() => page.locator("[data-pen-editor-block]").count(), { timeout: 120_000 })
				.toBe(identity.totalBlocks);
			const bridge = await page.evaluate(() => ({
				blockOrder: window.__penConformance.blockIds.length,
				roots: window.__penConformance.rootBlockIds.length,
			}));
			expect(bridge).toEqual({
				blockOrder: identity.blockOrderLength,
				roots: identity.rootCount,
			});
		},
		// AX1 runs axe on the small fixtures; axe over tens of thousands of
		// blocks measures axe, not Pen, and exceeds any useful budget.
		{ axe: false },
	);
}
