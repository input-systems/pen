import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import {
	blockBox,
	charBox,
	itemsOfKind,
	localCarets,
	readSettledLayer,
	remoteCarets,
	remoteLabelBox,
	type Box,
} from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import { clickOffset } from "../specHelpers";

const FIRST_ID = "two-p1";
const SECOND_ID = "two-p2";
const REMOTE_OFFSET = 3;
const LOCAL_OFFSET = 5;
/** pen-dom's gap between a remote caret's top and its label's bottom, in layer pixels. */
const LABEL_GAP = 8;

type Ancestor = {
	readonly name: string;
	/** Inline style for the harness's React container, an ancestor of the editor root. */
	readonly style: Readonly<Record<string, string>>;
	/** Viewport pixels per layer pixel under that style. */
	readonly factor: number;
};

const ANCESTORS: readonly Ancestor[] = [
	{
		name: "transform: scale(0.5)",
		style: { transform: "scale(0.5)", "transform-origin": "0 0" },
		factor: 0.5,
	},
	{ name: "zoom: 1.5", style: { zoom: "1.5" }, factor: 1.5 },
];

function near(actual: number, expected: number, tolerance = 1): boolean {
	return Math.abs(actual - expected) <= tolerance;
}

async function styleAncestor(page: Page, style: Ancestor["style"]): Promise<void> {
	await page.evaluate((entries) => {
		const container = document.getElementById("root");
		if (!container) {
			throw new Error("missing harness container");
		}
		for (const [property, value] of Object.entries(entries)) {
			container.style.setProperty(property, value);
		}
	}, style);
}

function report(label: string, ok: boolean, detail: unknown): string {
	return formatCheckReport(label, ok ? "passed" : "failed", JSON.stringify(detail));
}

for (const ancestor of ANCESTORS) {
	scenario(
		`OV2: under ${ancestor.name} on an ancestor every overlay item sits on its text`,
		async (s, page) => {
			await s.load("two-paragraph");
			await styleAncestor(page, ancestor.style);

			// A local caret (customCaret mode), a remote caret with its label.
			await clickOffset(page, FIRST_ID, LOCAL_OFFSET);
			await expect
				.poll(async () => localCarets(await readSettledLayer(page)).length)
				.toBe(1);
			await s.geometry.flushEightRemoteCarets([
				{ blockId: FIRST_ID, offset: REMOTE_OFFSET },
			]);
			const layer = await readSettledLayer(page);
			const local = localCarets(layer)[0]!;
			const remote = remoteCarets(layer)[0]!;
			const label = await remoteLabelBox(page);
			const localChar = await charBox(page, FIRST_ID, LOCAL_OFFSET);
			const remoteChar = await charBox(page, FIRST_ID, REMOTE_OFFSET);

			// Block selection: one outline on the second paragraph.
			await page.evaluate(
				(id) => window.__penConformance.selectBlocksById([id]),
				SECOND_ID,
			);
			await expect
				.poll(async () =>
					itemsOfKind(await readSettledLayer(page), "block-outline").length,
				)
				.toBe(1);
			const outline = itemsOfKind(await readSettledLayer(page), "block-outline")[0]!;
			const block = await blockBox(page, SECOND_ID);

			await test.info().attach("ov2-scaled-ancestor", {
				body: JSON.stringify(
					{ ancestor, local, remote, label, localChar, remoteChar, outline, block },
					null,
					2,
				),
				contentType: "application/json",
			});

			const onChar = (caret: Box, char: Box): boolean =>
				near(caret.left, char.left) &&
				caret.top <= char.top + char.height / 2 &&
				caret.bottom >= char.top + char.height / 2 &&
				// Caret height tracks the line, never a doubly scaled one.
				caret.height >= char.height * 0.75 &&
				caret.height <= char.height * 1.75;
			expect(
				onChar(local.box, localChar),
				report("OV2: the local caret sits on its character", onChar(local.box, localChar), {
					caret: local.box,
					char: localChar,
				}),
			).toBe(true);
			expect(
				onChar(remote.box, remoteChar),
				report("OV2: the remote caret sits on its character", onChar(remote.box, remoteChar), {
					caret: remote.box,
					char: remoteChar,
				}),
			).toBe(true);
			const labelPlaced =
				label !== null &&
				near(label.left, remote.box.left) &&
				near(label.bottom, remote.box.top - LABEL_GAP * ancestor.factor, 1.5);
			expect(
				labelPlaced,
				report("OV2: the remote caret's label sits above it", labelPlaced, {
					label,
					caret: remote.box,
				}),
			).toBe(true);
			const outlineFits =
				near(outline.box.left, block.left) &&
				near(outline.box.top, block.top) &&
				near(outline.box.width, block.width) &&
				near(outline.box.height, block.height);
			expect(
				outlineFits,
				report("OV2: the block outline covers its block", outlineFits, {
					outline: outline.box,
					block,
				}),
			).toBe(true);
		},
		{ url: "/?customCaret=1" },
	);
}
