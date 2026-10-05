import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import type { ScenarioApi } from "../../src/types";
import { readBackend, readDocumentText } from "../input/keys";
import { readSurfaceText } from "./compose";

/**
 * C4 one composition lifecycle on the Chromium EditContext backend, driven
 * through real IME input (`Input.imeSetComposition` per update, then
 * `Input.insertText` to commit): a composition stays open across all of its
 * updates, holds no text in `Y.Text` until it commits once with the range it
 * replaced, maps that range through collaborator edits for the whole
 * composition, and leaves the EditContext buffer equal to the document.
 */

const BLOCK_ID = "hello-p1";

type FieldState = {
	doc: string;
	dom: string;
	buffer: string | null;
	focusOffset: number | null;
	anchorOffset: number | null;
};

async function readFieldState(page: Page): Promise<FieldState> {
	return page.evaluate((blockId) => {
		const bridge = window.__penConformance;
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface]",
		) as (HTMLElement & { editContext?: { text: string } | null }) | null;
		const selection = bridge.selection;
		const inField =
			selection?.type === "text" &&
			selection.focus.blockId === blockId &&
			selection.anchor.blockId === blockId;
		return {
			doc: bridge.blockText(blockId),
			dom:
				document.querySelector(
					`[data-block-id="${blockId}"] [data-pen-inline-content]`,
				)?.textContent ?? "",
			buffer: surface?.editContext?.text ?? null,
			focusOffset: inField ? selection.focus.offset : null,
			anchorOffset: inField ? selection.anchor.offset : null,
		};
	}, BLOCK_ID);
}

async function startEditContext(
	page: Page,
	s: ScenarioApi,
): Promise<CDPSession> {
	test.skip(
		test.info().project.name !== "chromium",
		"EditContext and Input.imeSetComposition are Chromium",
	);
	await s.load("hello-world");
	const backend = await readBackend(page);
	expect(backend.hasEditContext, "C4: the active surface is EditContext").toBe(
		true,
	);
	return page.context().newCDPSession(page);
}

async function press(page: Page, key: string, times: number): Promise<void> {
	for (let index = 0; index < times; index++) {
		await page.keyboard.press(key);
	}
}

async function caretAt(page: Page, offset: number): Promise<void> {
	await page.keyboard.press("Home");
	await press(page, "ArrowRight", offset);
	expect((await readFieldState(page)).focusOffset).toBe(offset);
}

/** Selects "world" backwards: anchor 11, focus 6. */
async function selectWorld(page: Page): Promise<void> {
	await page.keyboard.press("End");
	await press(page, "Shift+ArrowLeft", 5);
}

/** `toBe` whose check report's outcome is the same comparison. */
function expectCheck(
	actual: unknown,
	expected: unknown,
	label: string,
	report: string,
): void {
	const outcome = actual === expected ? "passed" : "failed";
	expect(actual, formatCheckReport(label, outcome, report)).toBe(expected);
}

async function compose(cdp: CDPSession, text: string): Promise<void> {
	await cdp.send("Input.imeSetComposition", {
		text,
		selectionStart: text.length,
		selectionEnd: text.length,
	});
}

async function commit(cdp: CDPSession, text: string): Promise<void> {
	await cdp.send("Input.insertText", { text });
}

/**
 * Checked after every composition update: the composition is not in the
 * document yet, and the selection record stays on the `Y.Text` range the
 * composition replaces (`replaced`, mapped through remote edits) rather than
 * pointing into composed text `Y.Text` does not have.
 */
async function expectHeldComposition(
	page: Page,
	label: string,
	expectedDoc: string,
	expectedDom: string,
	replaced: readonly [number, number],
): Promise<void> {
	const state = await readFieldState(page);
	const report = JSON.stringify(state);
	expectCheck(
		state.doc,
		expectedDoc,
		`${label}: the composition is held out of Y.Text until it commits`,
		report,
	);
	expectCheck(
		state.dom,
		expectedDom,
		`${label}: the field shows the composition`,
		report,
	);
	const [low, high] = replaced;
	const inBounds =
		state.focusOffset !== null &&
		state.anchorOffset !== null &&
		Math.min(state.focusOffset, state.anchorOffset) >= low &&
		Math.max(state.focusOffset, state.anchorOffset) <= high;
	expectCheck(
		inBounds,
		true,
		`${label}: the selection record stays on the replaced Y.Text range [${low}, ${high}]`,
		report,
	);
}

