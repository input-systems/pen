import { expect, type Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { scenario } from "../../src/scenario";
import { clickOffset, readSelection } from "../specHelpers";

/**
 * P focus targets (W3.R16, D18): the revealed sink for block and cell
 * selections, the editor root for `null`, never a block element. Escape
 * writes the record and its projection places focus.
 */

const BLOCK_ID = "hello-p1";

async function activeTarget(page: Page): Promise<string> {
	return page.evaluate(() => {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) return "none";
		if (active.hasAttribute("data-pen-focus-sink")) {
			const hidden = active.getAttribute("aria-hidden") === "true";
			return `sink:${active.getAttribute("role") ?? "none"}:${hidden ? "hidden" : "revealed"}`;
		}
		if (active.hasAttribute("data-pen-editor-root")) return "root";
		if (active.closest("[data-block-id]")) return "block-or-field";
		return active === document.body ? "body" : "other";
	});
}

async function clickInText(page: Page, offset: number): Promise<void> {
	await clickOffset(page, BLOCK_ID, offset);
	await expect.poll(() => activeTarget(page)).toBe("block-or-field");
}

scenario(
	"HOST9: Escape from a text caret leaves focus on the revealed sink, and from the block selection to null on the editor root",
	async (s, page) => {
		await s.load("hello-world");
		await clickInText(page, 3);
		await s.keyboard.press("Escape");
		await expect.poll(async () => (await readSelection(page))?.type).toBe("block");
		await expect.poll(() => activeTarget(page)).toBe("sink:group:revealed");
		await s.keyboard.press("Escape");
		await expect.poll(() => readSelection(page)).toBeNull();
		await expect.poll(() => activeTarget(page)).toBe("root");
	},
);

scenario("P: deactivate with a block selection focuses the sink", async (s, page) => {
	await s.load("hello-world");
	await s.apply([
		{
			type: "insert-block",
			blockId: "focus-divider",
			blockType: "divider",
			props: {},
			position: "last",
		},
	]);
	await clickInText(page, 2);
	const divider = page.locator('[data-block-id="focus-divider"]');
	await divider.click();
	await expect
		.poll(() => readSelection(page))
		.toMatchObject({ type: "block", blockIds: ["focus-divider"] });
	await expect.poll(() => activeTarget(page)).toBe("sink:group:revealed");
});

scenario(
	"N2, W3.R16: Escape over a range whose focus is on a divider selects the divider",
	async (s, page) => {
		await s.load("hello-world");
		await s.apply([
			{
				type: "insert-block",
				blockId: "focus-divider",
				blockType: "divider",
				props: {},
				position: "last",
			},
		]);
		const from = await getInlineOffsetPoint(page, {
			blockId: BLOCK_ID,
			offset: 3,
		});
		const divider = await page
			.locator('[data-block-id="focus-divider"]')
			.boundingBox();
		if (!divider) throw new Error("divider is not laid out");
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(
			divider.x + divider.width / 2,
			divider.y + divider.height / 2,
			{ steps: 8 },
		);
		await page.mouse.up();
		await expect
			.poll(() => readSelection(page))
			.toMatchObject({ type: "text", focus: { blockId: "focus-divider" } });

		await s.keyboard.press("Escape");
		await expect
			.poll(() => readSelection(page))
			.toMatchObject({ type: "block", blockIds: ["focus-divider"] });
		await expect.poll(() => activeTarget(page)).toBe("sink:group:revealed");
	},
);

scenario(
	"N2, T5: a click on a divider inside a multi-block range selects the divider",
	async (s, page) => {
		await s.load("two-paragraph");
		await s.apply([
			{
				type: "insert-block",
				blockId: "focus-divider",
				blockType: "divider",
				props: {},
				position: { after: "two-p1" },
			},
		]);
		await page.evaluate(() => {
			window.__penConformance.selectTextRangeById(
				{ blockId: "two-p1", offset: 0 },
				{ blockId: "two-p2", offset: 3 },
			);
		});
		await expect
			.poll(() => readSelection(page))
			.toMatchObject({ type: "text", focus: { blockId: "two-p2" } });

		await page.locator('[data-block-id="focus-divider"]').click();
		await expect
			.poll(() => readSelection(page))
			.toMatchObject({ type: "block", blockIds: ["focus-divider"] });
		await expect.poll(() => activeTarget(page)).toBe("sink:group:revealed");
	},
);

