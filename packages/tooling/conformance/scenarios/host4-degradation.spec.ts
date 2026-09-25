import { expect, type Page } from "@playwright/test";
import { scenario } from "../src/scenario";

function collectPageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("pageerror", (error) => {
		errors.push(error.message);
	});
	return errors;
}

scenario(
	"HOST4: missing structuredClone degrades to JSON clone and still types",
	async (s, page) => {
		const errors = collectPageErrors(page);
		expect(
			await page.evaluate(() => typeof globalThis.structuredClone),
		).toBe("undefined");

		await s.load("hello-world");
		await s.keyboard.type("!");
		await s.assert.textContains("Hello");
		await s.assert.textContains("!");

		const probe = await page.evaluate(() => {
			const sample = { keep: 1, drop: undefined as undefined };
			const cloned = JSON.parse(JSON.stringify(sample)) as {
				keep?: number;
				drop?: unknown;
			};
			return {
				jsonDroppedUndefined: !("drop" in cloned),
				keep: cloned.keep,
			};
		});
		expect(probe.jsonDroppedUndefined).toBe(true);
		expect(probe.keep).toBe(1);
		expect(errors, errors.join("\n")).toEqual([]);
	},
	{
		initScript: () => {
			delete (globalThis as { structuredClone?: unknown }).structuredClone;
			delete (window as { structuredClone?: unknown }).structuredClone;
		},
	},
);

scenario(
	"HOST4: missing ResizeObserver keeps the editor editable after viewport resize",
	async (s, page) => {
		const errors = collectPageErrors(page);
		expect(await page.evaluate(() => typeof ResizeObserver)).toBe("undefined");

		await s.load("hello-world");
		await s.keyboard.type("!");
		await s.assert.textContains("Hello");
		await s.assert.textContains("!");

		await page.setViewportSize({ width: 720, height: 540 });
		await s.keyboard.type("?");
		await s.assert.textContains("!?");
		expect(errors, errors.join("\n")).toEqual([]);
	},
	{
		initScript: () => {
			delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
			delete (window as { ResizeObserver?: unknown }).ResizeObserver;
		},
	},
);

scenario(
	"HOST4: missing EditContext falls back to contenteditable and still types",
	async (s, page) => {
		const errors = collectPageErrors(page);
		expect(
			await page.evaluate(
				() => typeof (globalThis as { EditContext?: unknown }).EditContext,
			),
		).toBe("undefined");

		await s.load("hello-world");
		await s.keyboard.type("!");
		await s.assert.textContains("Hello");
		await s.assert.textContains("!");

		const backend = await page.evaluate(() => {
			const surface = document.querySelector(
				"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
			);
			if (!(surface instanceof HTMLElement)) {
				return null;
			}
			return {
				contentEditable: surface.contentEditable,
				hasEditContext: Boolean(
					(surface as HTMLElement & { editContext?: unknown }).editContext,
				),
			};
		});
		expect(backend).not.toBeNull();
		expect(backend?.hasEditContext).toBe(false);
		expect(backend?.contentEditable).toBe("true");
		expect(errors, errors.join("\n")).toEqual([]);
	},
	{
		initScript: () => {
			delete (globalThis as { EditContext?: unknown }).EditContext;
			delete (window as { EditContext?: unknown }).EditContext;
		},
	},
);

scenario(
	"HOST4: missing matchMedia leaves reduced-motion off and still types",
	async (s, page) => {
		const errors = collectPageErrors(page);
		expect(await page.evaluate(() => typeof window.matchMedia)).toBe(
			"undefined",
		);
		expect(
			await page.evaluate(() => window.__penConformance.reducedMotion),
		).toBe(false);

		await s.load("hello-world");
		await s.keyboard.type("!");
		await s.assert.textContains("Hello");
		await s.assert.textContains("!");
		expect(errors, errors.join("\n")).toEqual([]);
	},
	{
		initScript: () => {
			delete (window as { matchMedia?: unknown }).matchMedia;
			delete (globalThis as { matchMedia?: unknown }).matchMedia;
		},
	},
);

async function blockInlineText(page: Page, blockId: string): Promise<string> {
	return page.evaluate((id) => {
		const block = document.querySelector(`[data-block-id="${id}"]`);
		const inline = block?.querySelector("[data-pen-inline-content]");
		return inline?.textContent ?? "";
	}, blockId);
}

async function cellInlineText(
	page: Page,
	row: number,
	col: number,
): Promise<string> {
	return page.evaluate(
		({ cellRow, cellCol }) => {
			const cell = document.querySelector(
				`[data-pen-inline-content][data-cell-row="${cellRow}"][data-cell-col="${cellCol}"]`,
			);
			return cell?.textContent ?? "";
		},
		{ cellRow: row, cellCol: col },
	);
}

