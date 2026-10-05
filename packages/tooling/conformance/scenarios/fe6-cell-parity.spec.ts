import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../src/checkReport";
import { scenario } from "../src/scenario";
import type { ScenarioApi } from "../src/types";
import { snapshotBytes } from "../suites/specHelpers";

/**
 * FE6: the cell-parity contract, in a real browser.
 *
 * `packages/rendering/dom/CELL-PARITY.md` declares what editing inside a table
 * cell supports. This scenario is that document's net. It exercises the
 * supported rows against a live cell — text entry, caret movement, cell-to-cell
 * navigation, undo — and then holds the one declared-unsupported capability to
 * the harder half of FE6: declining is not enough, the decline has to be
 * observable. A mark toggle inside a cell must leave the document byte-identical
 * on every engine, and where the engine actually delivers the toggle intent it
 * must report `cell-capability-unsupported`.
 *
 * jsdom cannot stand in for this. The supported rows are keyboard and selection
 * behavior, and the unsupported row is reached through a real `beforeinput` that
 * only a browser's bold accelerator produces. Chromium and WebKit produce it;
 * Firefox does not. That split is part of what this scenario pins down.
 *
 * The keyboard is driven through `page`, not `s.keyboard`, for the reason
 * `t6-cell-editing-arrows.spec.ts` does the same: the harness's per-step
 * standing check compares the DOM against a *text* selection authority, and
 * cell editing holds a `cell` selection, so it can only report "unchecked".
 * Treating that as a pass is the skip-as-success hole `standingFilter` exists to
 * keep closed, so an in-cell scenario asserts its own invariants instead.
 */

const TABLE_ID = "fe6-parity-table";
const CELL_CAPABILITY_UNSUPPORTED = "cell-capability-unsupported";

/** A check-report message whose outcome is `ok`. */
function check(label: string, ok: boolean, detail: string): string {
	return formatCheckReport(label, ok ? "passed" : "failed", detail);
}

async function seedTable(s: ScenarioApi): Promise<void> {
	await s.load("hello-world");
	await s.apply([
		{
			type: "insert-block",
			blockId: TABLE_ID,
			blockType: "table",
			props: {},
			position: "last",
		},
		{
			type: "splice-text",
			blockId: TABLE_ID,
			cell: { row: 0, col: 0 },
			from: 0,
			to: 0,
			insert: "alpha",
		},
		{
			type: "splice-text",
			blockId: TABLE_ID,
			cell: { row: 0, col: 1 },
			from: 0,
			to: 0,
			insert: "beta",
		},
	]);
}

function cellLocator(page: Page, row: number, col: number) {
	return page
		.locator(
			`[data-block-id="${TABLE_ID}"] [data-cell-row="${row}"][data-cell-col="${col}"]`,
		)
		.first();
}

async function editCell(page: Page, row: number, col: number): Promise<void> {
	const cell = cellLocator(page, row, col);
	await expect(cell).toBeVisible();
	await cell.dblclick();
	await expect(
		page.locator("[data-pen-field-editor-active-surface]"),
	).toBeVisible();
}

/** The cell the field editor is attached to, as the DOM reports it. */
async function readActiveCell(
	page: Page,
): Promise<{ row: string | null; col: string | null } | null> {
	return page.evaluate(() => {
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface][data-cell-row][data-cell-col]",
		);
		if (!(surface instanceof HTMLElement)) {
			return null;
		}
		return {
			row: surface.getAttribute("data-cell-row"),
			col: surface.getAttribute("data-cell-col"),
		};
	});
}

async function readCellText(
	page: Page,
	row: number,
	col: number,
): Promise<string> {
	return (await cellLocator(page, row, col).textContent()) ?? "";
}

