// @vitest-environment jsdom

import type { ReadonlySelectionState } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../dataAttributes";
import { shouldHandleEditorKeyboardEvent } from "../textEntryTarget";

const caret: ReadonlySelectionState = {
	type: "text",
	anchor: { blockId: "block-1", offset: 2 },
	focus: { blockId: "block-1", offset: 2 },
};

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
		"HOST9: Mod-%s still reaches the editor once focus has fallen to the body",
		(key) => {
			const root = mountRoot();

			expect(
				shouldHandleEditorKeyboardEvent({
					root,
					event: keyDownOn(document.body, key),
					selection: caret,
				}),
			).toBe(true);
		},
	);

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
