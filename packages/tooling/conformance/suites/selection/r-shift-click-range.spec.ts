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
const SHIFT_DIVIDER_ID = "shift-divider";

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

/** Polls the authority's text range, then checks the DOM against it (S2). */
async function expectRange(
	page: Page,
	expected: string,
	checkDom = true,
): Promise<void> {
	await expect.poll(() => textSelection(page)).toBe(expected);
	if (!checkDom) return;
	const check = await page.evaluate(() =>
		window.__penConformance.domMatchesAuthority(),
	);
	expect(check.ok, check.reason).toBe(true);
}

/** Clicks a collapsed caret at `offset` and waits for the authority to hold it. */
async function placeCaret(
	page: Page,
	blockId: string,
	offset: number,
): Promise<void> {
	await clickAt(page, blockId, offset);
	await expectRange(page, `${blockId}:${offset} -> ${blockId}:${offset}`, false);
}

/** Shift-clicks each `[blockId, fraction, offset]` atom half and expects the range from `anchor` to end there. */
async function shiftClickAtoms(
	page: Page,
	anchor: string,
	steps: ReadonlyArray<readonly [string, number, number]>,
): Promise<void> {
	for (const [blockId, fraction, offset] of steps) {
		await clickInAtom(page, blockId, fraction, true);
		await expectRange(page, `${anchor} -> ${blockId}:${offset}`);
	}
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
			await placeCaret(page, "two-p1", 2);
			await clickAt(page, "two-p2", 3, true);
			await expectRange(page, "two-p1:2 -> two-p2:3");
		},
		{ url },
	);

	scenario(
		`R1 S2 T2 T5: a shift-click on a divider extends the caret over the divider${suffix}`,
		async (s, page) => {
			await s.load("two-paragraph");
			await s.apply([
				{
					type: "insert-block",
					blockId: SHIFT_DIVIDER_ID,
					blockType: "divider",
					props: {},
					position: { after: "two-p1" },
				},
			]);
			// The vanilla tree renders a divider as a bare block element and
			// leaves its look to the host; give it a box to click.
			await page.addStyleTag({
				content: `[data-block-id="${SHIFT_DIVIDER_ID}"] { min-height: 16px; }`,
			});
			const divider = page.locator(
				`[data-pen-editor-block][data-block-id="${SHIFT_DIVIDER_ID}"]`,
			);
			await expect(divider).toBeVisible();
			await placeCaret(page, "two-p1", 2);
			await withShift(page, true, () => divider.click());
			await expectRange(page, `two-p1:2 -> ${SHIFT_DIVIDER_ID}:1`);

			// And back: from the paragraph after it, the divider's start.
			await placeCaret(page, "two-p2", 3);
			await withShift(page, true, () => divider.click());
			await expectRange(page, `two-p2:3 -> ${SHIFT_DIVIDER_ID}:0`);
		},
		{ url },
	);

	scenario(
		`R1 S2 T5: a shift-click in an earlier block extends the caret back to the clicked point${suffix}`,
		async (s, page) => {
			await s.load("two-paragraph");
			await placeCaret(page, "two-p2", 4);
			await clickAt(page, "two-p1", 1, true);
			await expectRange(page, "two-p2:4 -> two-p1:1");
		},
		{ url },
	);

	scenario(
		`R1 S2 T5: a shift-click in a right-to-left block extends to the logical offset under the pointer${suffix}`,
		async (s, page) => {
			await s.load("bidi-mixed");
			await placeCaret(page, BIDI_LTR_EMBED_ID, 2);
			// Hebrew, right to left; offset 3 is inside the first word.
			expect(BIDI_RTL_LINE_A.indexOf(" ")).toBeGreaterThan(3);
			await clickAtRtl(page, BIDI_RTL_LINE_A_ID, 3, true);
			await expectRange(
				page,
				`${BIDI_LTR_EMBED_ID}:2 -> ${BIDI_RTL_LINE_A_ID}:3`,
			);
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
			await placeCaret(page, ATOM.end, 2);
			// "Hello " @Ada " world": the atom is 6..7, left to right.
			// "مرحبا " @Ada " عالم": the atom is 6..7, right to left, so its
			// visual left half is its logical end.
			await shiftClickAtoms(page, `${ATOM.end}:2`, [
				[ATOM.mid, ATOM_RIGHT_HALF, 7],
				[ATOM.mid, ATOM_LEFT_HALF, 6],
				[ATOM.rtl, ATOM_LEFT_HALF, 7],
				[ATOM.rtl, ATOM_RIGHT_HALF, 6],
			]);
		},
		{ url },
	);

	scenario(
		`R1 S2 T5 O1: a shift-click inside an atom extends from a block selection in another block${suffix}`,
		async (s, page) => {
			await s.load("atom-caret");
			await page.evaluate(
				(id) => window.__penConformance.selectBlocksById([id]),
				ATOM.end,
			);
			await expect
				.poll(() =>
					page.evaluate(() => {
						const state =
							window.__penConformance.selectionRecord?.state ?? null;
						return state?.type === "block" ? state.blockIds.join(",") : null;
					}),
				)
				.toBe(ATOM.end);

			// The anchor is the block selection's start; the atom in ac-mid is
			// 6..7 left to right, so its right half is its logical end.
			await shiftClickAtoms(page, `${ATOM.end}:0`, [
				[ATOM.mid, ATOM_RIGHT_HALF, 7],
			]);
		},
		{ url },
	);

	scenario(
		`R1 S2 T5 O1: a shift-click inside an atom takes the side in its bidi run's direction, not the block's${suffix}`,
		async (s, page) => {
			await s.load("atom-caret");
			await placeCaret(page, ATOM.end, 2);
			// "مرحبا abc " @Ada " def عالم": the atom is 10..11 in a left-to-right
			// run inside a right-to-left block, so its visual left half is its
			// logical start. "hello שלום " @דנה " עולם world": the atom is
			// 11..12 in a right-to-left run inside a left-to-right block, so its
			// visual right half is its logical start.
			await shiftClickAtoms(page, `${ATOM.end}:2`, [
				[ATOM.rtlBlockLtrRun, ATOM_LEFT_HALF, 10],
				[ATOM.rtlBlockLtrRun, ATOM_RIGHT_HALF, 11],
				[ATOM.ltrBlockRtlRun, ATOM_RIGHT_HALF, 11],
				[ATOM.ltrBlockRtlRun, ATOM_LEFT_HALF, 12],
			]);
		},
		{ url },
	);
}
