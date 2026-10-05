import { expect } from "@playwright/test";
import {
	BIDI_RTL_LINE_A,
	BIDI_RTL_LINE_A_ID,
	BIDI_RTL_LINE_B,
	BIDI_RTL_LINE_B_ID,
} from "../../fixtures/bidi";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import {
	attachJson,
	expectS2Matched,
	logLoad,
	readCaret,
	readDir,
	readS2,
} from "./helpers";

async function assertRtlLine(
	page: import("@playwright/test").Page,
	blockId: string,
	text: string,
): Promise<void> {
	await expect
		.poll(async () => {
			const snap = await readDir(page, blockId);
			if (!snap) {
				return "missing";
			}
			if (!snap.text.includes(text)) {
				return `text:${snap.text}`;
			}
			if (!/[֐-׿]/.test(snap.text)) {
				return `not-hebrew:${snap.text}`;
			}
			if (snap.dir !== "rtl") {
				return `dir:${snap.dir}`;
			}
			return "ok";
		})
		.toBe("ok");
}

async function focusBlockOffset(
	page: import("@playwright/test").Page,
	blockIndex: number,
	offset: number,
): Promise<string> {
	const blockId = await page.evaluate(
		({ index, caret }) => {
			window.__penConformance.focusText(index);
			window.__penConformance.selectText(index, caret);
			const id = window.__penConformance.blockIds[index];
			if (!id) {
				throw new Error(`no block at ${index}`);
			}
			return id;
		},
		{ index: blockIndex, caret: offset },
	);
	await expect
		.poll(async () => {
			const caret = await readCaret(page);
			if (!caret) {
				return "not-text";
			}
			return `${caret.blockId}:${caret.offset}`;
		})
		.toBe(`${blockId}:${offset}`);
	return blockId;
}

scenario(
	"M5: ArrowUp from a later RTL block stays pen.caretUp (no swap)",
	async (s, page) => {
		const loads = logLoad("M5-up");
		await s.load("bidi-mixed", { pointer: false });
		await assertRtlLine(page, BIDI_RTL_LINE_A_ID, BIDI_RTL_LINE_A);
		await assertRtlLine(page, BIDI_RTL_LINE_B_ID, BIDI_RTL_LINE_B);
		await focusBlockOffset(page, 3, 0);
		await page.keyboard.press("ArrowUp");
		const caret = await readCaret(page);
		const s2 = await readS2(page);
		await attachJson("m5-up", { loads, caret, s2 });

		expectS2Matched(s2, "M5: S2 after ArrowUp");
		expect(
			caret?.blockId,
			formatCheckReport(
				"M5: ArrowUp must not swap to Down",
				caret?.blockId === BIDI_RTL_LINE_A_ID ? "passed" : "failed",
				`focus=${JSON.stringify(caret)} expected ${BIDI_RTL_LINE_A_ID}`,
			),
		).toBe(BIDI_RTL_LINE_A_ID);
	},
);

scenario(
	"M5: ArrowDown from an earlier RTL block stays pen.caretDown (no swap)",
	async (s, page) => {
		const loads = logLoad("M5-down");
		await s.load("bidi-mixed", { pointer: false });
		await focusBlockOffset(page, 2, 0);
		await page.keyboard.press("ArrowDown");
		const caret = await readCaret(page);
		const s2 = await readS2(page);
		await attachJson("m5-down", { loads, caret, s2 });

		expectS2Matched(s2, "M5: S2 after ArrowDown");
		expect(
			caret?.blockId,
			formatCheckReport(
				"M5: ArrowDown must not swap to Up",
				caret?.blockId === BIDI_RTL_LINE_B_ID ? "passed" : "failed",
				`focus=${JSON.stringify(caret)} expected ${BIDI_RTL_LINE_B_ID}`,
			),
		).toBe(BIDI_RTL_LINE_B_ID);
	},
);
