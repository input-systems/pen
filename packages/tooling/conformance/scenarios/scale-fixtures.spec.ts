import { mixedFixtureIdentity } from "@input/pen-test";
import { expect, test } from "@playwright/test";
import {
	SCALE_FIXTURE_ROOT_COUNTS,
	type ScaleFixtureName,
} from "../fixtures/catalog";
import { scenario } from "../src/scenario";

/**
 * SCALE1: the scale fixtures mount whole in a real browser with the counts
 * their arithmetic states. 10k and 50k run in the nightly large job
 * (`SCALE_FIXTURES=all`); PRs mount 1k and 5k.
 */
const PR_FIXTURES: readonly ScaleFixtureName[] = ["scale-1k", "scale-5k"];
const NIGHTLY_FIXTURES: readonly ScaleFixtureName[] = ["scale-10k", "scale-50k"];
const FIXTURES =
	process.env.SCALE_FIXTURES === "all"
		? [...PR_FIXTURES, ...NIGHTLY_FIXTURES]
		: PR_FIXTURES;

for (const name of FIXTURES) {
	scenario(
		`SCALE1: ${name} mounts every block with the identity its arithmetic states`,
		async (s, page) => {
			test.setTimeout(240_000);
			const identity = mixedFixtureIdentity(SCALE_FIXTURE_ROOT_COUNTS[name]);
			await s.load(name);

			await expect
				.poll(() => page.locator("[data-pen-editor-block]").count(), {
					timeout: 120_000,
				})
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
