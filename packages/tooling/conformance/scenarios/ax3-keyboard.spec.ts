import { expect, type Page } from "@playwright/test";
import { scenario } from "../src/scenario";

const AX3_URL = "/?ax3=1";

async function installPointerGuard(page: Page): Promise<void> {
	await page.evaluate(() => {
		const state = { count: 0 };
		(
			window as Window & { __ax3PointerCount?: { count: number } }
		).__ax3PointerCount = state;
		const bump = () => {
			state.count += 1;
		};
		// Enter on a focused <button> synthesizes `click`. That is keyboard
		// activation, not a pointer. Count only pointer/mouse down.
		for (const type of ["pointerdown", "mousedown"] as const) {
			document.addEventListener(type, bump, true);
		}
	});
}

const FIELD_SURFACE = "[data-pen-field-editor-active-surface]";

/**
 * W6.R10: AX3 asserts the exact focused element, not containment in the
 * root. `selector` must match `document.activeElement` itself.
 */
async function expectFocused(
	page: Page,
	selector: string,
	what: string,
): Promise<void> {
	const result = await page.evaluate((sel) => {
		const active = document.activeElement;
		const describe = (element: Element | null): string => {
			if (!element) return "null";
			const attrs = Array.from(element.attributes)
				.filter(
					(attr) =>
						attr.name.startsWith("data-") ||
						attr.name === "role" ||
						attr.name === "class",
				)
				.map((attr) => `${attr.name}="${attr.value}"`)
				.join(" ");
			return `<${element.tagName.toLowerCase()} ${attrs}>`;
		};
		return {
			matches: active instanceof Element && active.matches(sel),
			active: describe(active),
		};
	}, selector);
	expect(
		result.matches,
		`AX3: focus should be on ${what} (${selector}); document.activeElement is ${result.active}`,
	).toBe(true);
}

/** The field surface inside block `blockId` holds focus. */
function fieldOf(blockId: string): string {
	return `[data-pen-editor-block][data-block-id="${blockId}"] ${FIELD_SURFACE}`;
}

async function assertNoPointerEvents(page: Page): Promise<void> {
	const count = await page.evaluate(
		() =>
			(window as Window & { __ax3PointerCount?: { count: number } })
				.__ax3PointerCount?.count ?? -1,
	);
	expect(count, "AX3 scenarios must not dispatch pointer events").toBe(0);
}

scenario(
	"AX3: slash-menu insertion is keyboard-only and restores field focus",
	async (s, page) => {
		await installPointerGuard(page);
		await s.load("hello-world", { pointer: false });
		const blockId = await page.evaluate(
			() => window.__penConformance.blockIds[0],
		);
		expect(blockId).toBeTruthy();
		await s.apply([
			{
				type: "splice-text",
				blockId: blockId!,
				from: 0,
				to: 0 + 11,
				insert: "",
			},
		]);
		await s.keyboard.type("/head");
		const headingOption = page.locator(
			'[data-pen-slash-menu-item][data-block-type="heading"]',
		);
		await expect(headingOption).toBeVisible();
		await page.keyboard.press("Enter");
		await expect(
			page.locator('[data-pen-editor-block][data-block-type="heading"]'),
		).toBeVisible();
		await expect(page.locator("[data-pen-slash-menu-item]")).toHaveCount(0);
		// a heading existing is not enough: a leftover "/head" paragraph
		// reopens the listbox as soon as selection returns to it.
		const documentText = await page.evaluate(
			() => window.__penConformance.documentText,
		);
		expect(
			documentText,
			"confirm must not leave the slash trigger in the document",
		).not.toContain("/head");
		await expectFocused(page, fieldOf(blockId!), "the heading's field");
		await assertNoPointerEvents(page);
	},
	{ url: AX3_URL },
);

scenario(
	"AX3: autocomplete acceptance is keyboard-only and keeps field focus",
	async (s, page) => {
		await installPointerGuard(page);
		await s.load("hello-world", { pointer: false });
		await page.keyboard.press("End");
		await page.keyboard.press("Tab");
		await expect(
			page.locator("[data-suggestion-text], [data-pen-autocomplete-preview-block]"),
		).toBeVisible();
		await page.keyboard.press("Tab");
		await s.assert.textContains("completion");
		const blockId = await page.evaluate(
			() => window.__penConformance.blockIds[0],
		);
		await expectFocused(page, fieldOf(blockId!), "the completed block's field");
		await assertNoPointerEvents(page);
	},
	{ url: AX3_URL },
);

scenario(
	"AX3: block reorder via handle menu is keyboard-only and restores handle focus",
	async (s, page) => {
		await installPointerGuard(page);
		await s.load("two-paragraph", { pointer: false });
		await page.evaluate(() => {
			document
				.querySelector<HTMLElement>(
					'[data-pen-block-handle][data-block-id="two-p2"]',
				)
				?.focus();
		});
		await page.keyboard.press("Enter");
		await expect(
			page.locator('[data-pen-command="pen.moveBlockUp"]'),
		).toBeVisible();
		await page.keyboard.press("Enter");
		const order = await page.evaluate(() => window.__penConformance.blockIds);
		expect(order[0]).toBe("two-p2");
		expect(order[1]).toBe("two-p1");
		await expect(page.locator("[data-pen-block-handle-menu]")).toHaveCount(0);
		await expectFocused(
			page,
			'[data-pen-block-handle][data-block-id="two-p2"]',
			"the moved block's handle",
		);
		await assertNoPointerEvents(page);
	},
	{ url: AX3_URL },
);

/**
 * A move that regroups a list item (it leads a run, or crosses into another
 * run) re-keys or replaces its AX1 group wrapper, which remounts the block
 * and its handle (D7). Focus still returns to the moved block's handle.
 */
