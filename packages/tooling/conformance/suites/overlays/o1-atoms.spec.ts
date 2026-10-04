import { expect, type Page } from "@playwright/test";
import {
	ATOM_CARET_IDS as ID,
	ATOM_CARET_WRAP_PREFIX,
} from "../../fixtures/atomCaret";
import { localCarets, readSettledLayer } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import type { GeometryLineBox, ScenarioApi } from "../../src/types";

/**
 * O1, O2, N1, M2, G1, G3 beside inline atoms and chips (W35.G7, §6.3). Every
 * scenario runs on the React surface and on `?surface=vanilla`, so the same
 * caret is drawn by the pen-dom overlay under both bindings.
 */

const SURFACES = [
	{ name: "react", url: "/" },
	{ name: "vanilla", url: "/?surface=vanilla" },
] as const;

/** Viewport widths searched for the `ac-wrap` break; the prefix wraps several times in this range. */
const WRAP_SEARCH_MAX_WIDTH = 480;
const WRAP_SEARCH_MIN_WIDTH = 240;

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
/** `leading`/`trailing` are logical (the side of travel in the block's direction); `left`/`right` are visual. */
type Edge = "leading" | "trailing" | "left" | "right";

async function atomBox(page: Page, blockId: string, index = 0): Promise<Box> {
	return page.evaluate(
		({ id, nth }) => {
			const atoms = document.querySelectorAll(
				`[data-pen-editor-block][data-block-id="${id}"] [data-pen-inline-atom]`,
			);
			const atom = atoms[nth];
			if (!(atom instanceof HTMLElement)) {
				throw new Error(`missing atom ${nth} in ${id}`);
			}
			const r = atom.getBoundingClientRect();
			return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
		},
		{ id: blockId, nth: index },
	);
}

async function blockDirection(page: Page, blockId: string): Promise<"ltr" | "rtl"> {
	return page.evaluate((id) => {
		const inline = document.querySelector(
			`[data-pen-editor-block][data-block-id="${id}"] [data-pen-inline-content]`,
		);
		return inline instanceof HTMLElement && getComputedStyle(inline).direction === "rtl"
			? "rtl"
			: "ltr";
	}, blockId);
}

/**
 * In page: the least free room at the end of any line from the block start
 * through its first atom. Line extents come from the range's client rects,
 * grouped by vertical overlap; a hanging trailing space only shrinks the
 * room, so the narrowing step never overshoots a break.
 */
function tightestLineRoom(blockId: string): number {
	const block = document.querySelector(`[data-pen-editor-block][data-block-id="${blockId}"]`);
	const inline = block?.querySelector("[data-pen-inline-content]");
	const atom = block?.querySelector("[data-pen-inline-atom]");
	if (!(inline instanceof HTMLElement) || !atom) {
		throw new Error(`missing inline content or atom in ${blockId}`);
	}
	const style = getComputedStyle(inline);
	const lineEnd =
		inline.getBoundingClientRect().right -
		parseFloat(style.paddingRight) -
		parseFloat(style.borderRightWidth);
	const range = document.createRange();
	range.setStart(inline, 0);
	range.setEndAfter(atom);
	const lineRows: { top: number; bottom: number; right: number }[] = [];
	for (const rect of range.getClientRects()) {
		if (rect.width === 0) continue;
		const row = lineRows.find(
			(r) =>
				Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top) >
				Math.min(r.bottom - r.top, rect.height) / 2,
		);
		if (row) {
			row.right = Math.max(row.right, rect.right);
		} else {
			lineRows.push({ top: rect.top, bottom: rect.bottom, right: rect.right });
		}
	}
	return Math.min(...lineRows.map((row) => lineEnd - row.right));
}

/**
 * Narrow the viewport until `ac-wrap` soft-wraps right before its atom, so
 * the atom starts a line. Where the break lands depends on the platform's
 * font metrics, so the width is found by measuring rather than assumed.
 * Each step narrows by one pixel more than the tightest line's free room
 * (over the lines up to the atom), so exactly one break moves per step and
 * the width where the atom is pushed to a fresh line cannot be skipped.
 */
async function narrowUntilWrapBeforeAtom(
	s: ScenarioApi,
	page: Page,
): Promise<{ lines: GeometryLineBox[]; wrap: GeometryLineBox }> {
	let lines: GeometryLineBox[] = [];
	let width = WRAP_SEARCH_MAX_WIDTH;
	while (width >= WRAP_SEARCH_MIN_WIDTH) {
		await page.setViewportSize({ width, height: 800 });
		await s.geometry.invalidate();
		lines = await s.geometry.lineBoxes(ID.wrap);
		const wrap = lines.find(
			(line, i) => i > 0 && line.startOffset === ATOM_CARET_WRAP_PREFIX.length,
		);
		if (wrap) return { lines, wrap };
		const room = await page.evaluate(tightestLineRoom, ID.wrap);
		width -= Math.max(1, Math.floor(room) + 1);
	}
	throw new Error(
		`ac-wrap never wraps right before the atom between ${WRAP_SEARCH_MIN_WIDTH} and ${WRAP_SEARCH_MAX_WIDTH} px: ${JSON.stringify(lines)}`,
	);
}

