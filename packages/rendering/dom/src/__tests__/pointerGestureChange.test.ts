// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountEditor } from "../host/mountEditor";
import { DATA_ATTRS } from "../utils/dataAttributes";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
});

function mount() {
	const editor = createEditor({
		schema: defaultSchema,
		preset: { resolve: () => ({ extensions: [] }) },
	});
	const root = document.createElement("div");
	const outside = document.createElement("button");
	document.body.append(root, outside);
	const onPointerGestureChange = vi.fn();
	cleanups.push(editor.on("pointerGestureChange", onPointerGestureChange));
	const mounted = mountEditor(editor, root);
	const content = document.createElement("div");
	const chrome = document.createElement("button");
	chrome.setAttribute(DATA_ATTRS.ignorePointerGesture, "");
	root.append(content, chrome);
	cleanups.push(() => {
		mounted.destroy();
		void editor.destroy();
	});
	return { mounted, outside, content, chrome, onPointerGestureChange };
}

function press(target: Element): void {
	target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}

function release(type: "pointerup" | "pointercancel" = "pointerup"): void {
	document.dispatchEvent(new Event(type, { bubbles: true }));
}

describe("R1: pointerGestureChange follows a press from content to release", () => {
	it("R1: fires once when a press in the content opens it and once when it ends", () => {
		const { content, onPointerGestureChange } = mount();

		press(content);
		press(content);
		release();

		expect(onPointerGestureChange.mock.calls).toEqual([[true], [false]]);
	});

	it("R1: a pointercancel ends the gesture like a pointerup", () => {
		const { content, onPointerGestureChange } = mount();

		press(content);
		release("pointercancel");

		expect(onPointerGestureChange.mock.calls).toEqual([[true], [false]]);
	});

	it("R1: a context menu ends the gesture, macOS sends no pointerup after it", () => {
		const { content, onPointerGestureChange } = mount();

		press(content);
		content.dispatchEvent(new Event("contextmenu", { bubbles: true }));

		expect(onPointerGestureChange.mock.calls).toEqual([[true], [false]]);
	});

	it("R2: a press outside the content or on ignored chrome is no gesture", () => {
		const { outside, chrome, onPointerGestureChange } = mount();

		press(outside);
		press(chrome);
		release();

		expect(onPointerGestureChange).not.toHaveBeenCalled();
	});

	it("R1: detaching the root mid-press ends the gesture", () => {
		const { mounted, content, onPointerGestureChange } = mount();

		press(content);
		mounted.destroy();

		expect(onPointerGestureChange.mock.calls).toEqual([[true], [false]]);
	});
});
