import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";

// R1 `native-range` (D21, W3.R26, W3.G20): touch selection handles move the
// native range with `selectionchange` only, so no pointer window is open.
test.use({ hasTouch: true, isMobile: true });

test.skip(
	({ browserName }) => browserName !== "chromium",
	"Chromium only: the long-press comes from Chromium's CDP touch emulator",
);

/** How long a held press may take to become a long-press before the scenario fails. */
const LONG_PRESS_TIMEOUT_MS = 5_000;

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
 * A touch press through Chromium's touch emulator: with
 * `Emulation.setEmitTouchEventsForMouse` a mouse press becomes a touch
 * point and the emulator's gesture detector raises the gestures, so a
 * held press is a real long-press (`selectstart`, `contextmenu`, the word
 * selected) on every platform. `Input.synthesizeTapGesture` routes through
 * the platform gesture recognizer instead, and headless Linux Chromium
 * raises no gesture from it at all (touch events only, no tap or
 * long-press); `Input.dispatchTouchEvent` held reaches the page as a tap.
 *
 * `long` holds until the page sees `contextmenu`; `tap` releases at once.
 * The emulator consumes the mouse events, so their CDP acks never arrive
 * and are not awaited.
 */
async function touchPress(
	page: Page,
	cdp: CDPSession,
	point: { x: number; y: number },
	kind: "long" | "tap",
) {
	// Listen before pressing; wrapped so `evaluateHandle` does not await it.
	const contextMenu =
		kind === "long"
			? await page.evaluateHandle(
					(timeout) => ({
						fired: new Promise<void>((resolve, reject) => {
							document.addEventListener(
								"contextmenu",
								() => resolve(),
								{
									once: true,
									capture: true,
								},
							);
							setTimeout(
								() =>
									reject(
										new Error(
											`no long-press contextmenu within ${timeout} ms`,
										),
									),
								timeout,
							);
						}),
					}),
					LONG_PRESS_TIMEOUT_MS,
				)
			: null;
	const mouse = {
		x: point.x,
		y: point.y,
		button: "left",
		clickCount: 1,
	} as const;
	void cdp
		.send("Input.dispatchMouseEvent", { type: "mousePressed", ...mouse })
		.catch(() => {});
	if (contextMenu) {
		await contextMenu.evaluate(({ fired }) => fired);
		await contextMenu.dispose();
	}
	void cdp
		.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse })
		.catch(() => {});
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
		const state = record?.state?.type === "text" ? record.state : null;
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
		await cdp.send("Emulation.setEmitTouchEventsForMouse", {
			enabled: true,
			configuration: "mobile",
		});

		// Long-press "bravo".
		await touchPress(page, cdp, await textCenter(page, 0, 6, 11), "long");
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
		await touchPress(page, cdp, await textCenter(page, 1, 6, 10), "tap");
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
