import { expect, type Page } from "@playwright/test";
import {
	BIDI_RTL_EMBED_ID,
	BIDI_RTL_EMBED_TEXT,
	BIDI_RTL_LATIN_MID,
} from "../fixtures/bidi";
import {
	GRAPHEME_COMBINING_AFTER,
	GRAPHEME_COMBINING_AFTER_BACKSPACE,
	GRAPHEME_COMBINING_ID,
	GRAPHEME_COMBINING_LINE,
	GRAPHEME_DEVANAGARI,
	GRAPHEME_DEVANAGARI_AFTER,
	GRAPHEME_DEVANAGARI_AFTER_BACKSPACE,
	GRAPHEME_DEVANAGARI_ID,
	GRAPHEME_FLAG_AFTER,
	GRAPHEME_FLAG_AFTER_BACKSPACE,
	GRAPHEME_FLAG_ID,
	GRAPHEME_RTL_AFTER_BACKSPACE,
	GRAPHEME_RTL_FAMILY_AFTER,
	GRAPHEME_RTL_ID,
	GRAPHEME_RTL_LINE,
	GRAPHEME_THAI,
	GRAPHEME_THAI_AFTER,
	GRAPHEME_THAI_AFTER_BACKSPACE,
	GRAPHEME_THAI_ID,
	GRAPHEME_ZWJ_AFTER,
	GRAPHEME_ZWJ_AFTER_BACKSPACE,
	GRAPHEME_ZWJ_FAMILY,
	GRAPHEME_ZWJ_ID,
} from "../fixtures/grapheme";
import { getInlineOffsetPoint } from "../src/domGeometry";
import { scenario } from "../src/scenario";
import { assertDomAuthorityResult } from "../src/standingAssertions";
import { readDocumentText } from "../suites/input/keys";
import { clickOffsetAndAwaitCaret, readModelBlockText } from "../suites/specHelpers";

/** Block `id` renders `text` with `dir="rtl"`, mixing Arabic and Latin if `mixed`. */
async function assertRtlBlock(page: Page, id: string, text: string, mixed: boolean): Promise<void> {
	await expect
		.poll(async () => {
			return page.evaluate(
				({ id, text, mixed }) => {
					const block = document.querySelector(`[data-block-id="${id}"]`);
					if (!(block instanceof HTMLElement)) {
						return "missing-block";
					}
					const content =
						block.querySelector("[data-pen-inline-content]")?.textContent ??
						"";
					if (!content.includes(text)) {
						return `text:${content}`;
					}
					if (mixed && (!/[\u0600-\u06FF]/.test(content) || !/[A-Za-z]/.test(content))) {
						return `not-mixed:${content}`;
					}
					if (block.getAttribute("dir") !== "rtl") {
						return `dir:${block.getAttribute("dir")}`;
					}
					return "ok";
				},
				{ id, text, mixed },
			);
		})
		.toBe("ok");
}

scenario(
	"M6: Backspace on an RTL mixed block deletes the previous logical grapheme (no swap)",
	async (s, page) => {
		await s.load("bidi-mixed");
		await assertRtlBlock(page, BIDI_RTL_EMBED_ID, BIDI_RTL_EMBED_TEXT, true);
		await clickOffsetAndAwaitCaret(page, BIDI_RTL_EMBED_ID, BIDI_RTL_LATIN_MID);
		await page.keyboard.press("Backspace");

		const text = await readDocumentText(page);
		const s2 = await page.evaluate(() =>
			window.__penConformance.domMatchesAuthority(),
		);
		expect(
			text,
			`M6: Backspace mid-Hello must stay deleteBackward (drop e). text=${JSON.stringify(text)} s2=${JSON.stringify(s2)}`,
		).toContain("مرحبا Hllo");
		expect(text).not.toContain("مرحبا Helo");
		assertDomAuthorityResult(s2);
	},
);

scenario(
	"M6: Delete on an RTL mixed block deletes the next logical grapheme (no swap)",
	async (s, page) => {
		await s.load("bidi-mixed");
		await assertRtlBlock(page, BIDI_RTL_EMBED_ID, BIDI_RTL_EMBED_TEXT, true);
		await clickOffsetAndAwaitCaret(page, BIDI_RTL_EMBED_ID, BIDI_RTL_LATIN_MID);
		await s.keyboard.press("Delete");

		const text = await readDocumentText(page);
		expect(
			text,
			`M6: Delete mid-Hello must stay deleteForward (drop first l). text=${JSON.stringify(text)}`,
		).toContain("مرحبا Helo");
		expect(text).not.toContain("مرحبا Hllo");
	},
);

