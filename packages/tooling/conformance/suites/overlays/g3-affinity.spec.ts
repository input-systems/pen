import { expect, type Page } from "@playwright/test";
import {
	expectCheck,
	insertMention,
	localCarets,
	readSettledLayer,
} from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import type { GeometryLineBox } from "../../src/types";
import { attachJson } from "../specHelpers";

const WRAP_ID = "g5-wrap";
const ATOM_OFFSET = 8;

/** Narrow the block to a 40px monospace column so the chip sits on a line of its own. */
async function forceWrap(page: Page): Promise<void> {
	await page.evaluate((id) => {
		const block = document.querySelector(`[data-pen-editor-block][data-block-id="${id}"]`);
		const inline = block?.querySelector("[data-pen-inline-content]");
		if (!(block instanceof HTMLElement) || !(inline instanceof HTMLElement)) {
			throw new Error("g3: missing wrap block");
		}
		block.style.maxWidth = "40px";
		inline.style.display = "block";
		inline.style.width = "40px";
		inline.style.maxWidth = "40px";
		inline.style.font = '16px / 20px ui-monospace, "Courier New", Menlo, monospace';
		inline.style.wordBreak = "break-all";
		inline.style.overflowWrap = "anywhere";
	}, WRAP_ID);
}

async function caretTopFor(
	page: Page,
	offset: number,
	affinity: "upstream" | "downstream",
): Promise<{ top: number; affinity: string | null; offset: string | null } | null> {
	await page.evaluate(
		({ id, at, side }) => {
			window.__penConformance.selectCaretWithAffinity(id, at, side);
		},
		{ id: WRAP_ID, at: offset, side: affinity },
	);
	const caret = localCarets(await readSettledLayer(page))[0];
	return caret ? { top: caret.box.top, affinity: caret.affinity, offset: caret.offset } : null;
}

scenario(
	"G3: the overlay caret at a soft-wrap boundary sits on the line its affinity names",
	async (s, page) => {
		await s.load("g5-geometry");
		await s.apply([insertMention(WRAP_ID, ATOM_OFFSET)]);
		await forceWrap(page);
		await page.evaluate(() => window.__penConformance.invalidateGeometry());
		await page.locator(`[data-pen-editor-block][data-block-id="${WRAP_ID}"] [data-pen-inline-content]`).click();
		const lines: GeometryLineBox[] = await page.evaluate(
			(id) => window.__penConformance.geometryLineBoxes(id),
			WRAP_ID,
		);
		// The wrap is on one side of the chip: before it (the chip starts a
		// line) or after it (the chip ends one), depending on the engine.
		const wrap = [ATOM_OFFSET, ATOM_OFFSET + 1].find(
			(offset) =>
				lines.some((line) => line.endOffset === offset) &&
				lines.some((line) => line.startOffset === offset),
		);
		const upper = lines.find((line) => line.endOffset === wrap);
		const lower = lines.find((line) => line.startOffset === wrap);
		await attachJson("g3-lines", lines);
		expectCheck(
			"G3: an offset beside the atom is a soft wrap",
			Boolean(upper && lower),
			`lines=${JSON.stringify(lines)}`,
		);

		const upstream = await caretTopFor(page, wrap!, "upstream");
		const downstream = await caretTopFor(page, wrap!, "downstream");
		await attachJson("g3-carets", { upstream, downstream });
		expect(upstream?.affinity).toBe("upstream");
		expect(downstream?.affinity).toBe("downstream");
		// On a line: the caret's top lies inside that line box. A line that
		// holds a padded chip is taller than the text, and the caret's height
		// beside a chip is W35.R16 (step 5), so only the line is pinned here.
		const onLine = (top: number | undefined, line: GeometryLineBox) =>
			top !== undefined && top >= line.top - 1 && top < line.bottom;
		expectCheck(
			"G3: upstream draws on the upper line",
			onLine(upstream?.top, upper!),
			`caret=${upstream?.top} upper=${JSON.stringify(upper)}`,
		);
		expectCheck(
			"G3: downstream draws on the lower line",
			onLine(downstream?.top, lower!),
			`caret=${downstream?.top} lower=${JSON.stringify(lower)}`,
		);
	},
);
