// @vitest-environment jsdom

import { createEditor, getEditorSelectionRecord } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";

const fixtures: Array<{
	editor: ReturnType<typeof createEditor>;
	fieldEditor: FieldEditorImpl;
	root: HTMLElement;
}> = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.fieldEditor.destroy();
		fixture.root.remove();
		fixture.editor.destroy();
	}
	document.getSelection()?.removeAllRanges();
});

/** A mounted root whose active field reads "hello world", caret at 0. */
function seed() {
	const editor = createEditor({ schema: defaultSchema });
	const fieldEditor = new FieldEditorImpl(editor);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	document.body.appendChild(root);
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "hello world" },
	]);
	editor.selectText(blockId, 0, 0);
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = "hello world";
	block.appendChild(inline);
	root.appendChild(block);
	fieldEditor.setRootElement(root);
	fieldEditor.activate(blockId);
	fixtures.push({ editor, fieldEditor, root });
	const text = inline.firstChild!;
	/** Moves the native range and delivers its selectionchange now. */
	const nativeRange = (anchor: number, focus: number) => {
		document.getSelection()!.setBaseAndExtent(text, anchor, text, focus);
		document.dispatchEvent(new Event("selectionchange"));
	};
	const contextMenu = () => {
		inline.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
	};
	const textState = () => {
		const state = getEditorSelectionRecord(editor)?.state;
		return state?.type === "text"
			? [state.anchor.offset, state.focus.offset]
			: null;
	};
	return { fieldEditor, nativeRange, contextMenu, textState };
}

describe("R1 context-menu window", () => {
	it("R1: an equivalent selectionchange closes the context-menu window", () => {
		const fixture = seed();
		fixture.nativeRange(0, 0);
		fixture.contextMenu();
		expect(fixture.fieldEditor.getGestureWindows().contextMenu).toBe(true);

		// Step 3 echo: the read changes nothing, but it is the next
		// selectionchange after the menu, so the window closes.
		fixture.nativeRange(0, 0);
		expect(fixture.fieldEditor.getGestureWindows().contextMenu).toBe(false);

		// A later out-of-gesture range change is not accepted (step 4).
		fixture.nativeRange(2, 5);
		expect(fixture.textState()).toEqual([0, 0]);
	});

	it("R1: a non-equivalent selectionchange in the window is accepted and closes it", () => {
		const fixture = seed();
		fixture.nativeRange(0, 0);
		fixture.contextMenu();
		fixture.nativeRange(0, 5);
		expect(fixture.textState()).toEqual([0, 5]);
		expect(fixture.fieldEditor.getGestureWindows().contextMenu).toBe(false);
		fixture.nativeRange(6, 11);
		expect(fixture.textState()).toEqual([0, 5]);
	});
});
