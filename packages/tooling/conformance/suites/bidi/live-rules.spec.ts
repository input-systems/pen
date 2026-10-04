import { expect, type Page } from "@playwright/test";
import {
	BIDI_LTR_EMBED_ID,
	BIDI_LTR_EMBED_TEXT,
	BIDI_RTL_EMBED_ID,
	BIDI_RTL_EMBED_TEXT,
	BIDI_RTL_LATIN_MID,
} from "../../fixtures/bidi";
import { formatCheckReport } from "../../src/checkReport";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { scenario } from "../../src/scenario";
import { authorityCheckKind } from "../../src/standingAssertions";
import type { DomAuthorityCheck } from "../../src/types";
import { attachJson, logLoad } from "../specHelpers";

type TextCaret = {
	blockId: string;
	offset: number;
	isCollapsed: boolean;
};

type DirSnapshot = {
	blockId: string;
	dir: string | null;
	text: string;
	unicodeBidi: string;
};

type OffsetProbe = {
	offset: number;
	x: number | null;
};

type VisualHomeReport = {
	kind: "matched" | "mismatch" | "unchecked";
	reason: string;
	offset: number | null;
	caretX: number | null;
	lineLeft: number | null;
	lineRight: number | null;
	distLeft: number | null;
	distRight: number | null;
	visualStartOffset: number | null;
	probes: OffsetProbe[];
	s2: DomAuthorityCheck;
};

const M3_BLOCK_ID = "m3-hello-arabic";
const M3_TEXT = "Hello مرحبا";

async function readCaret(page: Page): Promise<TextCaret | null> {
	return page.evaluate(() => {
		const selection = window.__penConformance.selection;
		if (selection?.type !== "text") {
			return null;
		}
		return {
			blockId: selection.focus.blockId,
			offset: selection.focus.offset,
			isCollapsed: window.__penConformance.isCollapsed(),
		};
	});
}

async function clickOffset(
	page: Page,
	blockId: string,
	offset: number,
): Promise<void> {
	const point = await getInlineOffsetPoint(page, { blockId, offset });
	await page.mouse.click(point.x, point.y);
	await expect
		.poll(async () => {
			const caret = await readCaret(page);
			if (!caret) {
				return "not-text";
			}
			return `${caret.blockId}:${caret.offset}:${caret.isCollapsed}`;
		})
		.toBe(`${blockId}:${offset}:true`);
}

async function readDir(page: Page, blockId: string): Promise<DirSnapshot | null> {
	return page.evaluate((id) => {
		const block = document.querySelector(`[data-block-id="${id}"]`);
		if (!(block instanceof HTMLElement)) {
			return null;
		}
		const inline = block.querySelector("[data-pen-inline-content]");
		const host = inline instanceof HTMLElement ? inline : block;
		return {
			blockId: id,
			dir: block.getAttribute("dir"),
			text: inline?.textContent ?? "",
			unicodeBidi: getComputedStyle(host).unicodeBidi,
		};
	}, blockId);
}

scenario(
	"M2: ArrowLeft in an RTL mixed block advances logical offset (playground keymap-swap)",
	async (s, page) => {
		const loads = logLoad("M2-left");
		await s.load("bidi-mixed");
		await clickOffset(page, BIDI_RTL_EMBED_ID, BIDI_RTL_LATIN_MID);
		await page.keyboard.press("ArrowLeft");
		const caret = await readCaret(page);
		const s2 = await page.evaluate(() =>
			window.__penConformance.domMatchesAuthority(),
		);
		const kind = authorityCheckKind(s2);
		await attachJson("m2-left", {
			loads,
			caret,
			s2,
			kind,
		});

		expect(
			kind,
			formatCheckReport(
				"M2: S2 after ArrowLeft",
				kind === "matched" ? "passed" : kind === "unchecked" ? "skipped" : "failed",
				s2.reason,
			),
		).toBe("matched");
		expect(
			caret,
			formatCheckReport(
				"M2: caret readable after ArrowLeft",
				caret ? "passed" : "skipped",
				caret ? undefined : "selection is not text",
			),
		).not.toBeNull();
		expect(
			caret!.offset,
			formatCheckReport(
				"M2: ArrowLeft on rtl dispatches pen.caretRight",
				caret!.offset === BIDI_RTL_LATIN_MID + 1 ? "passed" : "failed",
				`offset ${caret!.offset} expected ${BIDI_RTL_LATIN_MID + 1} text=${BIDI_RTL_EMBED_TEXT}`,
			),
		).toBe(BIDI_RTL_LATIN_MID + 1);
	},
);

