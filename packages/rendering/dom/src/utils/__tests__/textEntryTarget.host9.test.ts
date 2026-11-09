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

describe("HOST9 document shortcuts and host focus", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it.each([
		["Mod-a", "a", false],
		["Mod-z", "z", false],
		["Mod-Shift-z", "z", true],
	])(
		"HOST9: a focused host element outside the root keeps %s",
		(_name, key, shiftKey) => {
			const root = mountRoot();
			const hostButton = document.createElement("button");
			document.body.appendChild(hostButton);
			hostButton.focus();

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: keyDownOn(hostButton, key, shiftKey),
					selection: caret,
					hasMappedDomSelection: () => true,
				}),
			).toBe(false);
		},
	);

	it.each(["z", "a"])(
		"HOST9: Mod-%s still reaches the editor once focus has fallen to the body from it",
		(key) => {
			const root = mountRoot();

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: keyDownOn(document.body, key),
					selection: caret,
					heldFocusLast: () => true,
				}),
			).toBe(true);
		},
	);

	it.each([
		["Mod-a", "a", false],
		["Mod-z", "z", false],
		["Mod-Shift-z", "z", true],
	])(
		"HOST9: %s on a body that focus fell to from a host element stays with the host, whatever range the editor kept",
		(_name, key, shiftKey) => {
			const root = mountRoot();

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: keyDownOn(document.body, key, shiftKey),
					selection: caret,
					hasMappedDomSelection: () => true,
					heldFocusLast: () => false,
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
			const root = mountRoot();
			const menuItem = document.createElement("button");
			menuItem.setAttribute("role", "menuitem");
			document.body.appendChild(menuItem);
			menuItem.focus();

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: plainKeyDownOn(menuItem, key),
					selection,
					hasMappedDomSelection: () => true,
				}),
			).toBe(false);
		},
	);

	it.each(["ArrowDown", "Enter", "Backspace", "Escape"])(
		"HOST9: %s on a body that focus fell to from a host element leaves a block selection alone",
		(key) => {
			const root = mountRoot();

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: plainKeyDownOn(document.body, key),
					selection: blockSelection,
					heldFocusLast: () => false,
				}),
			).toBe(false);
		},
	);

	it.each(["ArrowDown", "Enter", "Backspace", "Escape"])(
		"HOST9: %s on a body that focus fell to from the editor still acts on its block selection",
		(key) => {
			const root = mountRoot();

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: plainKeyDownOn(document.body, key),
					selection: blockSelection,
					heldFocusLast: () => true,
				}),
			).toBe(true);
		},
	);

	it("HOST9: a focused wrapper around the root does not take Backspace from a block selection", () => {
		const wrapper = document.createElement("div");
		wrapper.tabIndex = 0;
		document.body.appendChild(wrapper);
		const root = mountRoot(wrapper);
		wrapper.focus();

		expect(
			shouldHandleEditorKeyboardEvent({
				root,
				event: plainKeyDownOn(wrapper, "Backspace"),
				selection: blockSelection,
			}),
		).toBe(true);
	});

	it("HOST9: without heldFocusLast, Mod-z on the body reaches the editor", () => {
		const root = mountRoot();

		expect(
			shouldHandleEditorKeyboardEvent({
				root,
				event: keyDownOn(document.body, "z"),
				selection: caret,
			}),
		).toBe(true);
	});

	it("HOST9: a focused wrapper around the root does not take Mod-z from the editor", () => {
		const wrapper = document.createElement("div");
		wrapper.tabIndex = 0;
		document.body.appendChild(wrapper);
		const root = mountRoot(wrapper);
		wrapper.focus();

		expect(
			shouldHandleEditorKeyboardEvent({
				root,
				event: keyDownOn(wrapper, "z"),
				selection: caret,
			}),
		).toBe(true);
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