async function dispatchActiveSurfaceDelete(
	page: Page,
	inputType: "deleteWordBackward" | "deleteContentBackward",
): Promise<void> {
	await page.evaluate((type) => {
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
		);
		if (!(surface instanceof HTMLElement)) {
			throw new Error("missing active field-editor surface");
		}
		surface.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: type,
			}),
		);
	}, inputType);
}

scenario(
	"HOST4: missing replaceChildren still empties and refills inline and cell content",
	async (s, page) => {
		const errors = collectPageErrors(page);
		expect(
			await page.evaluate(
				() => typeof Element.prototype.replaceChildren,
			),
		).toBe("undefined");

		await s.load("two-paragraph");
		expect(await blockInlineText(page, "two-p2")).toContain(
			"Delta echo foxtrot",
		);

		await page.evaluate(() => {
			window.__penConformance.apply([
				{
					type: "splice-text",
					blockId: "two-p2",
					from: 0,
				to: 0 + 18,
				insert: "",
				},
			]);
		});
		await expect
			.poll(() => blockInlineText(page, "two-p2"))
			.not.toContain("Delta echo foxtrot");

		await page.evaluate(() => {
			window.__penConformance.apply([
				{
					type: "splice-text",
					blockId: "two-p2",
					from: 0,
				to: 0,
				insert: "Swapped inline",
				},
			]);
		});
		await expect
			.poll(() => blockInlineText(page, "two-p2"))
			.toContain("Swapped inline");
		expect(await blockInlineText(page, "two-p2")).not.toContain(
			"Delta echo foxtrot",
		);

		await s.apply([
			{
				type: "insert-block",
				blockId: "host4-table",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);
		await s.apply([
			{
				type: "splice-text",
				blockId: "host4-table",
				cell: { row: 1, col: 0 },
				from: 0,
				to: 0,
				insert: "Cell before",
			},
		]);
		expect(await cellInlineText(page, 1, 0)).toContain("Cell before");

		await s.apply([
			{
				type: "splice-text",
				blockId: "host4-table",
				cell: { row: 1, col: 0 },
				from: 0,
				to: 11,
				insert: "",
			},
		]);
		expect(await cellInlineText(page, 1, 0)).not.toContain("Cell before");

		await s.apply([
			{
				type: "splice-text",
				blockId: "host4-table",
				cell: { row: 1, col: 0 },
				from: 0,
				to: 0,
				insert: "Cell after",
			},
		]);
		expect(await cellInlineText(page, 1, 0)).toContain("Cell after");
		expect(await cellInlineText(page, 1, 0)).not.toContain("Cell before");

		expect(errors, errors.join("\n")).toEqual([]);
	},
	{
		initScript: () => {
			delete (Element.prototype as { replaceChildren?: unknown })
				.replaceChildren;
			delete (Document.prototype as { replaceChildren?: unknown })
				.replaceChildren;
			delete (DocumentFragment.prototype as { replaceChildren?: unknown })
				.replaceChildren;
		},
	},
);

scenario(
	"HOST4: missing replaceChildren still empties and refills drag-preview roots",
	async (s, page) => {
		const errors = collectPageErrors(page);
		expect(
			await page.evaluate(
				() => typeof Element.prototype.replaceChildren,
			),
		).toBe("undefined");

		await s.load("hello-world");
		const preview = await page.evaluate(() =>
			window.__penConformance.exerciseInlineAtomDragPreview(),
		);
		expect(preview.filled).toContain("Drag preview source");
		expect(preview.emptied).toBe(true);
		expect(errors, errors.join("\n")).toEqual([]);
	},
	{
		initScript: () => {
			delete (Element.prototype as { replaceChildren?: unknown })
				.replaceChildren;
			delete (Document.prototype as { replaceChildren?: unknown })
				.replaceChildren;
			delete (DocumentFragment.prototype as { replaceChildren?: unknown })
				.replaceChildren;
		},
	},
);

scenario(
	"HOST4: missing Object.hasOwn still imports and pastes",
	async (s, page) => {
		const errors = collectPageErrors(page);
		expect(await page.evaluate(() => typeof Object.hasOwn)).toBe(
			"undefined",
		);

		await s.load("hello-world");
		await s.importHtml(
			'<style>span.host4-underline { text-decoration: underline; }</style><p>Imported <strong>bold</strong> <span class="host4-underline">underlined</span> <a href="https://example.com/host4">link</a></p><ul><li>bullet</li></ul>',
		);
		await s.assert.textContains("Imported");
		await s.assert.textContains("bold");
		await s.assert.textContains("underlined");
		await s.assert.textContains("link");
		const snapshot = await page.evaluate(() =>
			window.__penConformance.documentSnapshot(),
		);
		const underlined = snapshot.blocks
			.flatMap((block) => block.deltas)
			.find((delta) => delta.insert === "underlined");
		expect(underlined?.attributes).toMatchObject({ underline: true });
		expect(snapshot.blocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "bulletListItem",
					text: "bullet",
				}),
			]),
		);

		await s.pasteHtml("<p>Pasted heading text</p>");
		await s.assert.textContains("Pasted heading text");
		expect(errors, errors.join("\n")).toEqual([]);
	},
	{
		initScript: () => {
			delete (Object as { hasOwn?: unknown }).hasOwn;
		},
	},
);

