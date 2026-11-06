// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountEditor } from "../host/mountEditor";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
});

/** A mounted editor whose root holds two focusable buttons, beside one outside it. */
function mount() {
	const editor = createEditor({
		schema: defaultSchema,
		preset: { resolve: () => ({ extensions: [] }) },
	});
	const root = document.createElement("div");
	const outside = document.createElement("button");
	document.body.append(root, outside);
	const onFocusChange = vi.fn();
	cleanups.push(editor.on("focusChange", onFocusChange));
	const mounted = mountEditor(editor, root);
	const first = document.createElement("button");
	const second = document.createElement("button");
	root.append(first, second);
	cleanups.push(() => {
		mounted.destroy();
		void editor.destroy();
	});
	return { mounted, outside, first, second, onFocusChange };
}

describe("COL7: focusChange follows focus inside the root", () => {
	it("COL7: reports an unfocused root once on mount", () => {
		const { onFocusChange } = mount();

		expect(onFocusChange.mock.calls).toEqual([[false]]);
	});

	it("COL7: fires once per entry and exit, not for moves inside the root", () => {
		const { mounted, outside, first, second, onFocusChange } = mount();
		onFocusChange.mockClear();

		first.focus();
		second.focus();
		expect(mounted.fieldEditor.hasFocusWithin).toBe(true);
		outside.focus();

		expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
		expect(mounted.fieldEditor.hasFocusWithin).toBe(false);
	});

	it("COL7: a window switch is no change, the focused element stays", () => {
		const { first, onFocusChange } = mount();
		first.focus();
		onFocusChange.mockClear();

		first.dispatchEvent(
			new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
		);
		window.dispatchEvent(new FocusEvent("blur"));

		expect(document.activeElement).toBe(first);
		expect(onFocusChange).not.toHaveBeenCalled();
	});

	it("COL7: a focused root reports a blur when it unmounts", () => {
		const { mounted, first, onFocusChange } = mount();
		first.focus();
		onFocusChange.mockClear();

		mounted.destroy();

		expect(onFocusChange.mock.calls).toEqual([[false]]);
	});
});