/** After a commit: one text everywhere, caret after the composed text. */
async function expectSettled(
	page: Page,
	label: string,
	expectedDoc: string,
	expectedCaret: number,
): Promise<void> {
	const state = await readFieldState(page);
	const report = JSON.stringify(state);
	expectCheck(
		state.doc,
		expectedDoc,
		`${label}: the commit lands at the replaced range`,
		report,
	);
	expect(state.dom, `${label}: DOM equals the document (${report})`).toBe(
		expectedDoc,
	);
	expect(
		state.buffer,
		`${label}: EditContext buffer equals the document (${report})`,
	).toBe(expectedDoc);
	expect(
		state.focusOffset,
		`${label}: caret after the composed text (${report})`,
	).toBe(expectedCaret);
	expect(state.anchorOffset, `${label}: caret collapsed (${report})`).toBe(
		expectedCaret,
	);
}

/**
 * The composition is closed after its commit: caret commands run again (C1
 * disables them only while composing), and a plain keystroke types at the
 * caret without being taken for a composition.
 */
async function expectClosedAfterCommit(
	page: Page,
	label: string,
	expectedDoc: string,
	caret: number,
): Promise<void> {
	await page.keyboard.press("ArrowLeft");
	const moved = await readFieldState(page);
	expectCheck(
		moved.focusOffset,
		caret - 1,
		`${label}: ArrowLeft runs after the commit (composition closed)`,
		JSON.stringify(moved),
	);
	await page.keyboard.type("!");
	const typed = `${expectedDoc.slice(0, caret - 1)}!${expectedDoc.slice(caret - 1)}`;
	await expectSettled(page, `${label} then "!"`, typed, caret);
}

const PINYIN = ["n", "ni", "nih", "niha", "nihao"];

for (let updates = 1; updates <= PINYIN.length; updates++) {
	scenario(
		`C4: a ${updates}-update pinyin composition mid-text commits once at its range`,
		async (s, page) => {
			const cdp = await startEditContext(page, s);
			await caretAt(page, 5);
			for (const text of PINYIN.slice(0, updates)) {
				await compose(cdp, text);
				await expectHeldComposition(
					page,
					`update ${JSON.stringify(text)}`,
					"Hello world",
					`Hello${text} world`,
					[5, 5],
				);
			}
			await commit(cdp, "你好");
			await expectSettled(page, "commit 你好", "Hello你好 world", 7);
			await expectClosedAfterCommit(page, "after 你好", "Hello你好 world", 7);
			await s.assert.domMatchesAuthority();
		},
		{ axe: false },
	);
}

scenario(
	"C4: Korean syllables composed mid-text keep the text after the caret",
	async (s, page) => {
		const cdp = await startEditContext(page, s);
		await caretAt(page, 5);
		let typed = "";
		for (const jamos of [["ㅎ", "하", "한"], ["ㄱ", "그", "글"]]) {
			const caret = 5 + typed.length;
			for (const jamo of jamos) {
				await compose(cdp, jamo);
				await expectHeldComposition(
					page,
					`update ${jamo}`,
					`Hello${typed} world`,
					`Hello${typed}${jamo} world`,
					[caret, caret],
				);
			}
			const syllable = jamos.at(-1)!;
			typed += syllable;
			await commit(cdp, syllable);
			const settled = `Hello${typed} world`;
			await expectSettled(page, `commit ${syllable}`, settled, caret + 1);
		}
		await expectClosedAfterCommit(page, "after 한글", "Hello한글 world", 7);
		await s.assert.domMatchesAuthority();
	},
	{ axe: false },
);

scenario(
	"C4: a Japanese composition over a selection replaces exactly the selection",
	async (s, page) => {
		const cdp = await startEditContext(page, s);
		await selectWorld(page);
		const selected = await readFieldState(page);
		expect([selected.anchorOffset, selected.focusOffset]).toEqual([11, 6]);
		for (const text of ["せ", "せかい"]) {
			await compose(cdp, text);
			await expectHeldComposition(
				page,
				`update ${text}`,
				"Hello world",
				`Hello ${text}`,
				[6, 11],
			);
		}
		await commit(cdp, "世界");
		await expectSettled(page, "commit 世界", "Hello 世界", 8);
		await expectClosedAfterCommit(page, "after 世界", "Hello 世界", 8);
		await s.assert.domMatchesAuthority();
	},
	{ axe: false },
);