scenario(
	"HOST4: missing Object.hasOwn still parses clipboard payloads",
	async (s, page) => {
		const errors = collectPageErrors(page);
		expect(await page.evaluate(() => typeof Object.hasOwn)).toBe(
			"undefined",
		);

		await s.load("hello-world");
		const clipboard = await page.evaluate(() =>
			window.__penConformance.parseClipboardPayload({
				version: 1,
				blockTypes: ["paragraph"],
				blocks: [
					{
						type: "paragraph",
						content: "Clipboard payload",
					},
				],
			}),
		);
		expect(clipboard.status).toBe("ok");
		expect(errors, errors.join("\n")).toEqual([]);
	},
	{
		initScript: () => {
			delete (Object as { hasOwn?: unknown }).hasOwn;
		},
	},
);

scenario(
	"HOST4: missing Array.prototype.at still resolves URL policy and AI replacement",
	async (s, page) => {
		const errors = collectPageErrors(page);
		expect(
			await page.evaluate(() => typeof Array.prototype.at),
		).toBe("undefined");

		await s.load("hello-world");
		await s.apply([
			{
				type: "format-text",
				blockId: "hello-p1",
				from: 0,
				to: 0 + 11,
				marks: { link: { href: "javascript:alert(1)" } },
			},
		]);
		await expect(page.locator("[data-pen-blocked-url]")).toBeVisible();
		await s.assert.corpusSafe({ requireBlockedUrl: true });

		await s.importHtml(
			'<p><a href="https://example.com/host4-at">Safe link</a></p>',
		);
		await s.assert.textContains("Safe link");

		await s.load("two-paragraph");
		await s.applyAiRangeReplacement({
			start: { blockId: "two-p1", offset: 0 },
			end: { blockId: "two-p2", offset: 6 },
			replacementText: "Replaced\nNew para\nThird",
		});
		await s.assert.textContains("Replaced");
		await s.assert.textContains("New para");
		await s.assert.textContains("Third");
		await s.assert.textContains("echo foxtrot");
		expect(
			await page.evaluate(() => window.__penConformance.documentText),
		).not.toContain("Alpha bravo charlie");
		expect(errors, errors.join("\n")).toEqual([]);
	},
	{
		initScript: () => {
			delete (Array.prototype as { at?: unknown }).at;
		},
	},
);

scenario(
	"HOST4: missing Intl.Segmenter degrades word ops to whitespace runs and character ops to code points",
	async (s, page) => {
		const errors = collectPageErrors(page);
		expect(
			await page.evaluate(
				() => typeof (Intl as { Segmenter?: unknown }).Segmenter,
			),
		).toBe("undefined");

		await s.load("hello-world");
		await s.apply([
			{
				type: "splice-text",
				blockId: "hello-p1",
				from: 0,
				to: 0 + 11,
				insert: "",
			},
			{
				type: "splice-text",
				blockId: "hello-p1",
				from: 0,
				to: 0,
				insert: "hello,world",
			},
		]);
		await page.evaluate(() => {
			window.__penConformance.selectText(0, 11);
		});
		await dispatchActiveSurfaceDelete(page, "deleteWordBackward");
		expect(
			await page.evaluate(() => window.__penConformance.documentText),
		).not.toContain("hello,world");
		expect(
			await page.evaluate(() => window.__penConformance.documentText),
		).not.toContain("hello,");

		await s.apply([
			{
				type: "splice-text",
				blockId: "hello-p1",
				from: 0,
				to: 0,
				insert: "cafe\u0301",
			},
		]);
		await page.evaluate(() => {
			window.__penConformance.selectText(0, 5);
		});
		await dispatchActiveSurfaceDelete(page, "deleteContentBackward");
		const afterGrapheme = await page.evaluate(
			() => window.__penConformance.documentText,
		);
		expect(afterGrapheme).toContain("cafe");
		expect(afterGrapheme.trimEnd()).not.toMatch(/caf$/);
		expect(errors, errors.join("\n")).toEqual([]);
	},
	{
		initScript: () => {
			delete (Intl as unknown as { Segmenter?: unknown }).Segmenter;
			delete (globalThis as { EditContext?: unknown }).EditContext;
			delete (window as { EditContext?: unknown }).EditContext;
		},
	},
);
