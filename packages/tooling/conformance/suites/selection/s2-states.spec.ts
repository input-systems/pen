import { expect, test, type Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { itemsOfKind, readSettledLayer } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import type { LogicalPoint, ScenarioApi } from "../../src/types";

/**
 * D5, W3.R17: the two declared S2 exceptions and their pinned substitute
 * state — no native range in the root, focus on the sink revealed as a text
 * range (`role="group"`), and the overlay painting both endpoint carets plus
 * the range items — and the sink's input routing while one holds.
 */

/** `fuzz-large`: block 1 is "Line 1 of the large fuzz document.". */
const ANCHOR: LogicalPoint = { blockId: "fuzz-large-1", offset: 2 };
/** 52 blocks from the anchor, over the 50-block threshold. */
const FOCUS: LogicalPoint = { blockId: "fuzz-large-52", offset: 4 };
const BLOCKS_IN_RANGE = 52;
/** What the anchor block holds once the range is gone. */
const COLLAPSED_TEXT = "Li 52 of the large fuzz document.";

/** Tall enough that both endpoints share the viewport: the Shift+click needs no scroll. */
const TALL_VIEWPORT = { width: 1280, height: 2400 };

type ActiveTarget = {
	kind: "sink" | "field" | "root" | "other";
	role: string | null;
	label: string | null;
	blockId: string | null;
};

async function activeTarget(page: Page): Promise<ActiveTarget> {
	return page.evaluate(() => {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) {
			return {
				kind: "other" as const,
				role: null,
				label: null,
				blockId: null,
			};
		}
		const kind = active.hasAttribute("data-pen-focus-sink")
			? ("sink" as const)
			: active.hasAttribute("data-pen-editor-root")
				? ("root" as const)
				: active.closest("[data-block-id]")
					? ("field" as const)
					: ("other" as const);
		return {
			kind,
			role: active.getAttribute("role"),
			label: active.getAttribute("aria-label"),
			blockId:
				active
					.closest("[data-block-id]")
					?.getAttribute("data-block-id") ?? null,
		};
	});
}

async function nativeRangeCountInRoot(page: Page): Promise<number> {
	return page.evaluate(() => {
		const root = document.querySelector("[data-pen-editor-root]");
		const native = document.getSelection();
		if (!root || !native || native.rangeCount === 0) return 0;
		return [native.anchorNode, native.focusNode].some(
			(node) => node !== null && root.contains(node),
		)
			? native.rangeCount
			: 0;
	});
}

async function idle(page: Page): Promise<void> {
	await page.evaluate(() => window.__penConformance.whenIdle());
}

async function blockText(page: Page, blockId: string): Promise<string> {
	return page.evaluate(
		(id) => window.__penConformance.blockText(id),
		blockId,
	);
}

/** A pointer drag from the anchor to the focus: a real 52-block range. */
async function selectLargeRange(s: ScenarioApi, page: Page): Promise<void> {
	await page.setViewportSize(TALL_VIEWPORT);
	await s.load("fuzz-large");
	const anchor = await getInlineOffsetPoint(page, ANCHOR);
	await page.mouse.move(anchor.x, anchor.y);
	await page.mouse.down();
	await idle(page);
	const focus = await getInlineOffsetPoint(page, FOCUS);
	await page.mouse.move(focus.x, focus.y, { steps: 24 });
	await page.mouse.up();
	await idle(page);
	await s.assert.selectionEquals({ anchor: ANCHOR, focus: FOCUS });
}

async function expectCaretInAnchorField(
	s: ScenarioApi,
	page: Page,
	offset: number,
): Promise<void> {
	await idle(page);
	expect(
		await page.evaluate(() => window.__penConformance.substituteState),
	).toBeNull();
	await s.assert.selectionEquals({
		anchor: { blockId: ANCHOR.blockId, offset },
		focus: { blockId: ANCHOR.blockId, offset },
	});
	expect(await activeTarget(page)).toMatchObject({
		kind: "field",
		blockId: ANCHOR.blockId,
	});
	await s.assert.domMatchesAuthority();
}

scenario(
	"S2: a 51-block text range shows no native range, focuses the text-range sink, and paints the range overlay",
	async (s, page) => {
		await selectLargeRange(s, page);
		expect(
			await page.evaluate(() => window.__penConformance.substituteState),
		).toBe("block-surface-range");
		expect(await nativeRangeCountInRoot(page)).toBe(0);
		expect(await activeTarget(page)).toMatchObject({
			kind: "sink",
			role: "group",
			label: `Text selected across ${BLOCKS_IN_RANGE} blocks`,
		});

		const layer = await readSettledLayer(page);
		const endpoints = itemsOfKind(layer, "caret")
			.filter((item) => item.endpoint !== null)
			.map((item) => item.endpoint)
			.sort();
		expect(endpoints, "both endpoint carets").toEqual(["anchor", "focus"]);
		expect(
			itemsOfKind(layer, "range"),
			"a partial range in each endpoint block",
		).toHaveLength(2);
		const spans = itemsOfKind(layer, "block-span");
		expect(spans, "one span over the covered blocks").toHaveLength(1);
		expect(spans[0]).toMatchObject({
			fromBlockId: "fuzz-large-2",
			toBlockId: "fuzz-large-51",
		});
		await s.assert.domMatchesAuthority();
	},
);

