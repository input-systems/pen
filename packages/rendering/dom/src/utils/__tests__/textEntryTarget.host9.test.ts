// @vitest-environment jsdom

import type { ReadonlySelectionState } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../dataAttributes";
import {
	isForeignNativeTextEntryTarget,
	shouldHandleEditorKeyboardEvent,
} from "../textEntryTarget";

const caret: ReadonlySelectionState = {
	type: "text",
	anchor: { blockId: "block-1", offset: 2 },
	focus: { blockId: "block-1", offset: 2 },
};

const blockSelection: ReadonlySelectionState = {
	type: "block",
	blockIds: ["block-1"],
};

const cellSelection: ReadonlySelectionState = {
	type: "cell",
	blockId: "table-1",
	anchor: { row: 0, col: 0 },
	head: { row: 0, col: 0 },
};

const textRange: ReadonlySelectionState = {
	type: "text",
	anchor: { blockId: "block-1", offset: 0 },
	focus: { blockId: "block-2", offset: 3 },
};

/** A plain keydown (no modifier) dispatched on `target`. */
function plainKeyDownOn(target: Element, key: string): KeyboardEvent {
	const event = new KeyboardEvent("keydown", { key, bubbles: true });
	target.dispatchEvent(event);
	return event;
}

function mountRoot(parent: HTMLElement = document.body): HTMLElement {
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	parent.appendChild(root);
	return root;
}

function keyDownOn(
	target: Element,
	key: string,
	shiftKey = false,
): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {
		key,
		metaKey: true,
		shiftKey,
		bubbles: true,
	});
	target.dispatchEvent(event);
	return event;
}

describe("HOST9: document keys follow focus", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	/** Focus outside the root: a host element beside it, or a wrapper of it. */
	function focusOutside(kind: "host" | "wrapper"): {
		root: HTMLElement;
		focused: HTMLElement;
	} {
		const focused = document.createElement(
			kind === "host" ? "button" : "div",
		);
		focused.tabIndex = 0;
		document.body.appendChild(focused);
		const root = mountRoot(kind === "wrapper" ? focused : document.body);
		focused.focus();
		return { root, focused };
	}

	it.each([
		["Mod-a", "a", false],
		["Mod-z", "z", false],
		["Mod-Shift-z", "z", true],
	])(
		"HOST9: a focused host element outside the root keeps %s",
		(_name, key, shiftKey) => {
			const { root, focused } = focusOutside("host");

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: keyDownOn(focused, key, shiftKey),
					selection: caret,
					hasMappedDomSelection: () => true,
				}),
			).toBe(false);
		},
	);

	it.each([
		["Mod-a", "a", false],
		["Mod-z", "z", false],
		["Mod-Shift-z", "z", true],
	])(
		"HOST9: %s on the body stays with the host, whatever caret and range the editor kept",
		(_name, key, shiftKey) => {
			const root = mountRoot();

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: keyDownOn(document.body, key, shiftKey),
					selection: caret,
					hasMappedDomSelection: () => true,
				}),
			).toBe(false);
		},
	);

	it.each([
		["ArrowDown", blockSelection],
		["Enter", blockSelection],
		["Backspace", blockSelection],
		["Delete", blockSelection],
		["Tab", cellSelection],
		["ArrowRight", cellSelection],
		["Backspace", cellSelection],
		["Escape", textRange],
		["Backspace", textRange],
	] as const)(
		"HOST9: a focused host element outside the root keeps %s over a leftover %o",
		(key, selection) => {
			const { root, focused } = focusOutside("host");

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: plainKeyDownOn(focused, key),
					selection,
					hasMappedDomSelection: () => true,
				}),
			).toBe(false);
		},
	);

	it.each(["ArrowDown", "Enter", "Backspace", "Escape"])(
		"HOST9: %s on the body leaves the editor's block selection alone",
		(key) => {
			const root = mountRoot();

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: plainKeyDownOn(document.body, key),
					selection: blockSelection,
				}),
			).toBe(false);
		},
	);

	it.each([
		["Mod-z", "z", caret],
		["Backspace", "Backspace", blockSelection],
	] as const)(
		"HOST9: a focused wrapper around the root is not the editor and keeps %s",
		(_name, key, selection) => {
			const { root, focused } = focusOutside("wrapper");
			const event =
				key === "z"
					? keyDownOn(focused, key)
					: plainKeyDownOn(focused, key);

			expect(
				shouldHandleEditorKeyboardEvent({ root, event, selection }),
			).toBe(false);
		},
	);

	it.each([
		["Mod-z", "z", caret],
		["Backspace", "Backspace", blockSelection],
	] as const)(
		"HOST9: with focus on the editor root, %s reaches the editor",
		(_name, key, selection) => {
			const root = mountRoot();
			root.tabIndex = 0;
			root.focus();
			const event =
				key === "z" ? keyDownOn(root, key) : plainKeyDownOn(root, key);

			expect(
				shouldHandleEditorKeyboardEvent({ root, event, selection }),
			).toBe(true);
		},
	);

	it("HOST9: a key dispatched on the root of an unfocused editor is not taken", () => {
		const root = mountRoot();

		expect(
			shouldHandleEditorKeyboardEvent({
				root,
				event: plainKeyDownOn(root, "Escape"),
				selection: textRange,
			}),
		).toBe(false);
	});
});

describe("HOST9: the editor's own field before its surface marker is painted", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	/** jsdom does not compute `isContentEditable`. */
	function editable(root: HTMLElement, marker: string): HTMLElement {
		const element = document.createElement("div");
		element.setAttribute(marker, "");
		Object.defineProperty(element, "isContentEditable", { value: true });
		root.appendChild(element);
		return element;
	}

	it.each([
		["expanded blocks host", DATA_ATTRS.editorBlocksHost],
		["inline field", DATA_ATTRS.inlineContent],
	])("HOST9: the %s is not foreign to its own root", (_name, marker) => {
		const root = mountRoot();

		expect(
			isForeignNativeTextEntryTarget(editable(root, marker), root),
		).toBe(false);
	});

	it("HOST9: another editor's expanded blocks host is foreign", () => {
		const root = mountRoot();
		const other = mountRoot();

		expect(
			isForeignNativeTextEntryTarget(
				editable(other, DATA_ATTRS.editorBlocksHost),
				root,
			),
		).toBe(true);
	});

	it("HOST9: host chrome nested in the root stays foreign", () => {
		const root = mountRoot();
		const prompt = document.createElement("textarea");
		root.appendChild(prompt);

		expect(isForeignNativeTextEntryTarget(prompt, root)).toBe(true);
	});
});
