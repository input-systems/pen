import { detectLoadSnapshot, detectMachineClass } from "@input/pen-bench";
import { mixedFixtureIdentity, mixedFixtureTargets } from "@input/pen-test";
import { test, type Page } from "@playwright/test";
import {
	SCALE_RENDER_ROOT_COUNTS,
	clockSample,
	writeClocks,
	type ClockSample,
	type ScaleRenderClockFixture,
	type ScaleRenderClocks,
	type ScaleRenderFixtureClocks,
	type ScaleRenderFloorClocks,
	type ScaleRenderSurface,
	type ScaleRenderTimedOut,
} from "../src/scaleRender";
import { scenario } from "../src/scenario";

/**
 * SCALE6 renderer clocks (W1-S6, record-only; CH8). Runs only under
 * SCALE_RENDER_CLOCKS=1 with one worker, no probes and the in-page peer
 * disconnected. Each surface measures its own `?surface=static` floor in the
 * same test so a row and its floor share one load. RECORD_SCALE_RENDER_CLOCKS=1
 * writes the `clocks` section and refuses on a busy machine. Nothing here is
 * ever compared.
 */
const SURFACES: readonly ScaleRenderSurface[] = ["react", "vue", "vanilla"];
const CLOCKS = process.env.SCALE_RENDER_CLOCKS === "1";
const RECORD = process.env.RECORD_SCALE_RENDER_CLOCKS === "1";
const LARGE = process.env.SCALE_RENDER_LARGE === "1";
const FIXTURES: readonly ScaleRenderClockFixture[] = LARGE
	? ["scale-10k", "scale-50k"]
	: ["scale-1k", "scale-5k"];
const MOUNT_LOADS = 5;
const KEY_SAMPLES = 20;
const MOUNT_DEADLINE_MS = 300_000;
const SCROLL_STEP_PX = 400;

type ClockWindow = Window & {
	__penConformance: {
		load(name: string): void;
		setPeersConnected(connected: boolean): void;
		blockIds: readonly string[];
	};
	__penClock?: Promise<number>;
};

/** One fresh load of `fixture`, timed to the second frame after it is fully mounted. */
async function timeMount(
	page: Page,
	fixture: string,
	blockSelector: string,
	total: number,
): Promise<number> {
	return page.evaluate(
		({ name, selector, count, deadline }) =>
			new Promise<number>((resolve, reject) => {
				const w = window as unknown as ClockWindow;
				const before = document
					.querySelector("[data-generation]")
					?.getAttribute("data-generation");
				const start = performance.now();
				w.__penConformance.load(name);
				const mounted = () => {
					const frame = document.querySelector(
						`[data-fixture="${name}"]`,
					);
					if (
						!frame ||
						frame.getAttribute("data-generation") === before
					)
						return false;
					return document.querySelectorAll(selector).length >= count;
				};
				const tick = () => {
					if (performance.now() - start > deadline)
						return reject(new Error("mount timed out"));
					if (!mounted()) return void requestAnimationFrame(tick);
					requestAnimationFrame(() =>
						requestAnimationFrame(() =>
							resolve(performance.now() - start),
						),
					);
				};
				tick();
			}),
		{
			name: fixture,
			selector: blockSelector,
			count: total,
			deadline: MOUNT_DEADLINE_MS,
		},
	);
}

/** From the keydown's timeStamp to the second animation frame after it. */
async function keyToFrame(page: Page, key: string): Promise<number> {
	await page.evaluate(() => {
		const w = window as unknown as ClockWindow;
		w.__penClock = new Promise<number>((resolve) => {
			window.addEventListener(
				"keydown",
				(event) => {
					const start = event.timeStamp;
					requestAnimationFrame(() =>
						requestAnimationFrame(() =>
							resolve(performance.now() - start),
						),
					);
				},
				{ capture: true, once: true },
			);
		});
	});
	await page.keyboard.press(key);
	return page.evaluate(
		() =>
			(window as unknown as ClockWindow).__penClock ??
			Promise.resolve(-1),
	);
}

async function keySamples(
	page: Page,
	key: string,
	before: () => Promise<void>,
): Promise<ClockSample> {
	const values: number[] = [];
	for (let rep = 0; rep < KEY_SAMPLES; rep += 1) {
		await before();
		values.push(await keyToFrame(page, key));
	}
	return clockSample(values);
}

async function heapAfterMount(page: Page): Promise<number> {
	const cdp = await page.context().newCDPSession(page);
	try {
		await cdp.send("HeapProfiler.collectGarbage");
		const usage = await cdp.send("Runtime.getHeapUsage");
		return usage.usedSize;
	} finally {
		await cdp.detach();
	}
}

/** Long tasks over a top-to-bottom scroll of the document, one frame per step. */
async function scrollLongTasks(
	page: Page,
): Promise<{ count: number; totalMs: number }> {
	return page.evaluate(
		(step) =>
			new Promise<{ count: number; totalMs: number }>((resolve) => {
				const scroller =
					document.scrollingElement ?? document.documentElement;
				const entries: PerformanceEntry[] = [];
				const observer = new PerformanceObserver((list) =>
					entries.push(...list.getEntries()),
				);
				observer.observe({ type: "longtask" });
				scroller.scrollTop = 0;
				let previous = -1;
				const next = () => {
					// Stops at the bottom, or when a step no longer moves the scroller.
					const moved = scroller.scrollTop !== previous;
					previous = scroller.scrollTop;
					if (moved) {
						scroller.scrollTop += step;
						return void requestAnimationFrame(next);
					}
					requestAnimationFrame(() =>
						requestAnimationFrame(() => {
							entries.push(...observer.takeRecords());
							observer.disconnect();
							const totalMs = entries.reduce(
								(sum, entry) => sum + entry.duration,
								0,
							);
							resolve({
								count: entries.length,
								totalMs: Math.round(totalMs * 100) / 100,
							});
						}),
					);
				};
				requestAnimationFrame(next);
			}),
		SCROLL_STEP_PX,
	);
}