scenario(
	"S2: an engine-confined multi-block range falls back once to the substitute state",
	async (s, page) => {
		await s.load("two-paragraph");
		await page.evaluate(() => {
			window.__penConformance.clearDiagnostics();
			window.__penConformance.installConfiningWriteFault();
			window.__penConformance.selectTextRangeById(
				{ blockId: "two-p1", offset: 0 },
				{ blockId: "two-p2", offset: 3 },
			);
		});
		await idle(page);

		expect(
			await page.evaluate(() => window.__penConformance.substituteState),
		).toBe("engine-confined-range");
		expect(
			await page.evaluate(
				() => window.__penConformance.confiningWriteFault,
			),
			"one confined write, one fallback clear, no write after it",
		).toEqual({ confined: 1, clears: 1, laterWrites: 0 });
		const mismatches = await page.evaluate(() =>
			window.__penConformance.diagnostics.filter(
				(event) => event.code === "selection-projection-mismatch",
			),
		);
		expect(mismatches).toEqual([]);
		expect(await nativeRangeCountInRoot(page)).toBe(0);
		expect(await activeTarget(page)).toMatchObject({
			kind: "sink",
			role: "group",
		});

		const layer = await readSettledLayer(page);
		expect(
			itemsOfKind(layer, "caret")
				.map((item) => item.endpoint)
				.filter((endpoint) => endpoint !== null)
				.sort(),
		).toEqual(["anchor", "focus"]);
		expect(itemsOfKind(layer, "range")).toHaveLength(2);
		await s.assert.domMatchesAuthority();
	},
);

scenario(
	"S2: typing a printable key over a 51-block range replaces it from the sink",
	async (s, page) => {
		await selectLargeRange(s, page);
		await page.keyboard.press("x");
		await expectCaretInAnchorField(s, page, ANCHOR.offset + 1);
		expect(await blockText(page, ANCHOR.blockId)).toBe(
			`${COLLAPSED_TEXT.slice(0, ANCHOR.offset)}x${COLLAPSED_TEXT.slice(ANCHOR.offset)}`,
		);
		expect(
			await page.evaluate(() => window.__penConformance.blockIds.length),
		).toBe(60 - (BLOCKS_IN_RANGE - 1));
	},
);

scenario("S2: Backspace over a 51-block range deletes it", async (s, page) => {
	await selectLargeRange(s, page);
	await page.keyboard.press("Backspace");
	await expectCaretInAnchorField(s, page, ANCHOR.offset);
	expect(await blockText(page, ANCHOR.blockId)).toBe(COLLAPSED_TEXT);
});

scenario("S2: copy from the sink carries the range", async (s, page) => {
	await selectLargeRange(s, page);
	const copied = await page.evaluate(() => {
		const sink = document.activeElement;
		if (
			!(sink instanceof HTMLElement) ||
			!sink.hasAttribute("data-pen-focus-sink")
		) {
			return null;
		}
		const clipboardData = new DataTransfer();
		const event = new ClipboardEvent("copy", {
			clipboardData,
			bubbles: true,
			cancelable: true,
		});
		sink.dispatchEvent(event);
		// Gecko copies the init DataTransfer into a new one on the event, so
		// the handler's writes land on `event.clipboardData`, not the init.
		return {
			prevented: event.defaultPrevented,
			text: (event.clipboardData ?? clipboardData).getData("text/plain"),
		};
	});
	expect(copied, "copy fired on the focused sink").not.toBeNull();
	expect(copied!.prevented).toBe(true);
	expect(copied!.text.startsWith("ne 1 of the large fuzz document.")).toBe(
		true,
	);
	expect(copied!.text).toContain("Line 51 of the large fuzz document.");
	expect(copied!.text.trimEnd().endsWith("Line")).toBe(true);
	// Copy leaves the range and its substitute state in place.
	expect(
		await page.evaluate(() => window.__penConformance.substituteState),
	).toBe("block-surface-range");
	await s.assert.domMatchesAuthority();
});

scenario(
	"C1: a Chromium composition started over a 51-block range composes into the collapsed field",
	async (s, page) => {
		test.skip(
			test.info().project.name !== "chromium",
			"Input.dispatchKeyEvent / Input.imeSetComposition are Chromium CDP; WebKit and Firefox are recorded in MANUAL.md (D20)",
		);
		await selectLargeRange(s, page);
		const cdp = await page.context().newCDPSession(page);
		// The IME's first keystroke: keydown 229 / "Process" on the sink.
		await cdp.send("Input.dispatchKeyEvent", {
			type: "rawKeyDown",
			key: "Process",
			code: "KeyN",
			windowsVirtualKeyCode: 229,
			nativeVirtualKeyCode: 229,
		});
		expect(
			await activeTarget(page),
			"the field owns focus before the composition starts",
		).toMatchObject({
			kind: "field",
			blockId: ANCHOR.blockId,
		});
		await cdp.send("Input.imeSetComposition", {
			text: "ni",
			selectionStart: 2,
			selectionEnd: 2,
		});
		await cdp.send("Input.insertText", { text: "你" });
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Process",
			code: "KeyN",
			windowsVirtualKeyCode: 229,
			nativeVirtualKeyCode: 229,
		});
		await expect
			.poll(() => blockText(page, ANCHOR.blockId))
			.toBe(
				`${COLLAPSED_TEXT.slice(0, ANCHOR.offset)}你${COLLAPSED_TEXT.slice(ANCHOR.offset)}`,
			);
		await expectCaretInAnchorField(s, page, ANCHOR.offset + 1);
	},
);
