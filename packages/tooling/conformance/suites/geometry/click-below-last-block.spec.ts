import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import { FocusPoint, logLoad, readBlockIds } from "../specHelpers";

const LAST_ID = "two-p2";
const LAST_TEXT = "Delta echo foxtrot";

/**
 * G4 (`g4-click-outside.spec.ts`) now calls GeometryReader.pointAt. That is
 * the right probe for the geometry rule, and it must not insert. The hole it
 * left is this host gesture: a real click in the empty canvas below the last
 * block. React's `handleClickOutsideBlocks` (`useEditorContentGestures.ts`)
 * inserts a trailing paragraph when the adjacent block is non-empty, or
 * focuses an empty adjacent text block. Vanilla and Vue do not — they place
 * the caret at the last text block's end (`handleFieldEditorPointerActivate`).
 *
 * This harness is React, so the scenarios assert the React contract. The
 * binding split is documented in `spec/packages/rendering/react.md`; it is
 * not a G4 failure.
 *
 * The content surface is tight around the blocks. Hosts that want this UX
 * give the canvas height; the probe does the same so the click lands on
 * `[data-pen-editor-content]` below the last block, not on the block and
 * not on harness padding.
 */
type HostChrome = {
	content: { top: number; bottom: number; left: number; right: number } | null;
	last: { top: number; bottom: number; left: number; right: number } | null;
};

type Hit = {
	isContent: boolean;
	isBlock: boolean;
};

type Snapshot = {
	blockOrder: readonly string[];
	blocks: readonly { id: string; type: string; text: string }[];
};

async function readSnapshot(page: Page): Promise<Snapshot> {
	return page.evaluate(() => window.__penConformance.documentSnapshot());
}

async function readFocus(page: Page): Promise<FocusPoint> {
	return page.evaluate(() => {
		const selection = window.__penConformance.selection;
		if (selection?.type !== "text") {
			return null;
		}
		return {
			blockId: selection.focus.blockId,
			offset: selection.focus.offset,
		};
	});
}

async function stretchCanvas(page: Page): Promise<void> {
	await page.evaluate(() => {
		const content = document.querySelector("[data-pen-editor-content]");
		if (!(content instanceof HTMLElement)) {
			throw new Error("missing editor content");
		}
		content.style.minHeight = "480px";
		content.style.boxSizing = "border-box";
	});
}

async function readChrome(page: Page): Promise<HostChrome> {
	return page.evaluate((lastId) => {
		const box = (element: Element | null) => {
			if (!(element instanceof HTMLElement)) {
				return null;
			}
			const rect = element.getBoundingClientRect();
			return {
				left: rect.left,
				right: rect.right,
				top: rect.top,
				bottom: rect.bottom,
			};
		};
		return {
			content: box(document.querySelector("[data-pen-editor-content]")),
			last: box(document.querySelector(`[data-block-id="${lastId}"]`)),
		};
	}, LAST_ID);
}

async function hitAt(
	page: Page,
	x: number,
	y: number,
): Promise<Hit> {
	return page.evaluate(
		({ clientX, clientY }) => {
			const node = document.elementFromPoint(clientX, clientY);
			const element =
				node instanceof HTMLElement
					? node
					: node instanceof Node
						? node.parentElement
						: null;
			return {
				isContent: Boolean(
					element?.closest("[data-pen-editor-content]"),
				),
				isBlock: Boolean(element?.closest("[data-pen-editor-block]")),
			};
		},
		{ clientX: x, clientY: y },
	);
}

async function clickBelowLast(page: Page): Promise<{
	chrome: HostChrome;
	probe: { x: number; y: number };
	hit: Hit;
}> {
	await stretchCanvas(page);
	const chrome = await readChrome(page);
	expect(
		chrome.last && chrome.content,
		formatCheckReport(
			"click-below: last block and content are on screen",
			chrome.last && chrome.content ? "passed" : "failed",
			JSON.stringify(chrome),
		),
	).toBeTruthy();

	const x = (chrome.last!.left + chrome.last!.right) / 2;
	const y = chrome.last!.bottom + 24;
	expect(
		y < chrome.content!.bottom,
		formatCheckReport(
			"click-below: probe sits in the stretched canvas under the last block",
			y < chrome.content!.bottom ? "passed" : "failed",
			`y=${y} content.bottom=${chrome.content!.bottom} last.bottom=${chrome.last!.bottom}`,
		),
	).toBe(true);

	const hit = await hitAt(page, x, y);
	expect(
		hit.isContent && !hit.isBlock,
		formatCheckReport(
			"click-below: probe lands on empty content, not a block",
			hit.isContent && !hit.isBlock ? "passed" : "failed",
			JSON.stringify(hit),
		),
	).toBe(true);

	await page.mouse.click(x, y);
	return { chrome, probe: { x, y }, hit };
}

