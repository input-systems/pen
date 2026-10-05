import { expect, type Page } from "@playwright/test";
import {
	blockBox,
	charBox,
	expectCheck,
	itemsOfKind,
	near,
	readSettledLayer,
	remoteCarets,
} from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import { attachJson } from "../specHelpers";

const FIRST_ID = "two-p1";
const SECOND_ID = "two-p2";
const REMOTE_OFFSET = 3;
const SPACER_GROWTH = 120;

/** Host content above the editor, outside React: a sibling before the harness container. */
async function insertSpacer(page: Page): Promise<void> {
	await page.evaluate(() => {
		const spacer = document.createElement("div");
		spacer.setAttribute("data-conformance-spacer", "");
		spacer.style.height = "0px";
		document.body.insertBefore(spacer, document.getElementById("root"));
	});
}

async function growSpacer(page: Page, height: number): Promise<void> {
	await page.evaluate((next) => {
		const spacer = document.querySelector<HTMLElement>("[data-conformance-spacer]");
		spacer!.style.height = `${next}px`;
		// Let ResizeObserver and any scheduled flush run before the read.
		return new Promise<void>((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}, height);
}

scenario(
	"OV2: when host content above the editor grows, the remote caret and the block outline follow their text with no selection change",
	async (s, page) => {
		await s.load("two-paragraph");
		await insertSpacer(page);
		await page.evaluate(
			(id) => window.__penConformance.selectBlocksById([id]),
			SECOND_ID,
		);
		await s.geometry.flushEightRemoteCarets([
			{ blockId: FIRST_ID, offset: REMOTE_OFFSET },
		]);
		const before = await readSettledLayer(page);
		expect(remoteCarets(before)).toHaveLength(1);
		expect(itemsOfKind(before, "block-outline")).toHaveLength(1);
		const versionBefore = before.selectionVersion;

		await growSpacer(page, SPACER_GROWTH);

		const after = await readSettledLayer(page);
		const caret = remoteCarets(after)[0]!;
		const outline = itemsOfKind(after, "block-outline")[0]!;
		const char = await charBox(page, FIRST_ID, REMOTE_OFFSET);
		const block = await blockBox(page, SECOND_ID);
		await attachJson("ov2-moved-root", { before, after, char, block });

		expect(after.selectionVersion, "no local selection change").toBe(versionBefore);
		expectCheck(
			"OV2: the remote caret moved with its text",
			near(caret.box.left, char.left) &&
				caret.box.top <= char.top + char.height / 2 &&
				caret.box.bottom >= char.top + char.height / 2,
			`caret=${JSON.stringify(caret.box)} char=${JSON.stringify(char)}`,
		);
		expectCheck(
			"OV2: the block outline moved with its block",
			near(outline.box.left, block.left) &&
				near(outline.box.top, block.top) &&
				near(outline.box.height, block.height),
			`outline=${JSON.stringify(outline.box)} block=${JSON.stringify(block)}`,
		);
	},
);
