import { expect, type Page } from "@playwright/test";
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
