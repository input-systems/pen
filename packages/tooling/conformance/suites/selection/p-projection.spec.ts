import type { DocumentOp } from "@input/pen-types";
import { expect, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";
import type { ScenarioApi } from "../../src/types";

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
	const ops: DocumentOp[] = [];
	for (let index = 1; index <= SCROLL_BLOCK_COUNT; index += 1) {
		ops.push(
			{
				type: "insert-block",
				blockId: `scroll-${index}`,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: `scroll-${index}`,
				from: 0,
				to: 0,
				insert: `Scroll line ${index}`,
			},
		);
	}
	return ops;
}

async function caretInViewport(page: Page): Promise<{ top: number; bottom: number; inView: boolean }> {
	return page.evaluate(() => {
		const rect = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
		return {
			top: rect.top,
			bottom: rect.bottom,
			inView: rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight,
		};
	});
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
	for (let press = 0; press < 40; press += 1) {
		await page.keyboard.press("ArrowDown");
	}
	await s.assert.domMatchesAuthority();
	expect(await scrollY(page), "keyboard records scroll (auto)").toBeGreaterThan(0);
	await expect.poll(async () => (await caretInViewport(page)).inView).toBe(true);
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
	await expect.poll(async () => (await caretInViewport(page)).inView).toBe(true);
});

scenario("P: a remote edit that maps the caret does not scroll", async (s, page) => {
	await loadScrollDocument(s, page);
	for (let press = 0; press < 50; press += 1) {
		await page.keyboard.press("ArrowDown");
	}
	// Let the keyboard scroll land before resetting the viewport. The engine's
	// own caret scroll can put the caret in view before the last keyboard
	// record's scheduled measure runs; reset only once the scheduler is idle,
	// or that measure sees the reset viewport and scrolls back.
	await expect.poll(async () => (await caretInViewport(page)).inView).toBe(true);
	await page.evaluate(() => window.__penConformance.whenIdle());
	await page.evaluate(() => window.scrollTo(0, 0));
	expect(await scrollY(page)).toBe(0);
	const caretBlock = await page.evaluate(() => {
		const selection = window.__penConformance.selection;
		return selection?.type === "text"
			? window.__penConformance.blockIds.indexOf(selection.focus.blockId)
			: -1;
	});
	expect(caretBlock).toBeGreaterThan(0);
	await s.remote.splice({ block: caretBlock, from: 0, to: 0, insert: "remote " });
	await expect
		.poll(() =>
			page.evaluate(() => {
				const selection = window.__penConformance.selection;
				return selection?.type === "text" ? selection.focus.offset : -1;
			}),
		)
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
	for (let press = 0; press < 50; press += 1) {
		await page.keyboard.press("ArrowDown");
	}
	await s.keyboard.type("x");
	await page.evaluate(() => window.__penConformance.stopCapturing());
	await expect.poll(async () => (await caretInViewport(page)).inView).toBe(true);
	// A late typing scroll landing after the reset would pass for a restore one.
	await page.evaluate(() => window.__penConformance.whenIdle());
	await page.evaluate(() => window.scrollTo(0, 0));
	expect(await scrollY(page)).toBe(0);
	await s.keyboard.press("ControlOrMeta+z");
	await expect.poll(() => scrollY(page), "restore records scroll (D17)").toBeGreaterThan(0);
	await expect.poll(async () => (await caretInViewport(page)).inView).toBe(true);
});
