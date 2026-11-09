import { expect, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";
import {
	clickOffsetAndAwaitCaret,
	readModelBlockText,
	readSelection,
} from "../specHelpers";

/**
 * HOST9: document keys follow focus. A host element focused beside the
 * editor keeps every key, and keys on a body that focus fell to belong to
 * whatever held focus last. A host menu that took focus and closed on a
 * removed item leaves them with the host, even though the editor beside it
 * still has a caret or a block selection and the browser kept a native
 * range in its blurred field. Focus that left the editor for nothing
 * focusable leaves them with the editor.
 */

const BLOCK_ID = "hello-p1";
const TEXT = "Hello world";
const SECOND_EDITOR = "[data-pen-conformance-second-editor]";

/** Types `!` at the end of the harness block and closes the undo group. */
async function typeAtEnd(page: Page): Promise<void> {
	await clickOffsetAndAwaitCaret(page, BLOCK_ID, TEXT.length);
	await page.keyboard.type("!");
	await expect
		.poll(() => readModelBlockText(page, BLOCK_ID))
		.toBe(`${TEXT}!`);
	await page.evaluate(() => window.__penConformance.stopCapturing());
}

/** Records every Mod-key keydown that reaches a host listener on the window. */
async function installHostShortcutLog(page: Page): Promise<void> {
	await page.evaluate(() => {
		const log: string[] = [];
		(window as unknown as { __hostShortcuts: string[] }).__hostShortcuts =
			log;
		const modifiers = new Set(["Meta", "Control", "Shift", "Alt"]);
		window.addEventListener("keydown", (event) => {
			if ((event.metaKey || event.ctrlKey) && !modifiers.has(event.key)) {
				log.push(
					`${event.shiftKey ? "Shift+" : ""}${event.key.toLowerCase()}`,
				);
			}
		});
	});
}

async function hostShortcuts(page: Page): Promise<string[]> {
	return page.evaluate(
		() =>
			(window as unknown as { __hostShortcuts: string[] })
				.__hostShortcuts,
	);
}

async function activeIsBody(page: Page): Promise<boolean> {
	return page.evaluate(() => document.activeElement === document.body);
}

/**
 * A host context menu: it focuses its item on open, as menu libraries do,
 * and Enter on the item closes the menu by unmounting it without returning
 * focus anywhere, so focus falls to the body.
 */
async function openAndActivateHostMenu(page: Page): Promise<void> {
	await page.evaluate(() => {
		const menu = document.createElement("div");
		menu.setAttribute("role", "menu");
		const item = document.createElement("button");
		item.setAttribute("role", "menuitem");
		item.textContent = "Move to";
		item.addEventListener("click", () => menu.remove());
		menu.append(item);
		document.body.append(menu);
		item.focus();
	});
	await page.keyboard.press("Enter");
	await expect.poll(() => activeIsBody(page)).toBe(true);
}

/** Focus leaves for nothing focusable, as a click on empty space does. */
async function blurToBody(page: Page): Promise<void> {
	await page.evaluate(() => {
		(document.activeElement as HTMLElement | null)?.blur();
	});
	await expect.poll(() => activeIsBody(page)).toBe(true);
}

scenario(
	"HOST9: Mod-z after a host menu closes on a removed item reaches the host, not the editor beside it",
	async (s, page) => {
		await s.load("hello-world");
		await typeAtEnd(page);
		await installHostShortcutLog(page);
		await openAndActivateHostMenu(page);

		await page.keyboard.press("ControlOrMeta+z");
		await page.keyboard.press("ControlOrMeta+Shift+z");
		await page.keyboard.press("ControlOrMeta+a");

		expect(await hostShortcuts(page)).toEqual(["z", "Shift+z", "a"]);
		expect(await readModelBlockText(page, BLOCK_ID)).toBe(`${TEXT}!`);
		await expect
			.poll(() =>
				page.evaluate(() => window.__penConformance.isCollapsed()),
			)
			.toBe(true);
	},
	{ axe: false },
);

scenario(
	"HOST9: Mod-z after focus left the editor for the body still undoes in the editor",
	async (s, page) => {
		await s.load("hello-world");
		await typeAtEnd(page);
		await installHostShortcutLog(page);
		await blurToBody(page);

		await page.keyboard.press("ControlOrMeta+z");

		await expect.poll(() => readModelBlockText(page, BLOCK_ID)).toBe(TEXT);
		expect(await hostShortcuts(page)).toEqual([]);
	},
);

scenario(
	"HOST9: Mod-z on the body undoes in the editor that held focus last, not the first one mounted",
	async (s, page) => {
		await s.load("hello-world");
		await typeAtEnd(page);
		await page.evaluate(() => {
			window.__penConformance.mountSecondEditor("Second");
		});
		const second = page.locator(
			`${SECOND_EDITOR} [data-pen-inline-content]`,
		);
		await second.click();
		await page.keyboard.press("End");
		await page.keyboard.type("ab");
		await expect(page.locator(SECOND_EDITOR)).toContainText("Secondab");
		await blurToBody(page);

		await page.keyboard.press("ControlOrMeta+z");

		await expect(page.locator(SECOND_EDITOR)).not.toContainText("Secondab");
		expect(await readModelBlockText(page, BLOCK_ID)).toBe(`${TEXT}!`);
	},
	{ axe: false },
);

/**
 * A host that owns Backspace, as an app with its own delete action does:
 * counts it and prevents its default (WebKit's would navigate back).
 */
async function installHostBackspace(page: Page): Promise<void> {
	await page.evaluate(() => {
		const state = { backspaces: 0 };
		(
			window as unknown as { __hostBackspace: typeof state }
		).__hostBackspace = state;
		window.addEventListener("keydown", (event) => {
			if (event.key !== "Backspace") return;
			event.preventDefault();
			state.backspaces += 1;
		});
	});
}

async function hostBackspaces(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			(window as unknown as { __hostBackspace: { backspaces: number } })
				.__hostBackspace.backspaces,
	);
}

