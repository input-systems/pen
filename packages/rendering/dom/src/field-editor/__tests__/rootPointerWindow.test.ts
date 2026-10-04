// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { FOCUS_SINK_ATTR } from "../../a11y/focusSink";
import { DATA_ATTRS, OVERLAY_LAYER_ATTR } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";

const fixtures: Array<{
	editor: ReturnType<typeof createEditor>;
	fieldEditor: FieldEditorImpl;
	root: HTMLElement;
}> = [];

afterEach(() => {
	while (fixtures.length > 0) {
		const fixture = fixtures.pop();
		if (!fixture) {
			break;
		}
		fixture.fieldEditor.destroy();
		fixture.root.remove();
		fixture.editor.destroy();
	}
});

function seedMountedEditor() {
	const editor = createEditor({ schema: defaultSchema });
	const fieldEditor = new FieldEditorImpl(editor);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	document.body.appendChild(root);
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "hello" },
	]);
	editor.selectText(blockId, 0, 0);
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = "hello";
	block.appendChild(inline);
	root.appendChild(block);
	fieldEditor.setRootElement(root);
	fieldEditor.activate(blockId);
	fixtures.push({ editor, fieldEditor, root });
	return { editor, fieldEditor, root, blockId, inline };
}

describe("FieldEditorImpl root pointer window", () => {
	it("opens the pointer window on in-content pointerdown without a host gesture notification", () => {
		const { fieldEditor, inline } = seedMountedEditor();
		expect(fieldEditor.reader.isAdmissibleRead()).toBe(false);
		inline.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
		);
		expect(fieldEditor.reader.isAdmissibleRead()).toBe(true);
	});

	it("opens the window from root pointerdown when no field is attached", () => {
		const { fieldEditor, inline } = seedMountedEditor();
		fieldEditor.deactivate();
		expect(fieldEditor.getSnapshot().isEditing).toBe(false);
		expect(fieldEditor.reader.isAdmissibleRead()).toBe(false);
		inline.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
		);
		expect(fieldEditor.reader.isAdmissibleRead()).toBe(true);
	});

	it("accepts a DOM read after root pointerdown without a host gesture notification", () => {
		const { editor, fieldEditor, blockId, inline } = seedMountedEditor();
		fieldEditor.deactivate();
		editor.selectText(blockId, 0, 0);
		inline.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
		);
		const decision = fieldEditor.readDomSelection({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});
		expect(decision).toBe("accept");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});
	});

	it("does not open the window for overlay or ignored targets", () => {
		const { fieldEditor, root } = seedMountedEditor();
		const overlay = document.createElement("div");
		overlay.setAttribute(OVERLAY_LAYER_ATTR, "");
		root.appendChild(overlay);
		overlay.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
		);
		expect(fieldEditor.reader.isAdmissibleRead()).toBe(false);

		const ignored = document.createElement("div");
		ignored.setAttribute(DATA_ATTRS.ignorePointerGesture, "");
		root.appendChild(ignored);
		ignored.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
		);
		expect(fieldEditor.reader.isAdmissibleRead()).toBe(false);

		const sink = document.createElement("div");
		sink.setAttribute(FOCUS_SINK_ATTR, "");
		root.appendChild(sink);
		sink.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
		);
		expect(fieldEditor.reader.isAdmissibleRead()).toBe(false);
	});
});
