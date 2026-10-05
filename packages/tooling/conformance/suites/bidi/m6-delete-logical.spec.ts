import { expect } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import {
	attachJson,
	clickOffset,
	expectS2Matched,
	logLoad,
	readBlockText,
	readCaret,
	readS2,
} from "./helpers";

const M6_BLOCK_ID = "m6-delete-rtl";
const M6_TEXT = "ab";

/** Either key removes "a" from "ab"; a visual swap would leave "a" instead. */
const M6_CASES = [
	{
		title:
			"M6: Backspace in an RTL block deletes the previous logical grapheme (no swap)",
		key: "Backspace",
		label: "backspace",
		clickAt: 1,
		removes: "the previous logical grapheme, not the next",
	},
	{
		title:
			"M6: Delete in an RTL block deletes the next logical grapheme (no swap)",
		key: "Delete",
		label: "delete",
		clickAt: 0,
		removes: "the next logical grapheme, not the previous",
	},
] as const;

for (const { title, key, label, clickAt, removes } of M6_CASES) {
	scenario(title, async (s, page) => {
		const loads = logLoad(`M6-${label}`);
		await s.load("hello-world");
		await s.apply([
			{
				type: "insert-block",
				blockId: M6_BLOCK_ID,
				blockType: "paragraph",
				props: { direction: "rtl" },
				position: "last",
			},
			{
				type: "splice-text",
				blockId: M6_BLOCK_ID,
				from: 0,
				to: 0,
				insert: M6_TEXT,
			},
		]);
		await expect(page.locator(`[data-block-id="${M6_BLOCK_ID}"]`)).toBeVisible();
		await clickOffset(page, M6_BLOCK_ID, clickAt);
		await page.keyboard.press(key);
		const text = await readBlockText(page, M6_BLOCK_ID);
		const caret = await readCaret(page);
		const s2 = await readS2(page);
		await attachJson(`m6-${label}`, { loads, text, caret, s2 });

		expectS2Matched(s2, `M6: S2 after ${key}`);
		expect(
			text,
			formatCheckReport(
				`M6: ${key} removes ${removes}`,
				text === "b" ? "passed" : "failed",
				`text=${JSON.stringify(text)} expected "b" (swap would leave "a")`,
			),
		).toBe("b");
		expect(
			caret?.offset,
			formatCheckReport(
				"M6: caret stays at the deletion point",
				caret?.offset === 0 ? "passed" : "failed",
				`offset ${caret?.offset ?? "null"}`,
			),
		).toBe(0);
	});
}
