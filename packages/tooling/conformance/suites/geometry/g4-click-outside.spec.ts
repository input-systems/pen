import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import { logLoad, readBlockIds } from "../../src/specHelpers";

const FIRST_ID = "two-p1";
const LAST_ID = "two-p2";
const LAST_TEXT = "Delta echo foxtrot";

/**
 * G4 is GeometryReader.pointAt (`spec/rules/dom.md`): coordinates
 * outside any block map to the nearest block edge. A Playwright mouse.click
 * in this harness does not observe that rule — React's
 * `handleClickOutsideBlocks` inserts a paragraph when the adjacent block is
 * non-empty. That is host chrome UX, not G4. Vanilla `pointerActivation`
 * already places a caret; jsdom `geometryExtra.test.ts` already pins the
 * mapping. This scenario calls `pointAt` the same way G3 loads the reader.
 */
const PEN_DOM_FS = `/@fs${fileURLToPath(new URL("../../../../rendering/dom/src/index.ts", import.meta.url))}`;

type HostChrome = {
	content: {
		left: number;
		right: number;
		top: number;
		bottom: number;
	} | null;
	first: { top: number; bottom: number; left: number; right: number } | null;
	last: { top: number; bottom: number; left: number; right: number } | null;
};

type PointAtHit = { blockId: string; offset: number } | null;

async function readBlockChrome(page: Page): Promise<HostChrome> {
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
				content: box(document.querySelector("[data-pen-editor-content]")),
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

async function pointAt(
	page: Page,
	x: number,
	y: number,
): Promise<PointAtHit> {
	return page.evaluate(
		async ({ clientX, clientY, fsUrl }) => {
			const urls = ["/@id/@input/pen-dom", fsUrl];
			const errors: string[] = [];
			type Reader = {
				pointAt(
					px: number,
					py: number,
				): { blockId: string; offset: number } | null;
				dispose(): void;
			};
			let create: ((options: {
				root: HTMLElement;
				observeResize: boolean;
				observeFonts: boolean;
			}) => Reader) | null = null;
			for (const url of urls) {
				try {
					const mod = (await import(/* @vite-ignore */ url)) as {
						createGeometryReader?: (options: {
							root: HTMLElement;
							observeResize: boolean;
							observeFonts: boolean;
						}) => Reader;
					};
					if (typeof mod.createGeometryReader === "function") {
						create = mod.createGeometryReader;
						break;
					}
					errors.push(`${url}: no createGeometryReader export`);
				} catch (error) {
					errors.push(
						`${url}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			if (!create) {
				throw new Error(
					`createGeometryReader import failed:\n${errors.join("\n")}`,
				);
			}
			const root = document.querySelector("[data-pen-editor-root]");
			if (!(root instanceof HTMLElement)) {
				throw new Error("missing editor root");
			}
			const reader = create({
				root,
				observeResize: false,
				observeFonts: false,
			});
			try {
				return reader.pointAt(clientX, clientY);
			} finally {
				reader.dispose();
			}
		},
		{ clientX: x, clientY: y, fsUrl: PEN_DOM_FS },
	);
}

scenario(
	"G4: click below the last block selects the last position, and does not insert a paragraph",
	async (s, page) => {
		const loads = logLoad("G4-below");
		await s.load("two-paragraph");
		const beforeIds = await readBlockIds(page);
		const chrome = await readBlockChrome(page);
		expect(
			chrome.last,
			formatCheckReport(
				"G4: last block is on screen",
				chrome.last ? "passed" : "failed",
				JSON.stringify(chrome),
			),
		).toBeTruthy();

		const x = (chrome.last!.left + chrome.last!.right) / 2;
		const y = chrome.last!.bottom + 24;
		const hit = await pointAt(page, x, y);
		const afterIds = await readBlockIds(page);
		await test.info().attach("g4-below", {
			body: JSON.stringify(
				{
					loadavg: loads,
					chrome,
					probe: { x, y },
					beforeIds,
					afterIds,
					hit,
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			afterIds,
			formatCheckReport(
				"G4: pointAt below the last block does not insert a block",
				afterIds.length === beforeIds.length &&
					afterIds[afterIds.length - 1] === LAST_ID
					? "passed"
					: "failed",
				`before=${beforeIds.join(",")} after=${afterIds.join(",")}`,
			),
		).toEqual(beforeIds);
		expect(
			hit,
			formatCheckReport(
				"G4: click-below-document selects the last position",
				hit?.blockId === LAST_ID && hit.offset === LAST_TEXT.length
					? "passed"
					: "failed",
				`hit=${JSON.stringify(hit)}`,
			),
		).toEqual({ blockId: LAST_ID, offset: LAST_TEXT.length });
	},
);

scenario(
	"G4: click above the first block selects the first position",
	async (s, page) => {
		const loads = logLoad("G4-above");
		await s.load("two-paragraph");
		const beforeIds = await readBlockIds(page);
		const chrome = await readBlockChrome(page);
		expect(
			chrome.first,
			formatCheckReport(
				"G4: first block is on screen",
				chrome.first ? "passed" : "failed",
				JSON.stringify(chrome),
			),
		).toBeTruthy();

		const x = (chrome.first!.left + chrome.first!.right) / 2;
		const y = chrome.first!.top - 24;
		const hit = await pointAt(page, x, y);
		const afterIds = await readBlockIds(page);
		await test.info().attach("g4-above", {
			body: JSON.stringify(
				{
					loadavg: loads,
					chrome,
					probe: { x, y },
					beforeIds,
					afterIds,
					hit,
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			afterIds,
			formatCheckReport(
				"G4: pointAt above the first block does not insert a block",
				afterIds.length === beforeIds.length && afterIds[0] === FIRST_ID
					? "passed"
					: "failed",
				`before=${beforeIds.join(",")} after=${afterIds.join(",")}`,
			),
		).toEqual(beforeIds);
		expect(
			hit,
			formatCheckReport(
				"G4: click-above-document selects the first position",
				hit?.blockId === FIRST_ID && hit.offset === 0
					? "passed"
					: "failed",
				`hit=${JSON.stringify(hit)}`,
			),
		).toEqual({ blockId: FIRST_ID, offset: 0 });
	},
);