/** A caret in the harness block, then Escape: a block selection on the sink. */
async function selectBlockByEscape(page: Page): Promise<void> {
	await clickOffsetAndAwaitCaret(page, BLOCK_ID, 3);
	await page.keyboard.press("Escape");
	await expect
		.poll(async () => (await readSelection(page))?.type)
		.toBe("block");
}

/**
 * A host menu with two items and its own roving focus: ArrowDown on an item
 * focuses the next one, and a click is counted.
 */
async function focusHostRovingMenu(page: Page): Promise<void> {
	await page.evaluate(() => {
		const menu = document.createElement("div");
		menu.setAttribute("role", "menu");
		const state = { clicks: 0 };
		(window as unknown as { __hostMenu: typeof state }).__hostMenu = state;
		for (const label of ["Move to", "Duplicate"]) {
			const item = document.createElement("button");
			item.setAttribute("role", "menuitem");
			item.textContent = label;
			item.addEventListener("click", () => {
				state.clicks += 1;
			});
			menu.append(item);
		}
		menu.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowDown") return;
			event.preventDefault();
			(
				document.activeElement?.nextElementSibling as HTMLElement | null
			)?.focus();
		});
		document.body.append(menu);
		(menu.firstElementChild as HTMLElement).focus();
	});
}

async function focusedMenuItem(page: Page): Promise<string | null> {
	return page.evaluate(() =>
		document.activeElement?.getAttribute("role") === "menuitem"
			? document.activeElement.textContent
			: null,
	);
}

async function hostMenuClicks(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			(window as unknown as { __hostMenu: { clicks: number } }).__hostMenu
				.clicks,
	);
}

scenario(
	"HOST9: a focused host menu keeps ArrowDown, Enter and Backspace over the editor's block selection",
	async (s, page) => {
		await s.load("hello-world");
		await selectBlockByEscape(page);
		await installHostBackspace(page);
		await focusHostRovingMenu(page);

		await page.keyboard.press("ArrowDown");
		expect(await focusedMenuItem(page)).toBe("Duplicate");

		await page.keyboard.press("Enter");
		await expect.poll(() => hostMenuClicks(page)).toBe(1);

		await page.keyboard.press("Backspace");
		expect(await hostBackspaces(page)).toBe(1);

		expect(
			await page.evaluate(() => window.__penConformance.blockIds),
		).toEqual([BLOCK_ID]);
		expect(await readModelBlockText(page, BLOCK_ID)).toBe(TEXT);
		expect(await readSelection(page)).toMatchObject({
			type: "block",
			blockIds: [BLOCK_ID],
		});
	},
	{ axe: false },
);

scenario(
	"HOST9: Backspace after a host menu closes on a removed item does not delete the editor's block selection",
	async (s, page) => {
		await s.load("hello-world");
		await selectBlockByEscape(page);
		await installHostBackspace(page);
		await openAndActivateHostMenu(page);

		await page.keyboard.press("Backspace");
		expect(await hostBackspaces(page)).toBe(1);

		expect(
			await page.evaluate(() => window.__penConformance.blockIds),
		).toEqual([BLOCK_ID]);
		expect(await readModelBlockText(page, BLOCK_ID)).toBe(TEXT);
	},
	{ axe: false },
);
