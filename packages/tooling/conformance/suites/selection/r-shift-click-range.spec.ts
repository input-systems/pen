import { expect, type Page } from "@playwright/test";
import { ATOM_CARET_IDS as ATOM } from "../../fixtures/atomCaret";
import {
	BIDI_LTR_EMBED_ID,
	BIDI_RTL_LINE_A,
	BIDI_RTL_LINE_A_ID,
} from "../../fixtures/bidi";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { scenario } from "../../src/scenario";

const SURFACES = [
	{ suffix: "", url: undefined },
	{ suffix: " (vue)", url: "/?surface=vue" },
	{ suffix: " (vanilla)", url: "/?surface=vanilla" },
] as const;

/** The Vue surface does not render inline atoms outside the active field, so atom clicks run on React and vanilla (as in `o1-atoms`). */
const ATOM_SURFACES = SURFACES.filter(({ suffix }) => suffix !== " (vue)");

/** Where in an atom's box a click lands, as a fraction of its width from the left edge. */
const ATOM_LEFT_HALF = 0.25;
const ATOM_RIGHT_HALF = 0.75;

async function withShift(
	page: Page,
	shift: boolean,
	click: () => Promise<void>,
): Promise<void> {
	// `mouse.click` takes no modifiers; hold Shift on the keyboard.
	if (shift) await page.keyboard.down("Shift");
	await click();
	if (shift) await page.keyboard.up("Shift");
}

/** Clicks the caret position at `offset`; only for offsets before the block's first atom. */
async function clickAt(
	page: Page,
	blockId: string,
	offset: number,
	shift = false,
): Promise<void> {
	const point = await getInlineOffsetPoint(page, { blockId, offset });
	await withShift(page, shift, () => page.mouse.click(point.x, point.y));
}

/**
 * Clicks the caret position at `offset` in a right-to-left block: inside the
 * visual right (logical leading) quarter of the character after it.
 * `getInlineOffsetPoint` aims at a character's left edge, which in
 * right-to-left text is the caret after it. Only for offsets in the block's
 * first text run.
 */
async function clickAtRtl(
	page: Page,
	blockId: string,
	offset: number,
	shift = false,
): Promise<void> {
	const point = await page.evaluate(
		({ id, at }) => {
			const inline = document.querySelector(
				`[data-pen-editor-block][data-block-id="${id}"] [data-pen-inline-content]`,
			);
			const walker = inline
				? document.createTreeWalker(inline, NodeFilter.SHOW_TEXT)
				: null;
			const text = walker?.nextNode();
			if (!(text instanceof Text) || text.data.length <= at) {
				throw new Error(`no character at ${at} in ${id}`);
			}
			const range = document.createRange();
			range.setStart(text, at);
			range.setEnd(text, at + 1);
			const rect = range.getBoundingClientRect();
			return {
				x: rect.right - rect.width / 4,
				y: rect.top + rect.height / 2,
			};
		},
		{ id: blockId, at: offset },
	);
	await withShift(page, shift, () => page.mouse.click(point.x, point.y));
}

/** Clicks inside the block's first inline atom chip, `fraction` of its width from its visual left. */
async function clickInAtom(
	page: Page,
	blockId: string,
	fraction: number,
	shift = false,
): Promise<void> {
	const box = await page.evaluate((id) => {
		const atom = document.querySelector(
			`[data-pen-editor-block][data-block-id="${id}"] [data-pen-inline-atom]`,
		);
		if (!(atom instanceof HTMLElement))
			throw new Error(`missing atom in ${id}`);
		const rect = atom.getBoundingClientRect();
		return {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
		};
	}, blockId);
	await withShift(page, shift, () =>
		page.mouse.click(
			box.left + box.width * fraction,
			box.top + box.height / 2,
		),
	);
}

async function textSelection(page: Page): Promise<string> {
	return page.evaluate(() => {
		const state = window.__penConformance.selectionRecord?.state ?? null;
		if (state?.type !== "text") return `not text: ${JSON.stringify(state)}`;
		return `${state.anchor.blockId}:${state.anchor.offset} -> ${state.focus.blockId}:${state.focus.offset}`;
	});
}

async function expectDomMatchesAuthority(page: Page): Promise<void> {
	const check = await page.evaluate(() =>
		window.__penConformance.domMatchesAuthority(),
	);
	expect(check.ok, check.reason).toBe(true);
}

