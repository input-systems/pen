import { expect } from "@playwright/test";
import { scenario } from "../src/scenario";

const zwsp = String.fromCharCode(0x200b);

scenario(
	"EM2 EM6 EM7 EM8: empty block placeholder is host-invisible",
	async (s, page) => {
		await s.load("empty");
		await s.selectText(0, 0);

		const emptyState = await page.evaluate(() => {
			const inline = document.querySelector("[data-pen-inline-content]");
			const caret = document.querySelector("[data-pen-editor-caret]");
			const placeholder = inline?.querySelector("[data-pen-empty]");
			const snapshot = window.__penConformance.documentSnapshot();
			return {
				textContent: inline?.textContent ?? null,
				placeholderTag: placeholder?.tagName ?? null,
				placeholderAttr: placeholder?.getAttribute("data-pen-empty"),
				caretOffset: caret?.getAttribute("data-offset"),
				documentText: window.__penConformance.documentText,
				blockText: snapshot.blocks[0]?.text ?? null,
				deltas: snapshot.blocks[0]?.deltas ?? [],
				selection: window.__penConformance.selection,
			};
		});

		expect(emptyState.textContent).toBe("");
		expect(emptyState.placeholderTag).toBe("BR");
		expect(emptyState.placeholderAttr).toBe("");
		expect(emptyState.caretOffset).toBe("0");
		expect(emptyState.documentText).toBe("");
		expect(emptyState.blockText).toBe("");
		expect(emptyState.deltas.some((delta) => delta.insert === zwsp)).toBe(
			false,
		);
		expect(emptyState.selection).toMatchObject({
			type: "text",
			anchor: { offset: 0 },
			focus: { offset: 0 },
		});

		await s.keyboard.type("x");
		const typed = await page.evaluate(() => {
			const inline = document.querySelector("[data-pen-inline-content]");
			return {
				textContent: inline?.textContent ?? null,
				placeholder: Boolean(inline?.querySelector("[data-pen-empty]")),
				documentText: window.__penConformance.documentText,
			};
		});
		expect(typed.textContent).toBe("x");
		expect(typed.placeholder).toBe(false);
		expect(typed.documentText).toBe("x");

		await s.keyboard.press("Backspace");
		const restored = await page.evaluate(() => {
			const inline = document.querySelector("[data-pen-inline-content]");
			const caret = document.querySelector("[data-pen-editor-caret]");
			const placeholder = inline?.querySelector("[data-pen-empty]");
			const snapshot = window.__penConformance.documentSnapshot();
			return {
				textContent: inline?.textContent ?? null,
				placeholderTag: placeholder?.tagName ?? null,
				caretOffset: caret?.getAttribute("data-offset"),
				documentText: window.__penConformance.documentText,
				blockText: snapshot.blocks[0]?.text ?? null,
			};
		});
		expect(restored.textContent).toBe("");
		expect(restored.placeholderTag).toBe("BR");
		expect(restored.caretOffset).toBe("0");
		expect(restored.documentText).toBe("");
		expect(restored.blockText).toBe("");

		await s.apply([
			{
				type: "splice-text",
				blockId: "empty-p1",
				from: 0,
				to: 0,
				insert: `keep${zwsp}me`,
			},
		]);
		expect(await page.evaluate(() => window.__penConformance.documentText)).toBe(
			`keep${zwsp}me`,
		);
	},
	{ url: "/?customCaret=1" },
);
