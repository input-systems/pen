import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";

// R1 `native-range` (D21, W3.R26, W3.G20): touch selection handles move the
// native range with `selectionchange` only, so no pointer window is open.
test.use({ hasTouch: true, isMobile: true });

test.skip(
	({ browserName }) => browserName !== "chromium",
	"Chromium only: the long-press is a CDP synthesized touch gesture",
);

/** Viewport centre of `start`..`end` in block `block`'s text node. */
async function textCenter(
	page: Page,
	block: number,
	start: number,
	end: number,
) {
	return page.evaluate(
		({ block, start, end }) => {
			const inline = document.querySelectorAll(
				"[data-pen-inline-content]",
			)[block]!;
			const text = document
				.createTreeWalker(inline, NodeFilter.SHOW_TEXT)
				.nextNode()!;
			const range = document.createRange();
			range.setStart(text, start);
			range.setEnd(text, end);
			const rect = range.getBoundingClientRect();
			return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
		},
		{ block, start, end },
	);
}

/**
 * A touch press held `duration` ms. Chromium's gesture pipeline turns a
 * long hold into a long-press: `selectstart`, `contextmenu` and the word.
 * (`Input.dispatchTouchEvent` start/end with a wait reaches the page as a
 * tap in headless Chromium, so it cannot stand in for a long-press.)
 */
async function touchPress(
	cdp: CDPSession,
	point: { x: number; y: number },
	duration: number,
) {
	await cdp.send("Input.synthesizeTapGesture", {
		x: point.x,
		y: point.y,
		duration,
		tapCount: 1,
		gestureSourceType: "touch",
	});
}

/** Stands in for a handle drag in block 0: the native range moves, nothing else fires. */
async function handleExtend(page: Page, anchor: number, focus: number) {
	await page.evaluate(
		({ anchor, focus }) => {
			const inline = document.querySelector("[data-pen-inline-content]")!;
			const text = document
				.createTreeWalker(inline, NodeFilter.SHOW_TEXT)
				.nextNode()!;
			document
				.getSelection()!
				.setBaseAndExtent(text, anchor, text, focus);
		},
		{ anchor, focus },
	);
}

/** The record's text endpoints and the native range, once the scheduler is idle. */
async function settled(page: Page) {
	return page.evaluate(async () => {
		await window.__penConformance.whenIdle();
		const record = window.__penConformance.selectionRecord;
		const state = record?.state.type === "text" ? record.state : null;
		return {
			origin: record?.origin,
			anchor: state && `${state.anchor.blockId}:${state.anchor.offset}`,
			focus: state && `${state.focus.blockId}:${state.focus.offset}`,
			native: document.getSelection()?.toString() ?? "",
		};
	});
}

scenario(
	"R1: a touch long-press selection is accepted and a handle-style extension keeps it",
	async (s, page) => {
		await s.load("two-paragraph", { pointer: false });
		const cdp = await page.context().newCDPSession(page);

		// Long-press "bravo".
		await touchPress(cdp, await textCenter(page, 0, 6, 11), 1500);
		await expect
			.poll(() => settled(page))
			.toEqual({
				origin: "pointer",
				anchor: "two-p1:6",
				focus: "two-p1:11",
				native: "bravo",
			});
		await s.assert.domMatchesAuthority();

		// The start handle dragged to the block start: no pointer window is
		// open, and P2 must not revert it.
		const extended = {
			origin: "pointer",
			anchor: "two-p1:11",
			focus: "two-p1:0",
			native: "Alpha bravo",
		};
		await handleExtend(page, 11, 0);
		await expect.poll(() => settled(page)).toEqual(extended);
		// A later turn: still the extension, nothing projected it back.
		expect(await settled(page)).toEqual(extended);
		await s.assert.domMatchesAuthority();

		// A tap elsewhere in the content closes the window.
		await touchPress(cdp, await textCenter(page, 1, 6, 10), 50);
		await expect
			.poll(async () => {
				const { origin, anchor, focus } = await settled(page);
				return (
					origin === "pointer" &&
					anchor?.startsWith("two-p2:") &&
					anchor === focus
				);
			})
			.toBe(true);
		const caret = await settled(page);

		// With the window closed the same move is divergence: refused and
		// projected back (I4, P2).
		await handleExtend(page, 11, 0);
		await expect.poll(() => settled(page)).toEqual(caret);
		await s.assert.domMatchesAuthority();
	},
);