scenario(
	"M2: ArrowRight in an RTL mixed block retreats logical offset (playground keymap-swap)",
	async (s, page) => {
		const loads = logLoad("M2-right");
		await s.load("bidi-mixed");
		await clickOffset(page, BIDI_RTL_EMBED_ID, BIDI_RTL_LATIN_MID);
		await page.keyboard.press("ArrowRight");
		const caret = await readCaret(page);
		const s2 = await page.evaluate(() =>
			window.__penConformance.domMatchesAuthority(),
		);
		const kind = authorityCheckKind(s2);
		await attachJson("m2-right", { loads, caret, s2, kind });

		expect(
			kind,
			formatCheckReport(
				"M2: S2 after ArrowRight",
				kind === "matched" ? "passed" : kind === "unchecked" ? "skipped" : "failed",
				s2.reason,
			),
		).toBe("matched");
		expect(
			caret,
			formatCheckReport(
				"M2: caret readable after ArrowRight",
				caret ? "passed" : "skipped",
				caret ? undefined : "selection is not text",
			),
		).not.toBeNull();
		expect(
			caret!.offset,
			formatCheckReport(
				"M2: ArrowRight on rtl dispatches pen.caretLeft",
				caret!.offset === BIDI_RTL_LATIN_MID - 1 ? "passed" : "failed",
				`offset ${caret!.offset} expected ${BIDI_RTL_LATIN_MID - 1}`,
			),
		).toBe(BIDI_RTL_LATIN_MID - 1);
	},
);

scenario(
	"M2: LTR mixed-direction control does not swap ArrowLeft",
	async (s, page) => {
		const loads = logLoad("M2-ltr-control");
		await s.load("bidi-mixed");
		const mid = 3;
		await clickOffset(page, BIDI_LTR_EMBED_ID, mid);
		await page.keyboard.press("ArrowLeft");
		const caret = await readCaret(page);
		const s2 = await page.evaluate(() =>
			window.__penConformance.domMatchesAuthority(),
		);
		const kind = authorityCheckKind(s2);
		await attachJson("m2-ltr-control", { loads, caret, s2, kind });

		expect(
			kind,
			formatCheckReport(
				"M2 ltr control: S2 after ArrowLeft",
				kind === "matched" ? "passed" : kind === "unchecked" ? "skipped" : "failed",
				s2.reason,
			),
		).toBe("matched");
		expect(
			caret?.offset,
			formatCheckReport(
				"M2 ltr control: ArrowLeft stays pen.caretLeft",
				caret?.offset === mid - 1 ? "passed" : "failed",
				`offset ${caret?.offset ?? "null"} expected ${mid - 1} text=${BIDI_LTR_EMBED_TEXT}`,
			),
		).toBe(mid - 1);
	},
);

