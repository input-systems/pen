// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
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
});

function mount() {
	delete (globalThis as { EditContext?: unknown }).EditContext;
	const editor = createEditor({ schema: defaultSchema });
	const fieldEditor = new FieldEditorImpl(editor);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	document.body.appendChild(root);
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
	]);
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = "Hello";
	block.appendChild(inline);
	root.appendChild(block);
	fieldEditor.setRootElement(root);
	fieldEditor.activate(blockId);
	fixtures.push({ editor, fieldEditor, root });
	return { fieldEditor, inline };
}

describe("R1 drag window close inputs", () => {
	it("R1: a cancelled dragstart closes the drag window in the same handler", () => {
		const { fieldEditor, inline } = mount();
		const event = new Event("dragstart", { bubbles: true, cancelable: true });
		inline.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		expect(fieldEditor.getGestureWindows().drag).toBe(false);
	});

	it("R1 R2: a document dragend closes a drag window opened by the field", () => {
		const { fieldEditor } = mount();
		fieldEditor.notifyGestureEvent("dragstart");
		expect(fieldEditor.getGestureWindows().drag).toBe(true);

		document.dispatchEvent(new Event("dragend"));
		expect(fieldEditor.getGestureWindows().drag).toBe(false);

		fieldEditor.deactivate();
		expect(() => document.dispatchEvent(new Event("dragend"))).not.toThrow();
	});
});