scenario(
	"S2: a drag that starts on a link inside a block selection leaves focus on the revealed sink",
	async (s, page) => {
		await s.load("two-paragraph");
		await s.apply([
			{
				type: "format-text",
				blockId: "two-p1",
				from: 0,
				to: 5,
				marks: { link: { href: "https://example.com" } },
			},
		]);
		await page
			.locator('[data-block-id="two-p2"] [data-pen-inline-content]')
			.first()
			.click();
		// Content-first select-all, then the block rung.
		await s.keyboard.press("ControlOrMeta+a");
		await s.keyboard.press("ControlOrMeta+a");
		await expect
			.poll(() => readSelection(page))
			.toMatchObject({ type: "block", blockIds: ["two-p1", "two-p2"] });

		const link = await page
			.locator('[data-block-id="two-p1"] a')
			.first()
			.boundingBox();
		const target = await page
			.locator('[data-block-id="two-p2"]')
			.first()
			.boundingBox();
		if (!link || !target) throw new Error("link or target is not laid out");
		// Chromium focuses a link on press, outside any field.
		await page.mouse.move(link.x + 3, link.y + link.height / 2);
		await page.mouse.down();
		await page.mouse.move(target.x + 20, target.y + target.height / 2, {
			steps: 6,
		});
		await page.mouse.up();

		await expect
			.poll(() => readSelection(page))
			.toMatchObject({ type: "block", blockIds: ["two-p1", "two-p2"] });
		await expect.poll(() => activeTarget(page)).toBe("sink:group:revealed");
	},
);

const SECOND_EDITOR = "[data-pen-conformance-second-editor]";

/** Whether DOM focus is inside the second editor on the page. */
async function focusInSecondEditor(page: Page): Promise<boolean> {
	return page.evaluate(
		(selector) => document.activeElement?.closest(selector) != null,
		SECOND_EDITOR,
	);
}

/**
 * A collaborator inserts "X" at the start of the block, before the harness
 * editor's caret. Not `s.remote.splice`: its standing S2 check needs editor
 * focus, and these scenarios assert the editor does not take it.
 */
async function remoteInsertBeforeCaret(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.__penConformance.remoteSplice({ block: 0, from: 0, to: 0, insert: "X" });
	});
}

/** Waits until a collaborator edit before the caret has mapped the harness record. */
async function expectMappedCaret(page: Page, offset: number): Promise<void> {
	await expect
		.poll(() => page.evaluate(() => window.__penConformance.selectionRecord))
		.toMatchObject({
			origin: "mapped",
			state: { type: "text", focus: { blockId: BLOCK_ID, offset } },
		});
}

scenario(
	"HOST9: a collaborator edit before a stale caret does not take focus from a second editor",
	async (s, page) => {
		await s.load("hello-world");
		await clickInText(page, 6);
		await page.evaluate(() => {
			window.__penConformance.mountSecondEditor("Second");
		});
		await page.locator(`${SECOND_EDITOR} [data-pen-inline-content]`).click();
		await page.keyboard.press("End");
		await page.keyboard.type("ab");
		await expect.poll(() => focusInSecondEditor(page)).toBe(true);

		await remoteInsertBeforeCaret(page);
		await expectMappedCaret(page, 7);
		await page.keyboard.type("cd");

		expect(await focusInSecondEditor(page)).toBe(true);
		await expect(page.locator(SECOND_EDITOR)).toContainText("Secondabcd");
		await expect(
			page
				.locator(`[data-block-id="${BLOCK_ID}"] [data-pen-inline-content]`)
				.first(),
		).toHaveText("XHello world");
	},
	{ axe: false },
);

scenario(
	"HOST9: a collaborator edit before a stale caret does not take focus that fell to the body",
	async (s, page) => {
		await s.load("hello-world");
		await clickInText(page, 6);
		await page.evaluate(() => {
			(document.activeElement as HTMLElement | null)?.blur();
		});
		await expect.poll(() => activeTarget(page)).toBe("body");

		await remoteInsertBeforeCaret(page);
		await expectMappedCaret(page, 7);

		expect(await activeTarget(page)).toBe("body");
	},
);