scenario(
	"C4: a cancelled multi-update composition leaves the document and buffer unchanged",
	async (s, page) => {
		const cdp = await startEditContext(page, s);
		await caretAt(page, 5);
		for (const text of ["k", "ka", "kan"]) {
			await compose(cdp, text);
		}
		await compose(cdp, "");
		await expectSettled(page, "cancel", "Hello world", 5);
		await expectClosedAfterCommit(page, "after cancel", "Hello world", 5);
		await s.assert.domMatchesAuthority();
	},
	{ axe: false },
);

scenario(
	"C2: collaborator edits during a multi-update EditContext composition rebase the commit",
	async (s, page) => {
		const cdp = await startEditContext(page, s);
		await page.keyboard.press("End");
		let remote = "";
		for (const text of ["n", "ni", "nih", "niha"]) {
			await compose(cdp, text);
			await page.evaluate((blockId) => {
				window.__penConformance.remoteApply([
					{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" },
				]);
			}, BLOCK_ID);
			remote += "X";
			await expectHeldComposition(
				page,
				`update ${text} + remote`,
				`${remote}Hello world`,
				// C2: the composed field's DOM defers the remote edit.
				`Hello world${text}`,
				[11 + remote.length, 11 + remote.length],
			);
		}
		await commit(cdp, "你");
		await expectSettled(page, "commit 你", "XXXXHello world你", 16);
		await expectClosedAfterCommit(page, "after 你", "XXXXHello world你", 16);
		await s.assert.domMatchesAuthority();
	},
	{ axe: false },
);

scenario(
	"C2: a collaborator edit inside the replaced selection survives the composition",
	async (s, page) => {
		const cdp = await startEditContext(page, s);
		await selectWorld(page);
		await compose(cdp, "せ");
		await page.evaluate((blockId) => {
			window.__penConformance.remoteApply([
				{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" },
				{ type: "splice-text", blockId, from: 9, to: 9, insert: "Y" },
			]);
		}, BLOCK_ID);
		await compose(cdp, "せかい");
		await commit(cdp, "世界");
		const state = await readFieldState(page);
		// The remote "Y" sat inside the replaced "world" (between "wor" and
		// "ld"); only the replaced range's original characters are deleted.
		expect(
			state.doc === "XHello 世界Y" || state.doc === "XHello Y世界",
			`C2: remote insert inside the replaced range survives (${JSON.stringify(state)})`,
		).toBe(true);
		expect(state.dom).toBe(state.doc);
		expect(state.buffer).toBe(state.doc);
		await s.assert.domMatchesAuthority();
	},
	{ axe: false },
);

scenario(
	"C4: typing keeps the EditContext buffer equal to the document",
	async (s, page) => {
		await startEditContext(page, s);
		await page.keyboard.press("End");
		await page.keyboard.type("abc");
		await expectSettled(page, "typed abc", "Hello worldabc", 14);
		await page.keyboard.press("Backspace");
		await expectSettled(page, "Backspace", "Hello worldab", 13);
		await caretAt(page, 5);
		await page.keyboard.type("xy");
		await expectSettled(page, "typed xy mid-text", "Helloxy worldab", 7);
		await s.assert.domMatchesAuthority();
	},
	{ axe: false },
);

for (const updates of [1, 2, 3]) {
	scenario(
		`C4: clicking away after ${updates} composition update(s) keeps the composed text`,
		async (s, page) => {
			const cdp = await startEditContext(page, s);
			await page.keyboard.press("End");
			const texts = ["k", "ka", "kan"].slice(0, updates);
			for (const text of texts) {
				await compose(cdp, text);
			}
			const composed = texts[texts.length - 1]!;
			await page.mouse.click(5, 5);
			const doc = await readDocumentText(page);
			const dom = await readSurfaceText(page);
			expectCheck(
				doc.startsWith(`Hello world${composed}`),
				true,
				"C4: blur mid-composition commits the composed text",
				JSON.stringify({ doc, dom }),
			);
			expect(dom).toBe(`Hello world${composed}`);
		},
		{ axe: false },
	);
}
