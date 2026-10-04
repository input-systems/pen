import { expect, type Page } from "@playwright/test";
import {
	BIDI_RTL_LINE_A,
	BIDI_RTL_LINE_A_ID,
	BIDI_RTL_LINE_B,
	BIDI_RTL_LINE_B_ID,
} from "../fixtures/bidi";
import { scenario } from "../src/scenario";
import { assertDomAuthorityResult } from "../src/standingAssertions";
import type { DomAuthorityCheck } from "../src/types";
import { Focus, readFocus } from "../suites/specHelpers";

async function assertRtlLine(
	page: Page,
	blockId: string,
	text: string,
): Promise<void> {
	await expect
		.poll(async () => {
			return page.evaluate(
				({ id, expected }) => {
					const block = document.querySelector(`[data-block-id="${id}"]`);
					if (!(block instanceof HTMLElement)) {
						return "missing-block";
					}
					const content =
						block.querySelector("[data-pen-inline-content]")?.textContent ??
						"";
					if (!content.includes(expected)) {
						return `text:${content}`;
					}
					if (!/[\u0590-\u05FF]/.test(content)) {
						return `not-hebrew:${content}`;
					}
					if (block.getAttribute("dir") !== "rtl") {
						return `dir:${block.getAttribute("dir")}`;
					}
					return "ok";
				},
				{ id: blockId, expected: text },
			);
		})
		.toBe("ok");
}

async function focusBlockOffset(
	page: Page,
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
			const focus = await readFocus(page);
			if (!focus) {
				return "not-text";
			}
			return `${focus.blockId}:${focus.offset}`;
		})
		.toBe(`${blockId}:${offset}`);
	return blockId;
}

async function pressAndRead(
	page: Page,
	key: string,
): Promise<{ focus: Focus; s2: DomAuthorityCheck }> {
	await page.keyboard.press(key);
	const focus = await readFocus(page);
	const s2 = await page.evaluate(() =>
		window.__penConformance.domMatchesAuthority(),
	);
	return { focus, s2 };
}

function report(key: string, focus: Focus, s2: DomAuthorityCheck): string {
	return `${key} focus=${JSON.stringify(focus)} s2=${JSON.stringify(s2)}`;
}

scenario(
	"M5: ArrowUp from the start of a later RTL block stays pen.caretUp (no swap)",
	async (s, page) => {
		await s.load("bidi-mixed", { pointer: false });
		await assertRtlLine(page, BIDI_RTL_LINE_A_ID, BIDI_RTL_LINE_A);
		await assertRtlLine(page, BIDI_RTL_LINE_B_ID, BIDI_RTL_LINE_B);
		await focusBlockOffset(page, 3, 0);
		const afterUp = await pressAndRead(page, "ArrowUp");
		assertDomAuthorityResult(afterUp.s2);
		expect(
			afterUp.focus?.blockId,
			`M5: ArrowUp must not swap to Down. ${report("ArrowUp", afterUp.focus, afterUp.s2)}`,
		).toBe(BIDI_RTL_LINE_A_ID);
	},
);