/**
 * R1, S2, T5: a shift-click in another block extends the selection from its
 * anchor to the logical offset under the pointer, the point a plain click
 * there would collapse to, on every binding. A click inside an inline atom
 * resolves to the side of the half it lands in (O1), in the block's
 * direction. The standing S2 check after each step compares the DOM with
 * the authority.
 */
for (const { suffix, url } of SURFACES) {
	scenario(
		`R1 S2 T5: a shift-click in a later block extends the caret to the clicked point${suffix}`,
		async (s, page) => {
			await s.load("two-paragraph");
			await clickAt(page, "two-p1", 2);
			await expect
				.poll(() => textSelection(page))
				.toBe("two-p1:2 -> two-p1:2");

			await clickAt(page, "two-p2", 3, true);
			await expect
				.poll(() => textSelection(page))
				.toBe("two-p1:2 -> two-p2:3");
			await expectDomMatchesAuthority(page);
		},
		{ url },
	);

	scenario(
		`R1 S2 T5: a shift-click in an earlier block extends the caret back to the clicked point${suffix}`,
		async (s, page) => {
			await s.load("two-paragraph");
			await clickAt(page, "two-p2", 4);
			await expect
				.poll(() => textSelection(page))
				.toBe("two-p2:4 -> two-p2:4");

			await clickAt(page, "two-p1", 1, true);
			await expect
				.poll(() => textSelection(page))
				.toBe("two-p2:4 -> two-p1:1");
			await expectDomMatchesAuthority(page);
		},
		{ url },
	);

	scenario(
		`R1 S2 T5: a shift-click in a right-to-left block extends to the logical offset under the pointer${suffix}`,
		async (s, page) => {
			await s.load("bidi-mixed");
			await clickAt(page, BIDI_LTR_EMBED_ID, 2);
			await expect
				.poll(() => textSelection(page))
				.toBe(`${BIDI_LTR_EMBED_ID}:2 -> ${BIDI_LTR_EMBED_ID}:2`);

			// Hebrew, right to left; offset 3 is inside the first word.
			expect(BIDI_RTL_LINE_A.indexOf(" ")).toBeGreaterThan(3);
			await clickAtRtl(page, BIDI_RTL_LINE_A_ID, 3, true);
			await expect
				.poll(() => textSelection(page))
				.toBe(`${BIDI_LTR_EMBED_ID}:2 -> ${BIDI_RTL_LINE_A_ID}:3`);
			await expectDomMatchesAuthority(page);
		},
		{ url },
	);
}

for (const { suffix, url } of ATOM_SURFACES) {
	scenario(
		`R1 S2 T5 O1: a shift-click inside an inline atom in another block extends to the side of the half it lands in${suffix}`,
		async (s, page) => {
			await s.load("atom-caret");
			// "ends " @Ada: the anchor sits before the atom, after ac-mid and
			// before ac-rtl.
			await clickAt(page, ATOM.end, 2);
			await expect
				.poll(() => textSelection(page))
				.toBe(`${ATOM.end}:2 -> ${ATOM.end}:2`);

			// "Hello " @Ada " world": the atom is 6..7, left to right.
			await clickInAtom(page, ATOM.mid, ATOM_RIGHT_HALF, true);
			await expect
				.poll(() => textSelection(page))
				.toBe(`${ATOM.end}:2 -> ${ATOM.mid}:7`);
			await expectDomMatchesAuthority(page);

			await clickInAtom(page, ATOM.mid, ATOM_LEFT_HALF, true);
			await expect
				.poll(() => textSelection(page))
				.toBe(`${ATOM.end}:2 -> ${ATOM.mid}:6`);
			await expectDomMatchesAuthority(page);

			// "مرحبا " @Ada " عالم": the atom is 6..7, right to left, so its
			// visual left half is its logical end.
			await clickInAtom(page, ATOM.rtl, ATOM_LEFT_HALF, true);
			await expect
				.poll(() => textSelection(page))
				.toBe(`${ATOM.end}:2 -> ${ATOM.rtl}:7`);
			await expectDomMatchesAuthority(page);

			await clickInAtom(page, ATOM.rtl, ATOM_RIGHT_HALF, true);
			await expect
				.poll(() => textSelection(page))
				.toBe(`${ATOM.end}:2 -> ${ATOM.rtl}:6`);
			await expectDomMatchesAuthority(page);
		},
		{ url },
	);
}
