import type { DocumentOp } from "@input/pen-types";
import { expect, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";
import type { ScenarioApi } from "../../src/types";
import { readBlockIds, readFocus } from "../specHelpers";

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

// W3.R15 scroll-into-view. The harness page itself scrolls, so the
// container is the document scroller and `scrollY` is the delta.

const SCROLL_BLOCK_COUNT = 60;

function scrollFixtureOps(): DocumentOp[] {
	return Array.from({ length: SCROLL_BLOCK_COUNT }, (_, index): DocumentOp[] => {
		const blockId = `scroll-${index + 1}`;
		return [
			{ type: "insert-block", blockId, blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId, from: 0, to: 0, insert: `Scroll line ${index + 1}` },
		];
	}).flat();
}

async function expectCaretInView(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const rect = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
				return rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
			}),
		)
		.toBe(true);
}

async function pressArrowDown(page: Page, times: number): Promise<void> {
	for (let press = 0; press < times; press += 1) {
		await page.keyboard.press("ArrowDown");
	}
}

/** Scrolls back to the top once the scheduler is idle, so no scheduled measure scrolls back. */
async function resetScrollWhenIdle(page: Page): Promise<void> {
	await page.evaluate(() => window.__penConformance.whenIdle());
	await page.evaluate(() => window.scrollTo(0, 0));
	expect(await scrollY(page)).toBe(0);
}

async function scrollY(page: Page): Promise<number> {
	return page.evaluate(() => window.scrollY);
}

async function loadScrollDocument(s: ScenarioApi, page: Page): Promise<void> {
	await s.load("hello-world");
	await s.apply(scrollFixtureOps());
	await page.evaluate(() => window.scrollTo(0, 0));
	await s.selectText(0, 0);
	expect(await scrollY(page)).toBe(0);
}

scenario("P: ArrowDown past the fold scrolls the caret into view", async (s, page) => {
	await loadScrollDocument(s, page);
	await pressArrowDown(page, 40);
	await s.assert.domMatchesAuthority();
	expect(await scrollY(page), "keyboard records scroll (auto)").toBeGreaterThan(0);
	await expectCaretInView(page);
});

scenario("P: typing on the last visible line keeps the caret in view", async (s, page) => {
	await loadScrollDocument(s, page);
	const lastVisible = await page.evaluate(() => {
		const blocks = [...document.querySelectorAll("[data-block-id]")];
		const visible = blocks.filter((block) => block.getBoundingClientRect().bottom <= window.innerHeight);
		return blocks.indexOf(visible[visible.length - 1]!);
	});
	await s.selectText(lastVisible, 0);
	expect(await scrollY(page), "the caret starts in view").toBe(0);
	for (let line = 0; line < 4; line += 1) {
		await s.keyboard.press("Enter");
		await s.keyboard.type("typed");
	}
	expect(await scrollY(page)).toBeGreaterThan(0);
	await expectCaretInView(page);
});

scenario("P: a remote edit that maps the caret does not scroll", async (s, page) => {
	await loadScrollDocument(s, page);
	await pressArrowDown(page, 50);
	// Let the keyboard scroll land before resetting the viewport. The engine's
	// own caret scroll can put the caret in view before the last keyboard
	// record's scheduled measure runs; reset only once the scheduler is idle,
	// or that measure sees the reset viewport and scrolls back.
	await expectCaretInView(page);
	await resetScrollWhenIdle(page);
	const focus = await readFocus(page);
	const caretBlock = focus ? (await readBlockIds(page)).indexOf(focus.blockId) : -1;
	expect(caretBlock).toBeGreaterThan(0);
	await s.remote.splice({ block: caretBlock, from: 0, to: 0, insert: "remote " });
	await expect
		.poll(async () => (await readFocus(page))?.offset ?? -1)
		.toBeGreaterThanOrEqual("remote ".length);
	// A scroll the mapped projection scheduled lands in the next flush.
	await page.evaluate(() => window.__penConformance.whenIdle());
	expect(await scrollY(page), "a collaborator's edit never moves the viewport").toBe(0);
});

scenario("P: scrollIntoView with align center centres the block", async (s, page) => {
	await loadScrollDocument(s, page);
	await page.evaluate(() => window.__penConformance.scrollBlockIntoView("scroll-40", "center"));
	await expect
		.poll(() =>
			page.evaluate(() => {
				const rect = document.querySelector('[data-block-id="scroll-40"]')!.getBoundingClientRect();
				return Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2);
			}),
		)
		.toBeLessThanOrEqual(2);
	// The selection stays where it was; only the viewport moved.
	await s.assert.domMatchesAuthority();
});

scenario("P: undo restoring a selection below the fold scrolls it into view", async (s, page) => {
	await loadScrollDocument(s, page);
	await pressArrowDown(page, 50);
	await s.keyboard.type("x");
	await page.evaluate(() => window.__penConformance.stopCapturing());
	await expectCaretInView(page);
	// A late typing scroll landing after the reset would pass for a restore one.
	await resetScrollWhenIdle(page);
	await s.keyboard.press("ControlOrMeta+z");
	await expect.poll(() => scrollY(page), "restore records scroll (D17)").toBeGreaterThan(0);
	await expectCaretInView(page);
});