scenario(
	"host chrome: click below a non-empty last block inserts a trailing paragraph and places the caret",
	async (s, page) => {
		const loads = logLoad("click-below-nonempty");
		await s.load("two-paragraph");
		const beforeIds = await readBlockIds(page);
		const beforeFocus = await readFocus(page);

		const { chrome, probe, hit } = await clickBelowLast(page);

		await expect
			.poll(async () => (await readBlockIds(page)).length)
			.toBe(beforeIds.length + 1);

		const after = await readSnapshot(page);
		const insertedId = after.blockOrder[after.blockOrder.length - 1] ?? null;
		const inserted = after.blocks.find((block) => block.id === insertedId);
		const lastKept = after.blocks.find((block) => block.id === LAST_ID);

		await expect
			.poll(async () => readFocus(page))
			.toEqual({ blockId: insertedId, offset: 0 });

		const afterFocus = await readFocus(page);
		await test.info().attach("click-below-nonempty", {
			body: JSON.stringify(
				{
					loadavg: loads,
					chrome,
					probe,
					hit,
					beforeIds,
					beforeFocus,
					after,
					afterFocus,
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			after.blockOrder.slice(0, -1),
			formatCheckReport(
				"click-below: existing blocks stay, new block is last",
				after.blockOrder.length === beforeIds.length + 1 &&
					after.blockOrder.slice(0, -1).join(",") ===
						beforeIds.join(",")
					? "passed"
					: "failed",
				`before=${beforeIds.join(",")} after=${after.blockOrder.join(",")}`,
			),
		).toEqual(beforeIds);
		expect(
			inserted?.type === "paragraph" && inserted.text === "",
			formatCheckReport(
				"click-below: inserted block is an empty paragraph",
				inserted?.type === "paragraph" && inserted.text === ""
					? "passed"
					: "failed",
				JSON.stringify(inserted ?? null),
			),
		).toBe(true);
		expect(
			lastKept?.text,
			formatCheckReport(
				"click-below: last block text is unchanged",
				lastKept?.text === LAST_TEXT ? "passed" : "failed",
				`last=${JSON.stringify(lastKept ?? null)}`,
			),
		).toBe(LAST_TEXT);
		expect(
			afterFocus,
			formatCheckReport(
				"click-below: caret is at offset 0 of the inserted paragraph",
				afterFocus?.blockId === insertedId && afterFocus.offset === 0
					? "passed"
					: "failed",
				`focus=${JSON.stringify(afterFocus)} inserted=${insertedId}`,
			),
		).toEqual({ blockId: insertedId, offset: 0 });
		await s.assert.domMatchesAuthority();
	},
);

scenario(
	"host chrome: click below an empty last block focuses it and does not insert",
	async (s, page) => {
		const loads = logLoad("click-below-empty");
		await s.load("two-paragraph");
		await s.apply([
			{
				type: "splice-text",
				blockId: LAST_ID,
				from: 0,
				to: LAST_TEXT.length,
				insert: "",
			},
		]);
		const beforeIds = await readBlockIds(page);
		const beforeFocus = await readFocus(page);

		const { chrome, probe, hit } = await clickBelowLast(page);

		await expect
			.poll(async () => readFocus(page))
			.toEqual({ blockId: LAST_ID, offset: 0 });

		const afterIds = await readBlockIds(page);
		const afterFocus = await readFocus(page);
		await test.info().attach("click-below-empty", {
			body: JSON.stringify(
				{
					loadavg: loads,
					chrome,
					probe,
					hit,
					beforeIds,
					beforeFocus,
					afterIds,
					afterFocus,
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			afterIds,
			formatCheckReport(
				"click-below: empty last block is reused, no insert",
				afterIds.length === beforeIds.length &&
					afterIds[afterIds.length - 1] === LAST_ID
					? "passed"
					: "failed",
				`before=${beforeIds.join(",")} after=${afterIds.join(",")}`,
			),
		).toEqual(beforeIds);
		expect(
			afterFocus,
			formatCheckReport(
				"click-below: caret is at offset 0 of the empty last block",
				afterFocus?.blockId === LAST_ID && afterFocus.offset === 0
					? "passed"
					: "failed",
				`focus=${JSON.stringify(afterFocus)}`,
			),
		).toEqual({ blockId: LAST_ID, offset: 0 });
		await s.assert.domMatchesAuthority();
	},
);
