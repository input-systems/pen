import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { localCarets, readSettledLayer } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import type { OverlayProbeCounts } from "../../src/types";

const HELLO_ID = "hello-p1";

/** Two animation frames with no input: an idle editor schedules nothing in them. */
async function idleFrames(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			}),
	);
}

async function measure(page: Page, run: () => Promise<void>): Promise<OverlayProbeCounts> {
	// Settle first: a follow-up paint from the previous step must not land
	// in the window.
	await page.evaluate(() => window.__penConformance.whenIdle());
	await page.evaluate(() => window.__penConformance.startOverlayProbe());
	await run();
	return page.evaluate(() => window.__penConformance.stopOverlayProbe());
}

scenario(
	"OV1: a scroll that moves the root while the layer is empty costs no flush and no overlay read",
	async (s, page) => {
		await s.load("hello-world");
		await page.evaluate(() => {
			document.body.style.paddingBottom = "3000px";
		});
		const before = await readSettledLayer(page);
		expect(before.items, "precondition: nothing is painted").toEqual([]);

		const scroll = await measure(page, async () => {
			await page.evaluate(() => {
				window.scrollTo(0, 200);
			});
			await idleFrames(page);
		});
		const scrolled = await page.evaluate(() => window.scrollY);
		await test.info().attach("ov1-empty-scroll", {
			body: JSON.stringify({ scroll, scrolled }, null, 2),
			contentType: "application/json",
		});

		expect(scrolled, "precondition: the page scrolled the root").toBeGreaterThan(0);
		expect(
			scroll,
			formatCheckReport(
				"OV1: an empty layer ignores a root-moving scroll",
				scroll.flushes === 0 ? "passed" : "failed",
				JSON.stringify(scroll),
			),
		).toMatchObject({
			flushes: 0,
			paints: 0,
			caretRectReads: 0,
			blockRectReads: 0,
			layerMutations: 0,
		});
	},
);

scenario(
	"OV1: a caret move next to an atom costs at most two flushes, at most two caretRect reads per flush and at most two layer mutations, and an idle frame costs none",
	async (s, page) => {
		await s.load("hello-world");
		await s.apply([
			{
				type: "splice-text",
				blockId: HELLO_ID,
				from: 5,
				to: 5,
				insert: { nodeType: "mention", props: { id: "user-ada", label: "Ada" } },
			},
		]);
		const point = await getInlineOffsetPoint(page, { blockId: HELLO_ID, offset: 5 });
		await page.mouse.click(point.x, point.y);
		await expect.poll(async () => localCarets(await readSettledLayer(page)).length).toBe(1);

		const move = await measure(page, async () => {
			// Both sides of the chip are O1 offsets: the caret stays an overlay
			// caret and moves. The OV4 read joins the flush the move scheduled.
			// One task: the move and the OV4 read join the same frame.
			const check = await page.evaluate((id) => {
				window.__penConformance.selectCaretWithAffinity(id, 6, "downstream");
				return window.__penConformance.overlayMatchesAuthority();
			}, HELLO_ID);
			expect(check.kind).toBe("held");
		});
		const idle = await measure(page, () => idleFrames(page));
		await test.info().attach("ov1-paint-counts", {
			body: JSON.stringify({ move, idle }, null, 2),
			contentType: "application/json",
		});

		// One flush paints the move. When a queued write (the projector's
		// read-back or scroll job) lands in that flush, the stale-after-write
		// rule re-reads once in a paint-only follow-up (§3.2): never more.
		expect(
			move.flushes,
			formatCheckReport("OV1: the move costs at most two flushes", move.flushes <= 2 ? "passed" : "failed", JSON.stringify(move)),
		).toBeGreaterThanOrEqual(1);
		expect(move.flushes).toBeLessThanOrEqual(2);
		expect(move.caretRectReads).toBeGreaterThan(0);
		expect(move.layerAttributeWrites, "OV4: one version write on the layer").toBeLessThanOrEqual(1);
		expect(move.maxCaretRectReadsPerFlush).toBeLessThanOrEqual(2);
		expect(
			move.layerMutations,
			formatCheckReport("OV1: at most two item mutations", move.layerMutations <= 2 ? "passed" : "failed", JSON.stringify(move)),
		).toBeLessThanOrEqual(2);
		expect(
			idle,
			formatCheckReport("OV1: an idle frame costs nothing", idle.flushes === 0 ? "passed" : "failed", JSON.stringify(idle)),
		).toMatchObject({
			flushes: 0,
			paints: 0,
			caretRectReads: 0,
			layerMutations: 0,
			layerAttributeWrites: 0,
		});
	},
);
