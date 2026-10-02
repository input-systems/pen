import { expect, test } from "@playwright/test";
import { scenario } from "../../src/scenario";
import { readDocumentText, readSurfaceText } from "./compose";

const BLOCK = "hello-p1";

function insertRemoteX(): void {
	window.__penConformance.remoteApply([
		{ type: "splice-text", blockId: "hello-p1", from: 0, to: 0, insert: "X" },
	]);
}

scenario(
	"C2: contenteditable real composition defers a remote insert before the composition and lands after it",
	async (s, page) => {
		test.skip(
			test.info().project.name !== "chromium",
			"Input.imeSetComposition is Chromium CDP",
		);

		await s.load("hello-world");
		await page.keyboard.press("End");

		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.imeSetComposition", {
			text: "ni",
			selectionStart: 2,
			selectionEnd: 2,
		});
		await page.evaluate(insertRemoteX);

		expect(
			await readSurfaceText(page),
			"C2: the composed field DOM is untouched by the remote commit",
		).toBe("Hello worldni");

		await cdp.send("Input.insertText", { text: "ni" });

		const compositionEnds = await page.evaluate(
			() =>
				(window as { __c2CompositionEnds?: number }).__c2CompositionEnds ?? 0,
		);
		expect(
			compositionEnds,
			"could not produce a real composition commit",
		).toBe(1);

		await expect
			.poll(() => readDocumentText(page))
			.toBe("XHello worldni");
		await s.assert.domMatchesAuthority();
		const selection = await page.evaluate(
			() => window.__penConformance.selection,
		);
		expect(selection).toMatchObject({
			type: "text",
			anchor: { blockId: BLOCK, offset: 14 },
			focus: { blockId: BLOCK, offset: 14 },
		});
	},
	{
		initScript: () => {
			delete (globalThis as { EditContext?: unknown }).EditContext;
			delete (window as { EditContext?: unknown }).EditContext;
			const counted = window as { __c2CompositionEnds?: number };
			counted.__c2CompositionEnds = 0;
			document.addEventListener(
				"compositionend",
				() => {
					counted.__c2CompositionEnds = (counted.__c2CompositionEnds ?? 0) + 1;
				},
				true,
			);
		},
	},
);