/** Click just outside one side of an atom, vertically centred on it. */
async function clickBesideAtom(
	page: Page,
	blockId: string,
	side: "left" | "right",
	index = 0,
	gap = 1,
): Promise<void> {
	const box = await atomBox(page, blockId, index);
	const x = side === "left" ? box.left - gap : box.right + gap;
	await page.mouse.click(x, box.top + box.height / 2);
}

async function recordFocus(page: Page): Promise<{ offset: number; anchor: number; type: string } | null> {
	return page.evaluate(() => {
		const state = window.__penConformance.selectionRecord?.state ?? null;
		if (state?.type !== "text") return null;
		return { type: state.type, anchor: state.anchor.offset, focus: state.focus.offset, offset: state.focus.offset };
	});
}

async function expectSelection(page: Page, blockId: string, anchor: number, focus: number): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const state = window.__penConformance.selectionRecord?.state ?? null;
				if (state?.type !== "text") return null;
				return {
					anchor: `${state.anchor.blockId}@${state.anchor.offset}`,
					focus: `${state.focus.blockId}@${state.focus.offset}`,
				};
			}),
		)
		.toEqual({ anchor: `${blockId}@${anchor}`, focus: `${blockId}@${focus}` });
}

async function lineBoxAt(s: ScenarioApi, blockId: string, offset: number, near: Box) {
	const lines = await s.geometry.lineBoxes(blockId);
	const containing = lines.filter((line) => line.startOffset <= offset && offset <= line.endOffset);
	const centre = (near.top + near.bottom) / 2;
	return (
		containing.find((line) => line.top <= centre && centre <= line.bottom) ??
		containing[0] ??
		null
	);
}

/**
 * The §6.3 standard assertion: the authority record, exactly one local caret
 * in the layer naming the point, its x on the named chip edge, its top and
 * height on the line box (not the chip), `caret-color: transparent` on the
 * field, and the standing OV4 and DOM-authority checks.
 */
async function expectAtomCaret(
	s: ScenarioApi,
	page: Page,
	args: { blockId: string; offset: number; edge: Edge; atomIndex?: number },
): Promise<void> {
	await expectSelection(page, args.blockId, args.offset, args.offset);
	await expect
		.poll(async () => localCarets(await readSettledLayer(page)).length)
		.toBe(1);
	const layer = await readSettledLayer(page);
	const caret = localCarets(layer)[0]!;
	expect(caret.blockId).toBe(args.blockId);
	expect(caret.offset).toBe(String(args.offset));
	expect(caret.affinity === "upstream" || caret.affinity === "downstream").toBe(true);

	const atom = await atomBox(page, args.blockId, args.atomIndex ?? 0);
	const direction = await blockDirection(page, args.blockId);
	const visual =
		args.edge === "left" || args.edge === "right"
			? args.edge
			: (args.edge === "leading") === (direction === "ltr")
				? "left"
				: "right";
	const edgeX = visual === "left" ? atom.left : atom.right;
	const caretX = caret.box.left + caret.box.width / 2;
	expect(Math.abs(caretX - edgeX), `caret x ${caretX} vs ${visual} chip edge ${edgeX}`).toBeLessThanOrEqual(1.5);

	const line = await lineBoxAt(s, args.blockId, args.offset, atom);
	expect(line, "a line box contains the caret").not.toBeNull();
	expect(Math.abs(caret.box.top - line!.top)).toBeLessThanOrEqual(1);
	expect(Math.abs(caret.box.height - (line!.bottom - line!.top))).toBeLessThanOrEqual(1);

	expect(layer.caretColor).toBe("transparent");
	await s.assert.domMatchesAuthority();
}

async function expectNoLocalCaret(page: Page): Promise<void> {
	await expect
		.poll(async () => localCarets(await readSettledLayer(page)).length)
		.toBe(0);
}

