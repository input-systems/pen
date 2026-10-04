import { expect, test, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";
import { disableEditContext, readDocumentText, readFocusOffset, readSurfaceText } from "./compose";

/**
 * C2 (D3) rebase on the contenteditable backend with a real Chromium CDP
 * composition: the remote edit is deferred while the IME composes, then the
 * composition is rebased over it so the result equals two converged
 * `Y.Doc`s with the remote edit first.
 */

async function remoteInsert(page: Page, from: number, insert: string): Promise<void> {
	await page.evaluate(
		({ offset, text }) => {
			window.__penConformance.remoteApply([
				{ type: "splice-text", blockId: "hello-p1", from: offset, to: offset, insert: text },
			]);
		},
		{ offset: from, text: insert },
	);
}

scenario(
	"C2: a Chromium CDP composition with a remote insert at its start lands the remote text first (contenteditable)",
	async (s, page) => {
		test.skip(test.info().project.name !== "chromium", "CDP IME is Chromium-only");
		await s.load("hello-world");
		await page.evaluate(() => window.__penConformance.selectTextById("hello-p1", 5, 5));
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.imeSetComposition", { text: "か", selectionStart: 1, selectionEnd: 1 });
		await remoteInsert(page, 5, "X");
		await cdp.send("Input.insertText", { text: "漢" });

		await expect.poll(() => readDocumentText(page)).toBe("HelloX漢 world");
		await expect.poll(() => readSurfaceText(page)).toBe("HelloX漢 world");
		expect(await readFocusOffset(page), "the caret ends after the composed text").toBe(7);
		await s.assert.domMatchesAuthority();
	},
	{ initScript: disableEditContext },
);

scenario(
	"C2: a remote insert inside a recomposed word survives (contenteditable)",
	async (s, page) => {
		test.skip(test.info().project.name !== "chromium", "CDP IME is Chromium-only");
		await s.load("hello-world");
		// Reconversion: the IME replaces the selected word.
		await page.evaluate(() => window.__penConformance.selectTextById("hello-p1", 6, 11));
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.imeSetComposition", { text: "わ", selectionStart: 1, selectionEnd: 1 });
		await remoteInsert(page, 8, "Z");
		await cdp.send("Input.insertText", { text: "世界" });

		await expect.poll(() => readDocumentText(page)).toBe("Hello Z世界");
		await expect.poll(() => readSurfaceText(page)).toBe("Hello Z世界");
		expect(await readFocusOffset(page), "the caret ends after the composed text").toBe(9);
		await s.assert.domMatchesAuthority();
	},
	{ initScript: disableEditContext },
);

/**
 * C2 covers every edit the composition did not produce, not only a
 * collaborator's: an AI insert ahead of the composition is deferred and the
 * composition rebased over it on both backends.
 */
for (const editContext of [false, true]) {
	const backend = editContext ? "EditContext" : "contenteditable";
	scenario(
		`C2: an AI insert ahead of a composition lands before it and the composition stays at its place (${backend})`,
		async (s, page) => {
			test.skip(test.info().project.name !== "chromium", "CDP IME is Chromium-only");
			await s.load("hello-world");
			await page.evaluate(() => window.__penConformance.selectTextById("hello-p1", 11, 11));
			const cdp = await page.context().newCDPSession(page);
			await cdp.send("Input.imeSetComposition", { text: "ni", selectionStart: 2, selectionEnd: 2 });
			await s.applyAiRangeReplacement({
				start: { blockId: "hello-p1", offset: 0 },
				end: { blockId: "hello-p1", offset: 0 },
				replacementText: "AI ",
			});
			await cdp.send("Input.insertText", { text: "你" });

			await expect.poll(() => readDocumentText(page)).toBe("AI Hello world你");
			await expect.poll(() => readSurfaceText(page)).toBe("AI Hello world你");
			expect(await readFocusOffset(page), "the caret ends after the composed text").toBe(15);
			await s.assert.domMatchesAuthority();
		},
		editContext ? undefined : { initScript: disableEditContext },
	);
}