async function selectBlockOffset(
	page: Page,
	blockId: string,
	offset: number,
): Promise<void> {
	// Click activates the field on this block. RTL clusters can land the
	// click one unit off, so the exact caret is programmatic selectText
	// (P1) after the field is live — otherwise Backspace hits nothing.
	const point = await getInlineOffsetPoint(page, { blockId, offset: 0 });
	await page.mouse.click(point.x, point.y);
	await page.evaluate(
		({ id, caret }) => {
			const ids = window.__penConformance.blockIds;
			const index = ids.indexOf(id);
			if (index < 0) {
				throw new Error(`M6: missing block ${id}`);
			}
			window.__penConformance.selectText(index, caret);
		},
		{ id: blockId, caret: offset },
	);
	await expect
		.poll(async () => {
			const selection = await page.evaluate(
				() => window.__penConformance.selection,
			);
			if (selection?.type !== "text") {
				return "not-text";
			}
			return `${selection.focus.blockId}:${selection.focus.offset}`;
		})
		.toBe(`${blockId}:${offset}`);
}

scenario(
	"M6: Backspace deletes a ZWJ family as one logical grapheme",
	async (s, page) => {
		await s.load("grapheme-clusters");
		await selectBlockOffset(page, GRAPHEME_ZWJ_ID, GRAPHEME_ZWJ_AFTER);
		await page.keyboard.press("Backspace");
		const text = await readModelBlockText(page, GRAPHEME_ZWJ_ID);
		expect(
			text,
			`M6: ZWJ family must leave as one cluster. text=${JSON.stringify(text)}`,
		).toBe(GRAPHEME_ZWJ_AFTER_BACKSPACE);
		expect(text).not.toContain("\u200D");
		expect(text).not.toContain(GRAPHEME_ZWJ_FAMILY);
	},
);

scenario(
	"M6: Backspace deletes e+combining-acute as one logical grapheme",
	async (s, page) => {
		await s.load("grapheme-clusters");
		await selectBlockOffset(page, GRAPHEME_COMBINING_ID, GRAPHEME_COMBINING_AFTER);
		await page.keyboard.press("Backspace");
		const text = await readModelBlockText(page, GRAPHEME_COMBINING_ID);
		expect(text).toBe(GRAPHEME_COMBINING_AFTER_BACKSPACE);
		expect(text).not.toContain("\u0301");
		expect(text).not.toContain(GRAPHEME_COMBINING_LINE);
	},
);

scenario(
	"M6: Backspace deletes a regional-indicator flag as one logical grapheme",
	async (s, page) => {
		await s.load("grapheme-clusters");
		await selectBlockOffset(page, GRAPHEME_FLAG_ID, GRAPHEME_FLAG_AFTER);
		await page.keyboard.press("Backspace");
		const text = await readModelBlockText(page, GRAPHEME_FLAG_ID);
		expect(text).toBe(GRAPHEME_FLAG_AFTER_BACKSPACE);
	},
);

scenario(
	"M6: Backspace deletes Devanagari and Thai clusters as one logical grapheme",
	async (s, page) => {
		await s.load("grapheme-clusters");
		const clusters = [
			[GRAPHEME_DEVANAGARI_ID, GRAPHEME_DEVANAGARI_AFTER, GRAPHEME_DEVANAGARI_AFTER_BACKSPACE, GRAPHEME_DEVANAGARI],
			[GRAPHEME_THAI_ID, GRAPHEME_THAI_AFTER, GRAPHEME_THAI_AFTER_BACKSPACE, GRAPHEME_THAI],
		] as const;
		for (const [id, after, expected, cluster] of clusters) {
			await selectBlockOffset(page, id, after);
			await page.keyboard.press("Backspace");
			const text = await readModelBlockText(page, id);
			expect(text).toBe(expected);
			expect(text).not.toContain(cluster);
		}
	},
);

scenario(
	"M6: Delete removes a ZWJ family as one logical grapheme",
	async (s, page) => {
		await s.load("grapheme-clusters");
		await selectBlockOffset(page, GRAPHEME_ZWJ_ID, 1);
		await s.keyboard.press("Delete");
		const text = await readModelBlockText(page, GRAPHEME_ZWJ_ID);
		expect(text).toBe(GRAPHEME_ZWJ_AFTER_BACKSPACE);
		expect(text).not.toContain("\u200D");
	},
);

scenario(
	"M6: Backspace on an RTL mixed block deletes the ZWJ family, not one code point",
	async (s, page) => {
		await s.load("grapheme-clusters");
		await assertRtlBlock(page, GRAPHEME_RTL_ID, GRAPHEME_RTL_LINE, false);
		await selectBlockOffset(page, GRAPHEME_RTL_ID, GRAPHEME_RTL_FAMILY_AFTER);
		await page.keyboard.press("Backspace");
		const text = await readModelBlockText(page, GRAPHEME_RTL_ID);
		expect(text).toBe(GRAPHEME_RTL_AFTER_BACKSPACE);
		expect(text).not.toContain("\u200D");
		expect(text).not.toContain(GRAPHEME_ZWJ_FAMILY);
	},
);
