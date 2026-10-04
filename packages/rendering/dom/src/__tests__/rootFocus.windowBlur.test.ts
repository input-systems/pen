// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountEditor } from "../host/mountEditor";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

// O5: the overlay caret needs a focused field. Switching windows leaves
// `document.activeElement` inside the root, so the root must also follow the
// window's own blur and focus.
describe("editor root focus follows the window (O5)", () => {
	it("an inactive window unfocuses the field, and coming back refocuses it", () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		const inner = document.createElement("button");
		root.append(inner);
		inner.focus();
		expect(mounted.fieldEditor.isFocused).toBe(true);

		// Alt-tab: the window blurs (and the focused element with it) while
		// activeElement stays inside the root.
		const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
		inner.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
		window.dispatchEvent(new FocusEvent("blur"));
		expect(document.activeElement).toBe(inner);
		expect(mounted.fieldEditor.isFocused).toBe(false);
		expect(root.hasAttribute("data-focused")).toBe(false);

		hasFocus.mockReturnValue(true);
		window.dispatchEvent(new FocusEvent("focus"));
		expect(mounted.fieldEditor.isFocused).toBe(true);

		mounted.destroy();
		editor.destroy();
	});

	it("a window blur with focus outside the root leaves the field unfocused", () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});
		const root = document.createElement("div");
		const outside = document.createElement("button");
		document.body.append(root, outside);
		const mounted = mountEditor(editor, root);
		outside.focus();
		window.dispatchEvent(new FocusEvent("focus"));
		expect(mounted.fieldEditor.isFocused).toBe(false);
		mounted.destroy();
		editor.destroy();
	});
});