scenario(
	"M3: Home in an RTL mixed line lands on the visual start (right edge), not logical 0",
	async (s, page) => {
		const loads = logLoad("M3-home");
		await s.load("hello-world");
		await s.apply([
			{
				type: "insert-block",
				blockId: M3_BLOCK_ID,
				blockType: "paragraph",
				props: { direction: "rtl" },
				position: "last",
			},
			{
				type: "splice-text",
				blockId: M3_BLOCK_ID,
				from: 0,
				to: 0,
				insert: M3_TEXT,
			},
		]);
		await expect(page.locator(`[data-block-id="${M3_BLOCK_ID}"]`)).toBeVisible();
		await expect
			.poll(async () => {
				const snap = await readDir(page, M3_BLOCK_ID);
				if (!snap) {
					return "missing";
				}
				if (!snap.text.includes(M3_TEXT)) {
					return `text:${snap.text}`;
				}
				if (snap.dir !== "rtl") {
					return `dir:${snap.dir}`;
				}
				return "ok";
			})
			.toBe("ok");
		await clickOffset(page, M3_BLOCK_ID, 2);
		await page.keyboard.press("Home");

		const report = await page.evaluate(
			({ blockId, text }): VisualHomeReport => {
				function empty(
					kind: VisualHomeReport["kind"],
					reason: string,
					s2: DomAuthorityCheck,
					offset: number | null,
				): VisualHomeReport {
					return {
						kind,
						reason,
						offset,
						caretX: null,
						lineLeft: null,
						lineRight: null,
						distLeft: null,
						distRight: null,
						visualStartOffset: null,
						probes: [],
						s2,
					};
				}

				function caretXAt(inline: HTMLElement, offset: number): number | null {
					const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
					let remaining = offset;
					let node: Text | null = null;
					let offsetInNode = 0;
					while (walker.nextNode()) {
						const current = walker.currentNode;
						if (!(current instanceof Text)) {
							continue;
						}
						if (remaining <= current.data.length) {
							node = current;
							offsetInNode = remaining;
							break;
						}
						remaining -= current.data.length;
					}
					if (!node) {
						return null;
					}
					const range = document.createRange();
					range.setStart(node, offsetInNode);
					range.collapse(true);
					return range.getBoundingClientRect().left;
				}

				const selection = window.__penConformance.selection;
				const s2 = window.__penConformance.domMatchesAuthority();
				if (selection?.type !== "text") {
					return empty("unchecked", "selection is not text after Home", s2, null);
				}
				const block = document.querySelector(`[data-block-id="${blockId}"]`);
				const inline = block?.querySelector("[data-pen-inline-content]");
				if (!(inline instanceof HTMLElement)) {
					return empty("unchecked", "missing inline host", s2, selection.focus.offset);
				}
				const inkRange = document.createRange();
				inkRange.selectNodeContents(inline);
				const inkRects = Array.from(inkRange.getClientRects()).filter(
					(rect) => rect.width > 0 || rect.height > 0,
				);
				if (inkRects.length === 0) {
					return empty("unchecked", "no ink rects on the mixed rtl line", s2, selection.focus.offset);
				}
				const lineLeft = Math.min(...inkRects.map((rect) => rect.left));
				const lineRight = Math.max(...inkRects.map((rect) => rect.right));
				if (lineRight - lineLeft < 8) {
					return empty(
						"unchecked",
						`ink box too narrow (${(lineRight - lineLeft).toFixed(1)}px)`,
						s2,
						selection.focus.offset,
					);
				}
				const probeOffsets: number[] = [];
				for (let offset = 0; offset <= text.length; offset += 1) {
					probeOffsets.push(offset);
				}
				const probes = probeOffsets.map((offset) => ({
					offset,
					x: caretXAt(inline, offset),
				}));
				const withX = probes.filter((probe) => probe.x != null) as Array<{
					offset: number;
					x: number;
				}>;
				if (withX.length < 2) {
					return empty("unchecked", "could not probe caret x at enough offsets", s2, selection.focus.offset);
				}
				let visualStartOffset = withX[0]!.offset;
				let bestRight = Math.abs(withX[0]!.x - lineRight);
				for (const probe of withX) {
					const dist = Math.abs(probe.x - lineRight);
					if (dist < bestRight) {
						bestRight = dist;
						visualStartOffset = probe.offset;
					}
				}
				const caretX = caretXAt(inline, selection.focus.offset);
				if (caretX == null) {
					return empty("unchecked", "could not map Home caret onto a text node", s2, selection.focus.offset);
				}
				const distLeft = Math.abs(caretX - lineLeft);
				const distRight = Math.abs(caretX - lineRight);
				if (visualStartOffset === 0) {
					return {
						kind: "unchecked",
						reason: `fixture does not distinguish visual vs logical: offset 0 is already nearest the ink right (probes=${JSON.stringify(probes)})`,
						offset: selection.focus.offset,
						caretX,
						lineLeft,
						lineRight,
						distLeft,
						distRight,
						visualStartOffset,
						probes,
						s2,
					};
				}
				const kind =
					selection.focus.offset === visualStartOffset ? "matched" : "mismatch";
				return {
					kind,
					reason:
						kind === "matched"
							? `Home landed at visual-start offset ${visualStartOffset}`
							: `Home landed at offset ${selection.focus.offset} (logical start is 0); visual start of this rtl line is offset ${visualStartOffset}`,
					offset: selection.focus.offset,
					caretX,
					lineLeft,
					lineRight,
					distLeft,
					distRight,
					visualStartOffset,
					probes,
					s2,
				};
			},
			{
				blockId: M3_BLOCK_ID,
				text: M3_TEXT,
			},
		);

		console.log(`M3-home report ${JSON.stringify(report)}`);
		await attachJson("m3-home", { loads, report });

		const s2Kind = authorityCheckKind(report.s2);
		expect(
			report.kind === "unchecked" ? "unchecked" : "checked",
			formatCheckReport(
				"M3: Home visual edge was checkable",
				report.kind === "unchecked" ? "skipped" : "passed",
				report.reason,
			),
		).toBe("checked");
		expect(
			report.offset === 2 ? "unmoved" : "moved",
			formatCheckReport(
				"M3: Home moved the authority caret off the click offset",
				report.offset === 2 ? "failed" : "passed",
				`authority offset stayed ${report.offset}; DOM Home without a command write is a no-op`,
			),
		).toBe("moved");
		expect(
			report.kind,
			formatCheckReport(
				"M3: Home is visual line-start (right edge in rtl)",
				report.kind === "matched" ? "passed" : "failed",
				`${report.reason} offset=${report.offset} visualStart=${report.visualStartOffset}`,
			),
		).toBe("matched");
		expect(
			s2Kind,
			formatCheckReport(
				"M3: S2 after Home",
				s2Kind === "matched" ? "passed" : s2Kind === "unchecked" ? "skipped" : "failed",
				`${report.s2.reason ?? ""} authority=${JSON.stringify(report.s2.authority)} dom=${JSON.stringify(report.s2.dom)}`,
			),
		).toBe("matched");
	},
);

