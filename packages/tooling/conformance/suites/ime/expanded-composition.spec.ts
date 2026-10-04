import { expect, test, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";
import { dispatchUnidentifiedKeyThenInput, readDocumentText } from "./compose";

scenario(
	"S2 FE2: a composition over a cross-block range deletes the range and composes in the caret's field",
	async (s, page) => {
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));

		await s.load("two-paragraph");
		await page.evaluate(() => {
			window.__penConformance.selectTextRangeById(
				{ blockId: "two-p1", offset: 6 },
				{ blockId: "two-p2", offset: 6 },
			);
		});
		await page.evaluate(() => window.__penConformance.whenIdle());

		// Firefox delivers insertText as a composition, which the expanded
		// host cannot cancel; the other engines send a plain insertText.
		await page.keyboard.insertText("ñ");
		await page.keyboard.type("o");
		await page.evaluate(() => window.__penConformance.whenIdle());

		expect(pageErrors).toEqual([]);
		await expect.poll(() => readDocumentText(page)).toBe("Alpha ñoecho foxtrot");
		await s.assert.domMatchesAuthority();
		const selection = await page.evaluate(
			() => window.__penConformance.selection,
		);
		expect(selection).toMatchObject({
			type: "text",
			anchor: { blockId: "two-p1", offset: 8 },
			focus: { blockId: "two-p1", offset: 8 },
		});
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

async function selectTwoParagraphRange(
	s: Parameters<Parameters<typeof scenario>[1]>[0],
	page: Page,
): Promise<void> {
	await s.load("two-paragraph");
	await page.evaluate(() => {
		window.__penConformance.selectTextRangeById(
			{ blockId: "two-p1", offset: 6 },
			{ blockId: "two-p2", offset: 6 },
		);
	});
	await page.evaluate(() => window.__penConformance.whenIdle());
}

scenario(
	"FE2 D20: a keyCode 229 keydown that turns out to be deleteContentBackward deletes only the range (expanded host)",
	async (s, page) => {
		await selectTwoParagraphRange(s, page);
		const targets = await dispatchUnidentifiedKeyThenInput(
			page,
			"deleteContentBackward",
		);
		await page.evaluate(() => window.__penConformance.whenIdle());

		expect(targets.keydownTarget).toBe("host");
		await expect.poll(() => readDocumentText(page)).toBe("Alpha echo foxtrot");
		await s.assert.selectionEquals({
			anchor: { blockId: "two-p1", offset: 6 },
			focus: { blockId: "two-p1", offset: 6 },
		});
		await s.assert.domMatchesAuthority();
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
			await page.evaluate(() => window.__penConformance.whenIdle());
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
		await page.evaluate(() => window.__penConformance.whenIdle());

		expect(await page.evaluate(() => window.__penConformance.composing)).toBe(false);
		await expect.poll(() => readDocumentText(page)).toBe("Alpha 你echo foxtrot");
		await s.assert.selectionEquals({
			anchor: { blockId: "two-p1", offset: 7 },
			focus: { blockId: "two-p1", offset: 7 },
		});
		await s.assert.domMatchesAuthority();
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
		await page.evaluate(() => window.__penConformance.whenIdle());

		const composingDuring = await page.evaluate(
			() => (window as { __composingDuring?: boolean[] }).__composingDuring ?? [],
		);
		expect(composingDuring.length, "the composition updated").toBeGreaterThan(0);
		expect(composingDuring.every(Boolean), "the ime window is open on every update").toBe(true);
		expect(await page.evaluate(() => window.__penConformance.composing)).toBe(false);
		await expect.poll(() => readDocumentText(page)).toBe("Alpha ñecho foxtrot");
		await s.assert.selectionEquals({
			anchor: { blockId: "two-p1", offset: 7 },
			focus: { blockId: "two-p1", offset: 7 },
		});
		await s.assert.domMatchesAuthority();
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
