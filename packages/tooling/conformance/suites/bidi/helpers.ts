import { expect, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { authorityCheckKind } from "../../src/standingAssertions";
import type { DomAuthorityCheck } from "../../src/types";

export { attachJson, logLoad } from "../specHelpers";

export type TextCaret = {
	blockId: string;
	offset: number;
	isCollapsed: boolean;
	anchorOffset: number;
	focusOffset: number;
};

export type DirSnapshot = {
	blockId: string;
	dir: string | null;
	text: string;
	unicodeBidi: string;
};

export async function readCaret(page: Page): Promise<TextCaret | null> {
	return page.evaluate(() => {
		const selection = window.__penConformance.selection;
		if (selection?.type !== "text") {
			return null;
		}
		return {
			blockId: selection.focus.blockId,
			offset: selection.focus.offset,
			isCollapsed: window.__penConformance.isCollapsed(),
			anchorOffset: selection.anchor.offset,
			focusOffset: selection.focus.offset,
		};
	});
}

export async function readDir(page: Page, blockId: string): Promise<DirSnapshot | null> {
	return page.evaluate((id) => {
		const block = document.querySelector(`[data-block-id="${id}"]`);
		if (!(block instanceof HTMLElement)) {
			return null;
		}
		const inline = block.querySelector("[data-pen-inline-content]");
		const host = inline instanceof HTMLElement ? inline : block;
		return {
			blockId: id,
			dir: block.getAttribute("dir"),
			text: inline?.textContent ?? "",
			unicodeBidi: getComputedStyle(host).unicodeBidi,
		};
	}, blockId);
}

/**
 * Polls until the block renders mixed RTL-script and Latin text under the
 * expected resolved `dir`, so a keystroke scenario starts on a real
 * mixed-direction line.
 */
export async function expectMixedBlockDir(
	page: Page,
	blockId: string,
	dir: "ltr" | "rtl",
): Promise<void> {
	await expect
		.poll(async () => {
			const snap = await readDir(page, blockId);
			if (!snap) {
				return "missing";
			}
			if (!/[֐-ࣿ]/.test(snap.text) || !/[A-Za-z]/.test(snap.text)) {
				return `not-mixed:${snap.text}`;
			}
			return snap.dir;
		})
		.toBe(dir);
}

export async function replayImeCommit(
	page: Page,
	blockId: string,
	composed: string,
): Promise<string> {
	return page.evaluate(
		({ id, text }) => {
			const block = document.querySelector(`[data-block-id="${id}"]`);
			if (!(block instanceof HTMLElement)) {
				throw new Error(`replayImeCommit: missing block ${id}`);
			}
			const surface =
				block.querySelector(
					"[data-pen-inline-content][contenteditable='true']",
				) ??
				block.querySelector("[data-pen-field-editor-active-surface]") ??
				block.querySelector("[data-pen-inline-content]");
			if (!(surface instanceof HTMLElement)) {
				throw new Error(`replayImeCommit: no surface on ${id}`);
			}
			surface.dispatchEvent(
				new CompositionEvent("compositionstart", { bubbles: true }),
			);
			surface.dispatchEvent(
				new CompositionEvent("compositionupdate", {
					bubbles: true,
					data: text,
				}),
			);
			const before = new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "insertCompositionText",
				data: text,
			});
			Object.defineProperty(before, "inputType", {
				configurable: true,
				value: "insertCompositionText",
			});
			surface.dispatchEvent(before);
			// a real IME mutates the field before compositionend; the
			// contenteditable backend commits a DOM-vs-start-text diff.
			surface.append(text);
			surface.dispatchEvent(
				new CompositionEvent("compositionend", {
					bubbles: true,
					data: text,
				}),
			);
			return window.__penConformance.documentText;
		},
		{ id: blockId, text: composed },
	);
}

export async function readBlockText(page: Page, blockId: string): Promise<string> {
	return page.evaluate((id) => {
		const block = document.querySelector(`[data-block-id="${id}"]`);
		return (
			block?.querySelector("[data-pen-inline-content]")?.textContent ?? ""
		);
	}, blockId);
}

export async function clickOffset(
	page: Page,
	blockId: string,
	offset: number,
): Promise<void> {
	const point = await getInlineOffsetPoint(page, { blockId, offset });
	await page.mouse.click(point.x, point.y);
	// range(0,1).left is the visual left. in an rtl block Chromium's
	// caretPositionFromPoint maps that edge to the logical end, and
	// selectionBridge agrees — the click only activates the field.
	await page.evaluate(
		({ id, caret }) => {
			const index = window.__penConformance.blockIds.indexOf(id);
			if (index < 0) {
				throw new Error(`clickOffset: missing block ${id}`);
			}
			window.__penConformance.selectText(index, caret);
		},
		{ id: blockId, caret: offset },
	);
	await expect
		.poll(async () => {
			const caret = await readCaret(page);
			if (!caret) {
				return "not-text";
			}
			return `${caret.blockId}:${caret.offset}:${caret.isCollapsed}`;
		})
		.toBe(`${blockId}:${offset}:true`);
}

export async function readS2(page: Page): Promise<DomAuthorityCheck> {
	return page.evaluate(() => window.__penConformance.domMatchesAuthority());
}

export function expectS2Matched(
	s2: DomAuthorityCheck,
	label: string,
): void {
	const kind = authorityCheckKind(s2);
	expect(
		kind,
		formatCheckReport(
			label,
			kind === "matched" ? "passed" : kind === "unchecked" ? "skipped" : "failed",
			s2.reason,
		),
	).toBe("matched");
}

export function isIsolate(unicodeBidi: string): boolean {
	return /isolate/i.test(unicodeBidi) && !/override/i.test(unicodeBidi);
}
