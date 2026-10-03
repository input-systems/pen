import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { localCarets, readLayer, readSettledLayer } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import type { ScenarioApi } from "../../src/types";

const HELLO_ID = "hello-p1";

/** hello-world with a mention at offset 5 and the caret on its leading edge. */
async function caretBesideMention(s: ScenarioApi, page: Page): Promise<void> {
	await s.load("hello-world");
	await s.apply([
		{
			type: "splice-text",
			blockId: HELLO_ID,
			from: 5,
			to: 5,
			insert: { nodeType: "mention", props: { id: "user-ada", label: "Ada" } },
		},
	]);
	await expect(page.locator("[data-pen-inline-atom]")).toBeVisible();
	const point = await getInlineOffsetPoint(page, { blockId: HELLO_ID, offset: 5 });
	await page.mouse.click(point.x, point.y);
	await expect.poll(async () => localCarets(await readSettledLayer(page)).length).toBe(1);
}

async function startComposition(page: Page): Promise<string> {
	if (test.info().project.name === "chromium") {
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.imeSetComposition", {
			text: "a",
			selectionStart: 1,
			selectionEnd: 1,
		});
		test.info().annotations.push({ type: "composition", description: "CDP Input.imeSetComposition" });
		return "cdp";
	}
	await page.evaluate(() => {
		document
			.querySelector("[data-pen-field-editor-active-surface]")
			?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
	});
	test.info().annotations.push({ type: "composition", description: "synthetic compositionstart (not a real IME)" });
	return "synthetic";
}

async function endComposition(page: Page, mode: string): Promise<void> {
	if (mode === "cdp") {
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.insertText", { text: "a" });
		return;
	}
	await page.evaluate(() => {
		document
			.querySelector("[data-pen-field-editor-active-surface]")
			?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
	});
}

scenario(
	"AX6: composing next to an atom hides the overlay caret and restores the native caret",
	async (s, page) => {
		await caretBesideMention(s, page);
		expect((await readLayer(page)).caretColor).toBe("transparent");

		const mode = await startComposition(page);
		await expect.poll(async () => localCarets(await readLayer(page)).length).toBe(0);
		const composing = await readLayer(page);
		expect(
			composing.caretColor,
			formatCheckReport(
				"AX6: the native caret is back for IME in the flush composition starts",
				composing.caretColor !== "transparent" ? "passed" : "failed",
				`caretColor=${composing.caretColor}`,
			),
		).not.toBe("transparent");

		await endComposition(page, mode);
		await expect.poll(async () => localCarets(await readSettledLayer(page)).length).toBe(1);
		expect((await readLayer(page)).caretColor).toBe("transparent");
		// N1: the composition diff compares logical text on both sides, so the
		// atom is never committed back as a literal U+FFFC character.
		const text = await page.evaluate((id) => window.__penConformance.blockText(id), HELLO_ID);
		expect(text.includes("\uFFFC"), JSON.stringify(text)).toBe(false);
	},
);

scenario(
	"O: blurring the editor hides the overlay caret and focusing restores it",
	async (s, page) => {
		await caretBesideMention(s, page);
		await page.evaluate(() => {
			const input = document.createElement("input");
			input.setAttribute("data-o-outside-input", "");
			input.setAttribute("aria-label", "outside");
			document.body.append(input);
		});
		await page.locator("[data-o-outside-input]").focus();
		await expect.poll(async () => localCarets(await readLayer(page)).length).toBe(0);
		expect((await readLayer(page)).caretColor).not.toBe("transparent");

		const point = await getInlineOffsetPoint(page, { blockId: HELLO_ID, offset: 5 });
		await page.mouse.click(point.x, point.y);
		await expect.poll(async () => localCarets(await readSettledLayer(page)).length).toBe(1);
		await page.evaluate(() => document.querySelector("[data-o-outside-input]")?.remove());
	},
);
