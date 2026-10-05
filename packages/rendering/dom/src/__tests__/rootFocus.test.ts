// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountEditor } from "../host/mountEditor";
import { DATA_ATTRS } from "../utils/dataAttributes";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

/** A mounted editor with no default extensions; `outside` is a focusable sibling of the root. */
function mount() {
	const editor = createEditor({ schema: defaultSchema, preset: { resolve: () => ({ extensions: [] }) } });
	const root = document.createElement("div");
	const outside = document.createElement("button");
	document.body.append(root, outside);
	const mounted = mountEditor(editor, root);
	cleanups.push(() => {
		mounted.destroy();
		editor.destroy();
	});
	return { editor, root, outside, fieldEditor: mounted.fieldEditor };
}

// The multi-block range case (Tab into a range projects it into the expanded
// host) needs real native selection: conformance
// suites/selection/s2-states.spec.ts "S2: Tab into the root with a three-block range …".
describe("focus entering the root projects the record (S2)", () => {
	it("S2: Tab into a single-block caret focuses that block's field", () => {
		const { editor, root } = mount();
		editor.apply([
			{ type: "insert-block", blockId: "middle", blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: "middle", from: 0, to: 0, insert: "Two" },
		]);
		editor.selectText("middle", 1, 1);

		root.focus();

		expect(document.activeElement).not.toBe(root);
		expect(document.activeElement?.closest(`[${DATA_ATTRS.blockId}]`)?.getAttribute(DATA_ATTRS.blockId)).toBe(
			"middle",
		);
	});
});

// O5: the overlay caret needs a focused field. Switching windows leaves
// `document.activeElement` inside the root, so the root must also follow the
// window's own blur and focus.
describe("editor root focus follows the window (O5)", () => {
	it("an inactive window unfocuses the field, and coming back refocuses it", () => {
		const { root, fieldEditor } = mount();
		const inner = document.createElement("button");
		root.append(inner);
		inner.focus();
		expect(fieldEditor.isFocused).toBe(true);

		// Alt-tab: the window blurs (and the focused element with it) while
		// activeElement stays inside the root.
		const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
		inner.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
		window.dispatchEvent(new FocusEvent("blur"));
		expect(document.activeElement).toBe(inner);
		expect(fieldEditor.isFocused).toBe(false);
		expect(root.hasAttribute("data-focused")).toBe(false);

		hasFocus.mockReturnValue(true);
		window.dispatchEvent(new FocusEvent("focus"));
		expect(fieldEditor.isFocused).toBe(true);
	});

	it("a window blur with focus outside the root leaves the field unfocused", () => {
		const { outside, fieldEditor } = mount();
		outside.focus();
		window.dispatchEvent(new FocusEvent("focus"));
		expect(fieldEditor.isFocused).toBe(false);
	});
});
