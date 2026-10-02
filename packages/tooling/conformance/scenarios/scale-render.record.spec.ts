import { mixedFixtureIdentity, mixedFixtureTargets } from "@input/pen-test";
import type { DocumentOp } from "@input/pen-types";
import { expect, test, type Page } from "@playwright/test";
import {
	SCALE_RENDER_ROOT_COUNTS,
	assertDeterministic,
	compareCounts,
	evaluateInvariants,
	fixtureRecord,
	loadBaseline,
	loadInvariants,
	writeBaseline,
	type ScaleRenderAction,
	type ScaleRenderCountFixture,
	type ScaleRenderCounts,
	type ScaleRenderSurface,
} from "../src/scaleRender";
import { scenario } from "../src/scenario";

/**
 * SCALE6 renderer counts (W1-S5). For each surface and fixture, every action
 * runs K times inside a probe window and must produce identical counts; the
 * counts are then compared exactly against the committed baseline. Record
 * with RECORD_SCALE_RENDER=1 SCALE_RENDER_REASON="…" (workers=1).
 */
const SURFACES: readonly ScaleRenderSurface[] = ["react", "vue", "vanilla"];
const FIXTURES: readonly ScaleRenderCountFixture[] = ["scale-1k", "scale-5k"];
const RECORD = process.env.RECORD_SCALE_RENDER === "1";
const WARMUP = 2;

type Metrics = Record<string, number>;

async function windowed(page: Page, input: () => Promise<void>): Promise<Metrics> {
	await page.evaluate(() => window.__penScaleProbe.begin());
	await input();
	return page.evaluate(() => window.__penScaleProbe.end());
}

async function textLength(page: Page, blockId: string): Promise<number> {
	return page.evaluate(
		(id) => window.__penConformance.blockText(id).length,
		blockId,
	);
}

async function caretAt(page: Page, blockId: string, offset: number | "end"): Promise<void> {
	const at = offset === "end" ? await textLength(page, blockId) : offset;
	await page.evaluate(
		({ id, offset: caret }) => window.__penConformance.selectTextById(id, caret, caret),
		{ id: blockId, offset: at },
	);
}

async function apply(page: Page, ops: DocumentOp[], remote = false): Promise<void> {
	await page.evaluate(
		({ next, isRemote }) =>
			isRemote
				? window.__penConformance.remoteApply(next)
				: window.__penConformance.apply(next),
		{ next: ops, isRemote: remote },
	);
}

async function blockAfter(page: Page, blockId: string): Promise<string> {
	return page.evaluate((id) => {
		const order = window.__penConformance.blockIds;
		return order[order.indexOf(id) + 1] ?? "";
	}, blockId);
}

type ActionScript = {
	readonly repeat: number;
	readonly run: (page: Page, rep: number) => Promise<Metrics>;
};

function actionScripts(fixture: ScaleRenderCountFixture): Record<Exclude<ScaleRenderAction, "mount">, ActionScript> {
	const targets = mixedFixtureTargets(SCALE_RENDER_ROOT_COUNTS[fixture]);
	const enter = (blockId: string): ActionScript => ({
		repeat: 3,
		run: async (page) => {
			await caretAt(page, blockId, "end");
			const metrics = await windowed(page, () => page.keyboard.press("Enter"));
			await apply(page, [{ type: "delete-block", blockId: await blockAfter(page, blockId) }]);
			return metrics;
		},
	});
	const press = (key: string, start: number | "end"): ActionScript => ({
		repeat: 5,
		run: async (page) => {
			await caretAt(page, targets.paragraph, start);
			return windowed(page, () => page.keyboard.press(key));
		},
	});
	return {
		keystroke: {
			repeat: 10,
			run: async (page, rep) => {
				if (rep === 0) await caretAt(page, targets.paragraph, "end");
				// Each repetition types one more character; counts must not care.
				return windowed(page, () => page.keyboard.type("x"));
			},
		},
		caretRight: press("ArrowRight", 0),
		caretDown: press("ArrowDown", "end"),
		shiftDown: press("Shift+ArrowDown", "end"),
		enterParagraph: enter(targets.paragraph),
		enterNumbered: enter(targets.numbered),
		remoteInsert: {
			repeat: 3,
			run: async (page, rep) => {
				const blockId = `remote-insert-${rep}`;
				const metrics = await windowed(page, () =>
					apply(
						page,
						[
							{
								type: "insert-block",
								blockId,
								blockType: "paragraph",
								props: {},
								position: { after: targets.insertAfter },
							},
						],
						true,
					),
				);
				await apply(page, [{ type: "delete-block", blockId }], true);
				return metrics;
			},
		},
	};
}

