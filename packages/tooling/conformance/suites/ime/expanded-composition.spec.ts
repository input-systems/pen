import { expect, test, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";
import type { ScenarioApi } from "../../src/types";
import { readDocumentText } from "../input/keys";
import { collectPageErrors } from "../specHelpers";
import { dispatchUnidentifiedKeyThenInput } from "./compose";

function whenIdle(page: Page): Promise<void> {
	return page.evaluate(() => window.__penConformance.whenIdle());
}

async function selectTwoParagraphRange(
	s: ScenarioApi,
	page: Page,
): Promise<void> {
	await s.load("two-paragraph");
	await page.evaluate(() => {
		window.__penConformance.selectTextRangeById(
			{ blockId: "two-p1", offset: 6 },
			{ blockId: "two-p2", offset: 6 },
		);
	});
	await whenIdle(page);
}

/** The document settles to `text`, caret collapsed at `offset` in two-p1. */
async function expectSettled(
	s: ScenarioApi,
	page: Page,
	text: string,
	offset: number,
): Promise<void> {
	await expect.poll(() => readDocumentText(page)).toBe(text);
	const caret = { blockId: "two-p1", offset };
	await s.assert.selectionEquals({ anchor: caret, focus: caret });
	await s.assert.domMatchesAuthority();
}

scenario(
	"S2 FE2: a composition over a cross-block range deletes the range and composes in the caret's field",
	async (s, page) => {
		const pageErrors = collectPageErrors(page);
		await selectTwoParagraphRange(s, page);

		// Firefox delivers insertText as a composition, which the expanded
		// host cannot cancel; the other engines send a plain insertText.
		await page.keyboard.insertText("ñ");
		await page.keyboard.type("o");
		await whenIdle(page);

		expect(pageErrors).toEqual([]);
		await expectSettled(s, page, "Alpha ñoecho foxtrot", 8);
		if (test.info().project.name === "firefox") {
			const compositionStarts = await page.evaluate(
				() =>
					(window as { __compositionStarts?: number }).__compositionStarts ?? 0,
			);
			expect(compositionStarts, "Firefox composes insertText").toBeGreaterThan(0);
		}
	},
	{
		initScript: () => {
			const counted = window as { __compositionStarts?: number };
			counted.__compositionStarts = 0;
			document.addEventListener(
				"compositionstart",
				() => {
					counted.__compositionStarts = (counted.__compositionStarts ?? 0) + 1;
				},
				true,
			);
		},
	},
);

scenario(
	"FE2 D20: a keyCode 229 keydown that turns out to be deleteContentBackward deletes only the range (expanded host)",
	async (s, page) => {
		await selectTwoParagraphRange(s, page);
		const targets = await dispatchUnidentifiedKeyThenInput(
			page,
			"deleteContentBackward",
		);
		await whenIdle(page);

		expect(targets.keydownTarget).toBe("host");
		await expectSettled(s, page, "Alpha echo foxtrot", 6);
	},
);

scenario(
	"FE2 C1: a composition after an unidentified keyCode 229 keydown composes at the range start inside the ime window (expanded host)",
	async (s, page) => {
		test.skip(test.info().project.name !== "chromium", "CDP IME is Chromium-only");
		await selectTwoParagraphRange(s, page);
		const before = await readDocumentText(page);
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.dispatchKeyEvent", {
			type: "rawKeyDown",
			key: "Unidentified",
			windowsVirtualKeyCode: 229,
			nativeVirtualKeyCode: 229,
		});
		expect(
			await readDocumentText(page),
			"the keydown alone does not delete the range",
		).toBe(before);
		for (const update of ["n", "ni"]) {
			await cdp.send("Input.imeSetComposition", {
				text: update,
				selectionStart: update.length,
				selectionEnd: update.length,
			});
			await whenIdle(page);
		}
		expect(
			await page.evaluate(() => window.__penConformance.composing),
			"the ime window is open while the expanded host composes",
		).toBe(true);
		// The composition's caret is not a selection: the range stays the
		// record, so the surface stays expanded and the host keeps composing.
		await s.assert.selectionEquals({
			anchor: { blockId: "two-p1", offset: 6 },
			focus: { blockId: "two-p2", offset: 6 },
		});
		expect(
			await page.evaluate(() =>
				document.activeElement?.hasAttribute("data-pen-editor-blocks-host"),
			),
			"the expanded host keeps focus",
		).toBe(true);
		await cdp.send("Input.insertText", { text: "你" });
		await whenIdle(page);

		expect(await page.evaluate(() => window.__penConformance.composing)).toBe(false);
		await expectSettled(s, page, "Alpha 你echo foxtrot", 7);
	},
);

scenario(
	"FE2 C1: a Gecko composition over a cross-block range opens the ime window (expanded host)",
	async (s, page) => {
		test.skip(
			test.info().project.name !== "firefox",
			"Firefox delivers insertText as a composition; the other engines do not compose it",
		);
		await selectTwoParagraphRange(s, page);
		await page.keyboard.insertText("ñ");
		await whenIdle(page);

		const composingDuring = await page.evaluate(
			() => (window as { __composingDuring?: boolean[] }).__composingDuring ?? [],
		);
		expect(composingDuring.length, "the composition updated").toBeGreaterThan(0);
		expect(composingDuring.every(Boolean), "the ime window is open on every update").toBe(true);
		expect(await page.evaluate(() => window.__penConformance.composing)).toBe(false);
		await expectSettled(s, page, "Alpha ñecho foxtrot", 7);
	},
	{
		initScript: () => {
			const recorded = window as { __composingDuring?: boolean[] };
			recorded.__composingDuring = [];
			document.addEventListener(
				"compositionupdate",
				() => {
					recorded.__composingDuring?.push(
						window.__penConformance?.composing === true,
					);
				},
				true,
			);
		},
	},
);