scenario(
	"DIR2: resolved block dir is written on the content host and is never auto",
	async (s, page) => {
		const loads = logLoad("DIR2");
		await s.load("bidi-mixed");
		await s.apply([
			{
				type: "insert-block",
				blockId: "dir2-first-strong",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "dir2-first-strong",
				from: 0,
				to: 0,
				insert: "مرحبا",
			},
		]);

		const rtl = await readDir(page, BIDI_RTL_EMBED_ID);
		const ltr = await readDir(page, BIDI_LTR_EMBED_ID);
		const firstStrong = await readDir(page, "dir2-first-strong");
		await attachJson("dir2", { loads, rtl, ltr, firstStrong });

		expect(
			rtl,
			formatCheckReport(
				"DIR2: rtl embed host readable",
				rtl ? "passed" : "skipped",
				rtl ? undefined : "missing bidi-rtl-embed",
			),
		).not.toBeNull();
		expect(
			ltr,
			formatCheckReport(
				"DIR2: ltr embed host readable",
				ltr ? "passed" : "skipped",
				ltr ? undefined : "missing bidi-ltr-embed",
			),
		).not.toBeNull();
		expect(
			firstStrong,
			formatCheckReport(
				"DIR2: first-strong host readable",
				firstStrong ? "passed" : "skipped",
				firstStrong ? undefined : "missing dir2-first-strong",
			),
		).not.toBeNull();

		const dirs = [rtl!.dir, ltr!.dir, firstStrong!.dir];
		expect(
			dirs.includes("auto"),
			formatCheckReport(
				"DIR2: never dir=auto",
				dirs.includes("auto") ? "failed" : "passed",
				`dirs=${JSON.stringify(dirs)}`,
			),
		).toBe(false);
		expect(
			rtl!.dir,
			formatCheckReport(
				"DIR2: explicit rtl writes dir=rtl",
				rtl!.dir === "rtl" ? "passed" : "failed",
				`dir=${rtl!.dir}`,
			),
		).toBe("rtl");
		expect(
			firstStrong!.dir,
			formatCheckReport(
				"DIR2: first-strong Arabic writes dir=rtl",
				firstStrong!.dir === "rtl" ? "passed" : "failed",
				`dir=${firstStrong!.dir} text=${JSON.stringify(firstStrong!.text)}`,
			),
		).toBe("rtl");
		expect(
			/isolate/i.test(rtl!.unicodeBidi) && !/override/i.test(rtl!.unicodeBidi),
			formatCheckReport(
				"RI1: rtl embed host is unicode-bidi isolate",
				/isolate/i.test(rtl!.unicodeBidi) && !/override/i.test(rtl!.unicodeBidi)
					? "passed"
					: "failed",
				`unicodeBidi=${rtl!.unicodeBidi}`,
			),
		).toBe(true);
	},
);