const REGROUPING_MOVES = [
	{ blockId: "sem-b1", command: "pen.moveBlockDown", neighbours: ["sem-b1a", "sem-b1", "sem-b2"] },
	{ blockId: "sem-b1a", command: "pen.moveBlockUp", neighbours: ["sem-b1a", "sem-b1", "sem-b2"] },
	{ blockId: "sem-b2", command: "pen.moveBlockDown", neighbours: ["sem-between", "sem-b2", "sem-b3"] },
	{ blockId: "sem-b3", command: "pen.moveBlockUp", neighbours: ["sem-b2", "sem-b3", "sem-between"] },
] as const;

for (const { blockId, command, neighbours } of REGROUPING_MOVES) {
	scenario(
		`AX3: ${command} from the handle menu of list item ${blockId} keeps focus on its handle across the regroup`,
		async (s, page) => {
			await installPointerGuard(page);
			await s.load("semantics", { pointer: false });
			const handle = `[data-pen-block-handle][data-block-id="${blockId}"]`;
			await page.evaluate((selector) => {
				document.querySelector<HTMLElement>(selector)?.focus();
			}, handle);
			await expectFocused(page, handle, "the list item's handle");
			await page.keyboard.press("Enter");
			const item = page.locator(`[data-pen-block-handle-menu] [data-pen-command="${command}"]`);
			await expect(item).toBeVisible();
			await item.focus();
			await page.keyboard.press("Enter");
			const order = await page.evaluate(() => window.__penConformance.blockIds);
			const at = order.indexOf(neighbours[1]);
			expect(order.slice(at - 1, at + 2)).toEqual(neighbours);
			await expect(page.locator("[data-pen-block-handle-menu]")).toHaveCount(0);
			await expectFocused(page, handle, "the moved block's handle");
			await assertNoPointerEvents(page);
		},
		{ url: AX3_URL },
	);
}

scenario(
	"AX3: table row and column insertion is keyboard-only and keeps control focus",
	async (s, page) => {
		await installPointerGuard(page);
		await s.load("hello-world", { pointer: false });
		await s.apply([
			{
				type: "insert-block",
				blockId: "ax3-table",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);
		const addRow = page.getByRole("button", { name: "Add row" });
		const rowCount = await page.locator("[data-pen-table-row]").count();
		await page.evaluate(() => {
			document
				.querySelector<HTMLElement>(".pen-table-add-row-control")
				?.focus();
		});
		await page.keyboard.press("Enter");
		await expect(page.locator("[data-pen-table-row]")).toHaveCount(rowCount + 1);
		await expect(addRow).toBeVisible();
		await expectFocused(
			page,
			'[data-block-id="ax3-table"] .pen-table-add-row-control',
			"the add-row button",
		);

		const firstRowCells = page
			.locator('[data-block-id="ax3-table"] [data-pen-table-row]')
			.first()
			.locator("[data-pen-table-cell]");
		const columnCount = await firstRowCells.count();
		await page.evaluate(() => {
			document
				.querySelector<HTMLElement>(
					'[data-block-id="ax3-table"] .pen-table-add-column-control',
				)
				?.focus();
		});
		await page.keyboard.press("Enter");
		await expect(firstRowCells).toHaveCount(columnCount + 1);
		await expectFocused(
			page,
			'[data-block-id="ax3-table"] .pen-table-add-column-control',
			"the add-column button",
		);
		await assertNoPointerEvents(page);
	},
	{ url: AX3_URL },
);

scenario(
	"AX3: Escape from the toolbar returns focus to the field",
	async (s, page) => {
		await installPointerGuard(page);
		await s.load("hello-world", { pointer: false });
		const blockId = await page.evaluate(
			() => window.__penConformance.blockIds[0],
		);
		await page.keyboard.press("End");
		await expectFocused(page, fieldOf(blockId!), "the field");
		await page.evaluate(() => {
			document
				.querySelector<HTMLElement>(
					'[data-pen-toolbar] [data-pen-toolbar-toggle][data-format="bold"]',
				)
				?.focus();
		});
		await expectFocused(
			page,
			'[data-pen-toolbar] [data-pen-toolbar-toggle][data-format="bold"]',
			"the toolbar control",
		);
		// APG toolbar: keyboard activation keeps focus on the control.
		await page.keyboard.press("Enter");
		await expectFocused(
			page,
			'[data-pen-toolbar] [data-pen-toolbar-toggle][data-format="bold"]',
			"the activated toolbar control",
		);
		await page.keyboard.press("Escape");
		await expectFocused(page, fieldOf(blockId!), "the field");
		await assertNoPointerEvents(page);
	},
	{ url: AX3_URL },
);

scenario(
	"AX3: a table column menu action returns focus to the column header button",
	async (s, page) => {
		await installPointerGuard(page);
		await s.load("hello-world", { pointer: false });
		await s.apply([
			{
				type: "insert-block",
				blockId: "ax3-table",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);
		const header = page.locator("[data-pen-ax3-column-header]");
		await page.evaluate(() => {
			document
				.querySelector<HTMLElement>("[data-pen-ax3-column-header]")
				?.focus();
		});
		await page.keyboard.press("Enter");
		await expect(page.locator("[data-pen-column-menu]")).toBeVisible();
		const insertRight = page.getByRole("menuitem", {
			name: "Insert right",
		});
		await insertRight.focus();
		await expectFocused(page, "[data-pen-column-menu] [role=menuitem]", "a column menu item");
		await page.keyboard.press("Enter");
		await expect(page.locator("[data-pen-column-menu]")).toHaveCount(0);
		await expect(header).toBeVisible();
		await expectFocused(
			page,
			"[data-pen-ax3-column-header]",
			"the column header button",
		);
		await assertNoPointerEvents(page);
	},
	{ url: AX3_URL },
);
