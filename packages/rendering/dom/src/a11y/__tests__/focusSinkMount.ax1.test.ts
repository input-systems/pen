// @vitest-environment jsdom

import { createHeadlessEditor } from "@input/pen-core";
import { afterEach, describe, expect, it } from "vitest";

import { FOCUS_SINK_ATTR } from "../focusSink";
import { FieldEditorImpl } from "../../field-editor/fieldEditorImpl";
import { defaultSchema } from "@input/pen-schema";

const fixtures: Array<{
	editor: ReturnType<typeof createHeadlessEditor>;
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

describe("FieldEditorImpl focus sink mount (AX1)", () => {
	it("AX1: setRootElement mounts a hidden sink on the editor root", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const fieldEditor = new FieldEditorImpl(editor);
		const root = document.createElement("div");
		document.body.appendChild(root);
		fixtures.push({ editor, fieldEditor, root });

		fieldEditor.setRootElement(root);

		const sink = root.querySelector(`[${FOCUS_SINK_ATTR}]`);
		expect(sink).not.toBeNull();
		expect(sink?.getAttribute("aria-hidden")).toBe("true");
		expect((sink as HTMLElement).tabIndex).toBe(-1);
	});

	it("AX1: a block selection reveals the mounted sink", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const fieldEditor = new FieldEditorImpl(editor);
		const root = document.createElement("div");
		document.body.appendChild(root);
		fixtures.push({ editor, fieldEditor, root });
		fieldEditor.setRootElement(root);

		const first = editor.firstBlock();
		expect(first).not.toBeNull();
		editor.selectBlocks([first!.id]);

		const sink = root.querySelector(`[${FOCUS_SINK_ATTR}]`);
		expect(sink?.getAttribute("aria-hidden")).toBeNull();
		expect(sink?.getAttribute("role")).toBe("group");
		expect(sink?.getAttribute("aria-label")).toBe("1 block selected");
		expect(document.activeElement).toBe(sink);
	});

	it("HOST9: a block selection does not steal focus from a foreign input", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const fieldEditor = new FieldEditorImpl(editor);
		const root = document.createElement("div");
		const input = document.createElement("input");
		document.body.append(root, input);
		fixtures.push({ editor, fieldEditor, root });
		fieldEditor.setRootElement(root);
		input.focus();
		expect(document.activeElement).toBe(input);

		const first = editor.firstBlock();
		expect(first).not.toBeNull();
		editor.selectBlocks([first!.id]);

		expect(document.activeElement).toBe(input);
		input.remove();
	});

	it("HOST9: a block selection does not steal focus from a nested textarea", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const fieldEditor = new FieldEditorImpl(editor);
		const root = document.createElement("div");
		const textarea = document.createElement("textarea");
		document.body.append(root);
		root.append(textarea);
		fixtures.push({ editor, fieldEditor, root });
		fieldEditor.setRootElement(root);
		textarea.focus();
		expect(document.activeElement).toBe(textarea);

		const first = editor.firstBlock();
		expect(first).not.toBeNull();
		editor.selectBlocks([first!.id]);

		expect(document.activeElement).toBe(textarea);
	});

	it("AX1: empty-document text caret leaves the mounted sink hidden", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const fieldEditor = new FieldEditorImpl(editor);
		const root = document.createElement("div");
		document.body.appendChild(root);
		fixtures.push({ editor, fieldEditor, root });
		fieldEditor.setRootElement(root);

		const first = editor.firstBlock();
		expect(first).not.toBeNull();
		editor.selectText(first!.id, 0, 0);

		const sink = root.querySelector(`[${FOCUS_SINK_ATTR}]`);
		expect(sink?.getAttribute("aria-hidden")).toBe("true");
		expect((sink as HTMLElement).tabIndex).toBe(-1);
		expect(sink?.hasAttribute("role")).toBe(false);
	});
});