scenario(
	"FE6: a cell supports text entry, caret movement, cell navigation, and undo",
	async (s, page) => {
		await seedTable(s);
		await editCell(page, 0, 0);

		// Text entry: the supported row that everything else rests on. Read the
		// cell, not `documentText`: that helper walks block text, and a table
		// block's own text is empty because cells own theirs.
		await page.keyboard.press("End");
		await page.keyboard.type("X");
		expect(await readCellText(page, 0, 0)).toContain("alphaX");

		// Caret movement inside the cell, then typing at the moved caret.
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.type("Y");
		const afterCaretMove = await readCellText(page, 0, 0);

		// Cell-to-cell navigation: Tab is a move, and the field editor follows.
		await page.keyboard.press("Tab");
		const activeAfterTab = await readActiveCell(page);

		// Undo of a cell edit.
		await editCell(page, 0, 0);
		const beforeUndo = await readCellText(page, 0, 0);
		await page.keyboard.press("ControlOrMeta+z");
		const afterUndo = await readCellText(page, 0, 0);

		await test.info().attach("fe6-cell-supported", {
			body: JSON.stringify(
				{ afterCaretMove, activeAfterTab, beforeUndo, afterUndo },
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			afterCaretMove,
			check(
				"FE6: ArrowLeft moved the cell caret, so the insert landed before the last character",
				afterCaretMove === "alphaYX",
				`cell text=${afterCaretMove}`,
			),
		).toBe("alphaYX");
		expect(
			activeAfterTab,
			check(
				"FE6: Tab moved the field editor to the next cell",
				activeAfterTab?.col === "1",
				`active cell=${JSON.stringify(activeAfterTab)}`,
			),
		).toEqual({ row: "0", col: "1" });
		const undone = afterUndo !== beforeUndo;
		expect(
			undone,
			check("FE6: undo reverted a cell edit", undone, `${beforeUndo} → ${afterUndo}`),
		).toBe(true);
	},
);

/** The native caret's offset inside the active cell, or null outside it. */
async function readNativeCellOffset(page: Page): Promise<number | null> {
	return page.evaluate(() => {
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface][data-cell-row][data-cell-col]",
		);
		const selection = surface?.ownerDocument.getSelection();
		if (!(surface instanceof HTMLElement) || !selection?.rangeCount) {
			return null;
		}
		const range = selection.getRangeAt(0);
		if (!surface.contains(range.startContainer)) {
			return null;
		}
		const prefix = surface.ownerDocument.createRange();
		prefix.selectNodeContents(surface);
		prefix.setEnd(range.startContainer, range.startOffset);
		return prefix.toString().length;
	});
}

async function readCellCaret(page: Page): Promise<{
	text: { anchor: number; focus: number } | null;
	native: number | null;
	mismatches: number;
}> {
	const native = await readNativeCellOffset(page);
	const state = await page.evaluate(() => {
		const selection = window.__penConformance.selection;
		return {
			text: selection?.type === "cell" ? (selection.text ?? null) : null,
			mismatches: window.__penConformance.diagnostics.filter(
				(event) => event.code === "selection-projection-mismatch",
			).length,
		};
	});
	return { ...state, native };
}

scenario(
	"FE6: the cell caret is the authority's CellSelection.text and S2 holds while editing",
	async (s, page) => {
		await seedTable(s);
		await editCell(page, 0, 0);
		const activated = await readCellCaret(page);

		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowLeft");
		const moved = await readCellCaret(page);

		await page.keyboard.type("Z");
		const typed = await readCellCaret(page);

		const box = await cellLocator(page, 0, 0).boundingBox();
		if (!box) {
			throw new Error("cell has no box");
		}
		await page.mouse.click(box.x + 2, box.y + box.height / 2);
		const clicked = await readCellCaret(page);

		const steps = { activated, moved, typed, clicked };
		await test.info().attach("fe6-cell-caret-authority", {
			body: JSON.stringify(steps, null, 2),
			contentType: "application/json",
		});

		expect(
			[activated.text, moved.text, typed.text],
			check(
				"FE6: activation, arrows and typing move CellSelection.text",
				activated.text?.focus === 5 && moved.text?.focus === 3 && typed.text?.focus === 4,
				JSON.stringify(steps),
			),
		).toEqual([
			{ anchor: 5, focus: 5 },
			{ anchor: 3, focus: 3 },
			{ anchor: 4, focus: 4 },
		]);
		for (const [name, step] of Object.entries(steps)) {
			expect(
				step.native,
				check(
					`S2: the native caret shows CellSelection.text after ${name}`,
					step.native !== null && step.native === step.text?.focus,
					JSON.stringify(step),
				),
			).toBe(step.text?.focus);
		}
		expect(
			clicked.text?.focus,
			check(
				"FE6: a click inside the edited cell writes CellSelection.text",
				clicked.text?.focus === 0,
				JSON.stringify(clicked),
			),
		).toBe(0);
		expect(
			clicked.mismatches,
			check(
				"FE6: editing a cell projects without a selection-projection-mismatch",
				clicked.mismatches === 0,
				`mismatches=${clicked.mismatches}`,
			),
		).toBe(0);
	},
);

