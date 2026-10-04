import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { scenario } from "../../src/scenario";
import { logLoad, readBlockIds, readSelection } from "../specHelpers";

const FIRST_ID = "two-p1";
const LAST_ID = "two-p2";
const LAST_TEXT = "Delta echo foxtrot";
const GUTTER_PX = 40;

/**
 * G4's companion for pointer gestures. `click-below-last-block.spec.ts` pins
 * what a host-chrome *click* does; this pins the *drag*. A drag whose
 * mousedown lands beside the column rather than on a block used to be inert
 * — `contentGesturesDrag` had no gesture to move, so mousemove and mouseup
 * both no-oped and the pointer produced nothing at all.
 *
 * The harness content surface is tight around the blocks, so these scenarios
 * add their own gutter: the probe has to land on
 * `[data-pen-editor-content]` beside a block, which is the strip a real host
 * gets from a centered column with padding.
 */
type Box = { left: number; right: number; top: number; bottom: number };

type HostChrome = {
	content: Box | null;
	first: Box | null;
	last: Box | null;
};

type Hit = { isContent: boolean; isBlock: boolean };

/** Give the column a gutter wide enough to aim at. */
async function padContent(page: Page): Promise<void> {
	await page.evaluate((gutter) => {
		const content = document.querySelector("[data-pen-editor-content]");
		if (!(content instanceof HTMLElement)) {
			throw new Error("missing editor content");
		}
		content.style.boxSizing = "border-box";
		content.style.paddingLeft = `${gutter}px`;
		content.style.paddingRight = `${gutter}px`;
	}, GUTTER_PX);
}

async function readChrome(page: Page): Promise<HostChrome> {
	return page.evaluate(
		(ids) => {
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
				content: box(
					document.querySelector("[data-pen-editor-content]"),
				),
				first: box(
					document.querySelector(`[data-block-id="${ids.first}"]`),
				),
				last: box(
					document.querySelector(`[data-block-id="${ids.last}"]`),
				),
			};
		},
		{ first: FIRST_ID, last: LAST_ID },
	);
}

async function hitAt(page: Page, x: number, y: number): Promise<Hit> {
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

/**
 * A point in the left gutter, level with `block`. Asserts the probe really
 * is host chrome, so a scenario cannot pass by quietly aiming at a block.
 */
async function gutterProbe(
	page: Page,
	label: string,
	chrome: HostChrome,
	block: Box,
): Promise<{ x: number; y: number; hit: Hit }> {
	expect(
		chrome.content,
		formatCheckReport(
			`${label}: content surface is on screen`,
			chrome.content ? "passed" : "failed",
			JSON.stringify(chrome),
		),
	).toBeTruthy();

	const x = chrome.content!.left + GUTTER_PX / 2;
	const y = (block.top + block.bottom) / 2;
	expect(
		x < block.left,
		formatCheckReport(
			`${label}: probe sits left of the block, inside the gutter`,
			x < block.left ? "passed" : "failed",
			`x=${x} block.left=${block.left} content.left=${chrome.content!.left}`,
		),
	).toBe(true);

	const hit = await hitAt(page, x, y);
	expect(
		hit.isContent && !hit.isBlock,
		formatCheckReport(
			`${label}: probe lands on host chrome, not a block`,
			hit.isContent && !hit.isBlock ? "passed" : "failed",
			JSON.stringify(hit),
		),
	).toBe(true);

	return { x, y, hit };
}

async function dragFrom(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
): Promise<void> {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, {
		steps: 8,
	});
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
}

scenario(
	"host chrome: a drag starting in the gutter selects across blocks",
	async (s, page) => {
		const loads = logLoad("gutter-drag-cross-block");
		await s.load("two-paragraph");
		const beforeIds = await readBlockIds(page);

		await padContent(page);
		const chrome = await readChrome(page);
		expect(
			chrome.first && chrome.last,
			formatCheckReport(
				"gutter drag: both blocks are on screen",
				chrome.first && chrome.last ? "passed" : "failed",
				JSON.stringify(chrome),
			),
		).toBeTruthy();

		const from = await gutterProbe(
			page,
			"gutter drag",
			chrome,
			chrome.first!,
		);
		const to = await getInlineOffsetPoint(page, {
			blockId: LAST_ID,
			offset: LAST_TEXT.length,
		});
		await dragFrom(page, from, to);

		const selection = await readSelection(page);
		const afterIds = await readBlockIds(page);
		const crossBlock =
			selection?.type === "text" &&
			selection.anchor.blockId === FIRST_ID &&
			selection.focus.blockId === LAST_ID;
		await test.info().attach("gutter-drag-cross-block", {
			body: JSON.stringify(
				{
					loadavg: loads,
					chrome,
					from,
					to,
					beforeIds,
					afterIds,
					selection,
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			afterIds,
			formatCheckReport(
				"gutter drag: selecting does not insert or remove blocks",
				afterIds.join(",") === beforeIds.join(",")
					? "passed"
					: "failed",
				`before=${beforeIds.join(",")} after=${afterIds.join(",")}`,
			),
		).toEqual(beforeIds);
		expect(
			crossBlock,
			formatCheckReport(
				"gutter drag: a host-chrome origin still selects across blocks (G4, T2)",
				crossBlock ? "passed" : "failed",
				`selection=${JSON.stringify(selection)}`,
			),
		).toBe(true);
		await s.assert.domMatchesAuthority();
	},
);

/**
 * The endpoint is the block's right edge, past the last character, because
 * that is where the browser stops producing a native range of its own. A
 * drag ending on a character passes on the mapped read alone; this one only
 * passes if Pen resolved the intra-block range itself.
 */
scenario(
	"host chrome: a drag starting in the gutter selects within one block",
	async (s, page) => {
		const loads = logLoad("gutter-drag-single-block");
		await s.load("two-paragraph");

		await padContent(page);
		const chrome = await readChrome(page);
		expect(
			chrome.last,
			formatCheckReport(
				"gutter drag: last block is on screen",
				chrome.last ? "passed" : "failed",
				JSON.stringify(chrome),
			),
		).toBeTruthy();

		const from = await gutterProbe(
			page,
			"gutter drag single",
			chrome,
			chrome.last!,
		);
		const lastCharacter = await getInlineOffsetPoint(page, {
			blockId: LAST_ID,
			offset: LAST_TEXT.length,
		});
		const to = {
			x: chrome.last!.right - 8,
			y: (chrome.last!.top + chrome.last!.bottom) / 2,
		};
		expect(
			to.x > lastCharacter.x,
			formatCheckReport(
				"gutter drag: endpoint sits past the last character",
				to.x > lastCharacter.x ? "passed" : "failed",
				`to.x=${to.x} lastCharacter.x=${lastCharacter.x}`,
			),
		).toBe(true);
		await dragFrom(page, from, to);

		const selection = await readSelection(page);
		const wholeLine =
			selection?.type === "text" &&
			selection.anchor.blockId === LAST_ID &&
			selection.focus.blockId === LAST_ID &&
			selection.anchor.offset === 0 &&
			selection.focus.offset === LAST_TEXT.length;
		await test.info().attach("gutter-drag-single-block", {
			body: JSON.stringify(
				{ loadavg: loads, chrome, from, to, lastCharacter, selection },
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			wholeLine,
			formatCheckReport(
				"gutter drag: a host-chrome origin selects the block's text end to end (FE10)",
				wholeLine ? "passed" : "failed",
				`selection=${JSON.stringify(selection)}`,
			),
		).toBe(true);
		await s.assert.domMatchesAuthority();
	},
);