async function disconnectPeers(page: Page): Promise<void> {
	await page.evaluate(() =>
		(window as unknown as ClockWindow).__penConformance.setPeersConnected(
			false,
		),
	);
}

async function mountSamples(
	page: Page,
	fixture: string,
	selector: string,
	total: number,
): Promise<ClockSample> {
	const values: number[] = [];
	for (let load = 0; load < MOUNT_LOADS; load += 1) {
		values.push(await timeMount(page, fixture, selector, total));
	}
	await disconnectPeers(page);
	return clockSample(values);
}

async function measureFloor(
	page: Page,
	fixture: ScaleRenderClockFixture,
): Promise<ScaleRenderFloorClocks> {
	await page.goto("/?surface=static");
	const paragraphs = "[data-pen-conformance-harness] [contenteditable] > p";
	const blockCount = await page.evaluate((name) => {
		const w = window as unknown as ClockWindow;
		w.__penConformance.load(name);
		return w.__penConformance.blockIds.length;
	}, fixture);
	const mountMs = await mountSamples(page, fixture, paragraphs, blockCount);
	const heapAfterMountBytes = await heapAfterMount(page);
	// Blocks with no text (dividers, empty blocks) render as zero-height
	// paragraphs on the static surface; type into a middle one with text.
	const withText = page.locator(paragraphs).filter({ hasText: /\S/ });
	const target = withText.nth(Math.floor((await withText.count()) / 2));
	await target.click();
	await page.keyboard.press("End");
	const keystrokeToFrameMs = await keySamples(page, "x", async () => {});
	return { mountMs, keystrokeToFrameMs, heapAfterMountBytes };
}

async function measureSurface(
	page: Page,
	surface: ScaleRenderSurface,
	fixture: ScaleRenderClockFixture,
): Promise<ScaleRenderFixtureClocks | ScaleRenderTimedOut> {
	await page.goto(`/?surface=${surface}`);
	const rootCount = SCALE_RENDER_ROOT_COUNTS[fixture];
	const { totalBlocks } = mixedFixtureIdentity(rootCount);
	let mountMs: ClockSample;
	try {
		mountMs = await mountSamples(
			page,
			fixture,
			"[data-pen-editor-block]",
			totalBlocks,
		);
	} catch {
		return { mountTimedOut: true };
	}
	const heapAfterMountBytes = await heapAfterMount(page);
	const { paragraph } = mixedFixtureTargets(rootCount);
	const inline = page
		.locator(`[data-block-id="${paragraph}"] [data-pen-inline-content]`)
		.first();
	await inline.click();
	await page.keyboard.press("End");
	const keystrokeToFrameMs = await keySamples(page, "x", async () => {});
	const caretRightToFrameMs = await keySamples(page, "ArrowRight", () =>
		page.keyboard.press("Home"),
	);
	const caretDownToFrameMs = await keySamples(page, "ArrowDown", () =>
		inline.click(),
	);
	return {
		mountMs,
		keystrokeToFrameMs,
		caretRightToFrameMs,
		caretDownToFrameMs,
		scrollLongTasks: await scrollLongTasks(page),
		heapAfterMountBytes,
	};
}

function refuseBusyRecord(): ScaleRenderClocks["load"] {
	const load = detectLoadSnapshot();
	if (RECORD && load.busy) {
		throw new Error(
			`refusing to record clocks on a busy machine: load1 ${load.load1.toFixed(2)} on ${load.ncpu} CPUs`,
		);
	}
	return load;
}

for (const surface of SURFACES) {
	for (const fixture of FIXTURES) {
		scenario(
			`SCALE6: ${surface} ${fixture} renderer clocks are recorded with a static floor`,
			async (_s, page) => {
				test.skip(
					!CLOCKS,
					"renderer clocks run only under SCALE_RENDER_CLOCKS=1",
				);
				test.skip(
					test.info().project.name !== "chromium",
					"scale-render clocks are Chromium-only",
				);
				test.setTimeout(LARGE ? 3_600_000 : 900_000);
				const load = refuseBusyRecord();
				const floor = await test.step("static floor", () =>
					measureFloor(page, fixture));
				const clocks = await test.step(`${surface} clocks`, () =>
					measureSurface(page, surface, fixture));
				const stamp = {
					recordedAt: new Date().toISOString().slice(0, 10),
					machineClass: detectMachineClass(),
					load,
					browserVersion:
						page.context().browser()?.version() ?? "unknown",
					statistic: "median" as const,
				};
				await test
					.info()
					.attach(`scale-render-clocks.${surface}.${fixture}`, {
						body: JSON.stringify(
							{ ...stamp, floor, clocks },
							null,
							2,
						),
						contentType: "application/json",
					});
				if (RECORD) writeClocks(surface, stamp, fixture, clocks, floor);
			},
			{ url: `/?surface=${surface}`, axe: false },
		);
	}
}