async function measureMount(page: Page, fixture: ScaleRenderCountFixture): Promise<Metrics> {
	const { totalBlocks } = mixedFixtureIdentity(SCALE_RENDER_ROOT_COUNTS[fixture]);
	await page.evaluate(() => window.__penScaleProbe.begin());
	await page.evaluate((name) => window.__penConformance.load(name), fixture);
	await expect(page.locator(`[data-fixture="${fixture}"]`)).toBeVisible({ timeout: 180_000 });
	await expect
		.poll(() => page.locator("[data-pen-editor-block]").count(), { timeout: 180_000 })
		.toBe(totalBlocks);
	const metrics = await page.evaluate(() => window.__penScaleProbe.end());
	const live = await page.evaluate(() => window.__penScaleProbe.live());
	const blocksMounted = await page.locator("[data-pen-editor-block]").count();
	return { ...metrics, ...live, "mount.blocksMounted": blocksMounted };
}

async function measureFixture(page: Page, surface: ScaleRenderSurface, fixture: ScaleRenderCountFixture): Promise<ScaleRenderCounts> {
	const counts: ScaleRenderCounts = { mount: await measureMount(page, fixture) };
	const { paragraph } = mixedFixtureTargets(SCALE_RENDER_ROOT_COUNTS[fixture]);
	await page.locator(`[data-block-id="${paragraph}"] [data-pen-inline-content]`).first().click();
	for (const [action, script] of Object.entries(actionScripts(fixture))) {
		// The first WARMUP repetitions are discarded: one-time costs (first input
		// after focus, lazy caches, a first remote insert that settles the
		// vanilla tree one record later) are not the steady state counted here.
		const repetitions: Metrics[] = [];
		for (let rep = 0; rep < script.repeat + WARMUP; rep += 1) {
			const metrics = await script.run(page, rep);
			if (rep >= WARMUP) repetitions.push(metrics);
		}
		counts[action as ScaleRenderAction] = assertDeterministic(
			`${surface}/${fixture}/${action}`,
			repetitions,
		);
	}
	return counts;
}

function checkAgainstBaseline(
	surface: ScaleRenderSurface,
	fixture: ScaleRenderCountFixture,
	counts: ScaleRenderCounts,
): string[] {
	const baseline = loadBaseline(surface);
	if (!baseline) return [`SCALE_RENDER_BASELINE_MISSING scale-render.${surface}.chromium.json`];
	const committed = baseline.counts[fixture];
	if (!committed || Object.keys(committed).length === 0) return ["SCALE_RENDER_BASELINE_EMPTY"];
	if (baseline.fixtures[fixture]?.contentSha256 !== fixtureRecord(fixture).contentSha256) {
		return ["fixture generator changed — re-record (RECORD_SCALE_RENDER=1)"];
	}
	const merged = { ...baseline.counts, [fixture]: counts };
	return [
		...compareCounts(surface, fixture, committed, counts).failures,
		...evaluateInvariants(surface, merged, loadInvariants()),
	];
}

/**
 * Vue at 5k exceeds a 600s test today: every caret move is O(M²) across its
 * per-block selection reads (W2-S6's subject). Until that lands it runs only
 * under SCALE_RENDER_5K=1 (nightly), with a longer budget. React moved to the
 * block notifier in W2-S5 and runs at 5k on every run.
 */
const SLOW_UNTIL_W2 = new Set(["vue/scale-5k"]);
const RUN_SLOW = process.env.SCALE_RENDER_5K === "1";

for (const surface of SURFACES) {
	for (const fixture of FIXTURES) {
		const slow = SLOW_UNTIL_W2.has(`${surface}/${fixture}`);
		if (slow && !RUN_SLOW) continue;
		scenario(
			`SCALE6: ${surface} ${fixture} renderer counts match the committed baseline`,
			async (_s, page) => {
				test.skip(test.info().project.name !== "chromium", "scale-render counts are Chromium-only");
				test.setTimeout(slow ? 3_600_000 : 600_000);
				const counts = await measureFixture(page, surface, fixture);
				expect(counts.mount?.["mount.blocksMounted"]).toBe(
					mixedFixtureIdentity(SCALE_RENDER_ROOT_COUNTS[fixture]).totalBlocks,
				);
				await test.info().attach(`scale-render.${surface}.${fixture}`, {
					body: JSON.stringify(counts, null, 2),
					contentType: "application/json",
				});
				if (RECORD) {
					const reason = process.env.SCALE_RENDER_REASON;
					if (!reason) throw new Error("RECORD_SCALE_RENDER needs SCALE_RENDER_REASON");
					const previous = loadBaseline(surface)?.counts ?? {};
					writeBaseline(surface, { ...previous, [fixture]: counts }, reason);
					return;
				}
				expect(checkAgainstBaseline(surface, fixture, counts)).toEqual([]);
			},
			{ url: `/?surface=${surface}&probe=render`, axe: false },
		);
	}
}