for (const surface of SURFACES) {
	const on = (title: string) => `${title} (${surface.name})`;
	const options = { url: surface.url };

	scenario(on("O1: a caret after a mention sits on the mention's trailing edge"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.mid, "right");
		await expectAtomCaret(s, page, { blockId: ID.mid, offset: 7, edge: "trailing" });
	}, options);

	scenario(on("O1: a caret before a mention sits on its leading edge"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.mid, "left");
		await expectAtomCaret(s, page, { blockId: ID.mid, offset: 6, edge: "leading" });
	}, options);

	scenario(on("O1: a caret on either side of an inlineApp sits on that side's edge"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.app, "left");
		await expectAtomCaret(s, page, { blockId: ID.app, offset: 4, edge: "leading" });
		await clickBesideAtom(page, ID.app, "right");
		await expectAtomCaret(s, page, { blockId: ID.app, offset: 5, edge: "trailing" });
	}, options);

	scenario(on("O1: an atom at block start takes the caret on its leading edge at offset 0"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.start, "right", 0, 12);
		await s.keyboard.press("Home");
		await expectAtomCaret(s, page, { blockId: ID.start, offset: 0, edge: "leading" });
	}, options);

	scenario(on("O1: End in a block that ends with an atom puts the caret after it"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.end, "left", 0, 18);
		await s.keyboard.press("End");
		await expectAtomCaret(s, page, { blockId: ID.end, offset: 6, edge: "trailing" });
	}, options);

	scenario(on("N1: an atom-only block takes a caret on either side and is not drawn as an empty block"), async (s, page) => {
		await s.load("atom-caret");
		// `ac-pair` is the block above `ac-only`.
		await clickBesideAtom(page, ID.pair, "right", 1, 12);
		await s.keyboard.press("ArrowDown");
		await s.keyboard.press("End");
		await expectAtomCaret(s, page, { blockId: ID.only, offset: 1, edge: "trailing" });
		await s.keyboard.press("Home");
		await expectAtomCaret(s, page, { blockId: ID.only, offset: 0, edge: "leading" });
	}, options);

	scenario(on("N1: between two adjacent atoms the caret sits between them and ArrowRight selects the second"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.pair, "left", 1, 0);
		await expectAtomCaret(s, page, { blockId: ID.pair, offset: 3, edge: "leading", atomIndex: 1 });
		await s.keyboard.press("ArrowRight");
		await expectSelection(page, ID.pair, 3, 4);
		await expectNoLocalCaret(page);
	}, options);

	scenario(on("N1: ArrowRight beside a mention selects it, hides the overlay caret, and a second ArrowRight collapses after it"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.mid, "left");
		await expectSelection(page, ID.mid, 6, 6);
		await s.keyboard.press("ArrowRight");
		await expectSelection(page, ID.mid, 6, 7);
		await expectNoLocalCaret(page);
		await s.keyboard.press("ArrowRight");
		await expectAtomCaret(s, page, { blockId: ID.mid, offset: 7, edge: "trailing" });
	}, options);

	scenario(on("N1: ArrowLeft beside a mention selects it and does not hang (WebKit, Firefox)"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.mid, "right");
		await expectSelection(page, ID.mid, 7, 7);
		await s.keyboard.press("ArrowLeft");
		// A plain arrow selects the atom start..end; only a shift-extend orients it.
		await expectSelection(page, ID.mid, 6, 7);
		await s.keyboard.press("ArrowLeft");
		await expectSelection(page, ID.mid, 6, 6);
		await s.keyboard.type("z");
		await expect
			.poll(() => page.evaluate((id) => window.__penConformance.blockText(id), ID.mid))
			.toContain("Hello z");
	}, options);

	scenario(on("N1: Shift+ArrowRight extends across a mention in one step"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.mid, "left");
		await expectSelection(page, ID.mid, 6, 6);
		await s.keyboard.press("Shift+ArrowRight");
		await expectSelection(page, ID.mid, 6, 7);
	}, options);

	scenario(on("M2: in an RTL block ArrowLeft beside an atom selects the logically following atom"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.rtl, "right");
		await expectSelection(page, ID.rtl, 6, 6);
		await s.keyboard.press("ArrowLeft");
		await expectSelection(page, ID.rtl, 6, 7);
	}, options);

	scenario(on("BR2 G3: a caret beside an atom inside an RTL run sits on the visually correct edge"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.rtl, "right");
		await expectAtomCaret(s, page, { blockId: ID.rtl, offset: 6, edge: "right" });
		await clickBesideAtom(page, ID.rtl, "left");
		await expectAtomCaret(s, page, { blockId: ID.rtl, offset: 7, edge: "left" });
	}, options);

	scenario(on("G3: at a soft wrap beside an atom the caret follows affinity"), async (s, page) => {
		await s.load("atom-caret");
		const { lines, wrap } = await narrowUntilWrapBeforeAtom(s, page);
		const offset = wrap.startOffset;
		const upper = lines[lines.indexOf(wrap) - 1]!;
		await clickBesideAtom(page, ID.wrap, "right");
		for (const [affinity, line] of [["upstream", upper], ["downstream", wrap]] as const) {
			await page.evaluate(
				({ id, at, a }) => window.__penConformance.selectCaretWithAffinity(id, at, a),
				{ id: ID.wrap, at: offset, a: affinity },
			);
			await expect
				.poll(async () => {
					const caret = localCarets(await readSettledLayer(page))[0];
					return caret ? Math.abs(caret.box.top - line.top) <= 1 : false;
				}, { message: `${affinity} caret on its line` })
				.toBe(true);
		}
	}, options);

	scenario(on("O1: clicking either half of a chip puts the caret on that side"), async (s, page) => {
		await s.load("atom-caret");
		const chip = await atomBox(page, ID.mid);
		const y = chip.top + chip.height / 2;
		await page.mouse.click(chip.left + chip.width / 2 - 2, y);
		await expectAtomCaret(s, page, { blockId: ID.mid, offset: 6, edge: "leading" });
		await page.mouse.click(chip.left + chip.width / 2 + 2, y);
		await expectAtomCaret(s, page, { blockId: ID.mid, offset: 7, edge: "trailing" });
	}, options);

	scenario(on("O1: clicking the empty tail after a block-final atom puts the caret after it"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.end, "right", 0, 40);
		await expectAtomCaret(s, page, { blockId: ID.end, offset: 6, edge: "trailing" });
	}, options);

	scenario(on("O1: typing after a mention hands the caret back to the native caret"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.mid, "right");
		await expectAtomCaret(s, page, { blockId: ID.mid, offset: 7, edge: "trailing" });
		await s.keyboard.type("x");
		await expectNoLocalCaret(page);
		const layer = await readSettledLayer(page);
		expect(layer.caretColor === "" || layer.caretColor === null).toBe(true);
	}, options);

	scenario(on("O2: deleting the only atom in a block hands the caret to the empty-block overlay"), async (s, page) => {
		await s.load("atom-caret");
		await clickBesideAtom(page, ID.only, "right");
		await expectSelection(page, ID.only, 1, 1);
		await s.keyboard.press("Backspace");
		// The first Backspace selects the atom (start..end), the second deletes it.
		await expectSelection(page, ID.only, 0, 1);
		await s.keyboard.press("Backspace");
		await expectSelection(page, ID.only, 0, 0);
		await expect
			.poll(async () => localCarets(await readSettledLayer(page)).length)
			.toBe(1);
		const caret = localCarets(await readSettledLayer(page))[0]!;
		expect(caret.box.height).toBeGreaterThanOrEqual(16);
	}, options);

	scenario(on("O2: an empty block draws the overlay caret on the placeholder line box"), async (s, page) => {
		await s.load("atom-caret");
		const empty = page.locator(`[data-pen-editor-block][data-block-id="${ID.empty}"]`);
		await empty.click();
		await expectSelection(page, ID.empty, 0, 0);
		await expect
			.poll(async () => localCarets(await readSettledLayer(page)).length)
			.toBe(1);
		const caret = localCarets(await readSettledLayer(page))[0]!;
		const placeholder = await page.evaluate((id) => {
			const br = document.querySelector(
				`[data-pen-editor-block][data-block-id="${id}"] br[data-pen-empty]`,
			);
			if (!(br instanceof HTMLElement)) return null;
			const range = document.createRange();
			range.selectNode(br);
			const r = range.getBoundingClientRect();
			return { top: r.top, height: r.height };
		}, ID.empty);
		expect(placeholder, "the empty block renders its placeholder <br>").not.toBeNull();
		expect(Math.abs(caret.box.top - placeholder!.top)).toBeLessThanOrEqual(1);
		expect(Math.abs(caret.box.height - placeholder!.height)).toBeLessThanOrEqual(1);
	}, options);

	scenario(on("O1: the caret beside a chip is as tall as the text line, not the chip"), async (s, page) => {
		await s.load("atom-caret");
		await page.addStyleTag({ content: "[data-pen-inline-atom] { padding: 6px; }" });
		await clickBesideAtom(page, ID.mid, "right");
		await expectAtomCaret(s, page, { blockId: ID.mid, offset: 7, edge: "trailing" });
		const chip = await atomBox(page, ID.mid);
		const caret = localCarets(await readSettledLayer(page))[0]!;
		expect(caret.box.height).toBeLessThan(chip.height);
	}, options);

	scenario(on("G1: a mention between words adds no line box"), async (s, page) => {
		await page.setViewportSize({ width: 600, height: 800 });
		await s.load("atom-caret");
		const lines = await s.geometry.lineBoxes(ID.mid);
		expect(lines, JSON.stringify(lines)).toHaveLength(1);
	}, options);
}