/**
 * The bold accelerator inside an edited cell, on every engine.
 *
 * The field editor declines it on keydown, which every engine delivers, rather
 * than waiting for a native `formatBold` `beforeinput`. That event is engine-
 * and host-dependent: Chromium produces it inside a contenteditable, Firefox
 * never does, and WebKit only does when the host application maps the key
 * equivalent to a bold command (Safari's Format menu does; a bare WKWebView,
 * which is what Playwright drives, does not). A decline that rode on that
 * event was observable on one of the three conformance engines.
 *
 * Declining on keydown prevents the default, so no engine follows with a
 * `formatBold` either; the scenario pins that too, because a native toggle
 * arriving after the keydown would report the same decline twice.
 */
scenario(
	"FE6: a mark toggle inside a cell fails closed and says so",
	async (s, page) => {
		const browserName = test.info().project.name;
		s.expectDiagnostic(CELL_CAPABILITY_UNSUPPORTED);

		await seedTable(s);
		await editCell(page, 0, 0);
		// Select the cell's text, which is the case a mark toggle would act on if
		// cells supported marks — a collapsed caret would decline for the ordinary
		// pending-mark reason and prove nothing about cells.
		await page.keyboard.press("Home");
		await page.keyboard.press("Shift+End");

		await page.evaluate(() => {
			const seen: string[] = [];
			(
				window as unknown as { __fe6InputTypes: string[] }
			).__fe6InputTypes = seen;
			document.addEventListener(
				"beforeinput",
				(event) => {
					seen.push((event as InputEvent).inputType);
				},
				true,
			);
		});

		const readBytes = async () =>
			snapshotBytes(await page.evaluate(() => window.__penConformance.documentSnapshot()));
		const before = await readBytes();
		await page.keyboard.press("ControlOrMeta+b");
		const after = await readBytes();

		const inputTypes = await page.evaluate(
			() => (window as unknown as { __fe6InputTypes: string[] }).__fe6InputTypes,
		);
		const diagnostics = await page.evaluate(() => window.__penConformance.diagnostics);
		const declines = diagnostics.filter(
			(event) => event.code === CELL_CAPABILITY_UNSUPPORTED,
		);
		const declined = declines[0];

		await test.info().attach("fe6-cell-marks-decline", {
			body: JSON.stringify(
				{
					browserName,
					inputTypes,
					changed: before !== after,
					diagnostics,
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			after,
			check(
				"FE6: a mark toggle leaves a cell's document bytes untouched",
				before === after,
				before === after ? "unchanged" : "document changed",
			),
		).toBe(before);

		expect(
			inputTypes,
			check(
				"FE6: the declined accelerator is not followed by a native formatBold",
				inputTypes.length === 0,
				`${browserName} inputTypes=${JSON.stringify(inputTypes)}`,
			),
		).toEqual([]);

		expect(
			declines.length,
			check(
				"FE6: the decline is observable, once, on every engine",
				declines.length === 1,
				`${browserName} diagnostics=${JSON.stringify(diagnostics)}`,
			),
		).toBe(1);

		const message = declined?.message ?? "";
		const expectedMessage = "marks are not supported inside a table cell";
		expect(
			message,
			check(
				"FE6: the diagnostic names the capability and the surface",
				message.includes(expectedMessage),
				`message=${declined?.message}`,
			),
		).toContain(expectedMessage);
	},
);
