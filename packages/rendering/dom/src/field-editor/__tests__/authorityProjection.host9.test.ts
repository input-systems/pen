// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@input/pen-types";
import type { FieldEditorFocusRequest } from "../controller";
import { mountEditor, type MountedEditor } from "../../host/mountEditor";

type Fixture = {
	editor: Editor;
	blockId: string;
	root: HTMLElement;
	input: HTMLInputElement;
	mounted: MountedEditor;
	focusRequests: FieldEditorFocusRequest[];
};

const fixtures: Fixture[] = [];

/** A mounted editor with an active field next to a foreign `<input>`, every focus request recorded. */
function mount(): Fixture {
	const editor = createEditor({ schema: defaultSchema });
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello world" },
	]);
	const root = document.createElement("div");
	const input = document.createElement("input");
	document.body.append(root, input);
	const focusRequests: FieldEditorFocusRequest[] = [];
	const mounted = mountEditor(editor, root, {
		focusPolicy: {
			decide: (request) => {
				focusRequests.push(request);
				return { type: "allow" };
			},
		},
	});
	mounted.fieldEditor.activateTextSelection(blockId, 0, 5);
	focusRequests.length = 0;
	const fixture = { editor, blockId, root, input, mounted, focusRequests };
	fixtures.push(fixture);
	return fixture;
}

function domSelectionIsInside(root: HTMLElement): boolean {
	const selection = document.getSelection();
	return (
		selection !== null &&
		selection.rangeCount > 0 &&
		root.contains(selection.anchorNode)
	);
}

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.mounted.destroy();
		fixture.editor.destroy();
	}
	document.body.replaceChildren();
});

describe("HOST9: authority writes while a native control outside the editor owns focus", () => {
	it("clearing the selection requests no focus", () => {
		const { editor, input, focusRequests } = mount();
		input.focus();

		editor.setSelection(null);

		expect(focusRequests).toEqual([]);
		expect(document.activeElement).toBe(input);
	});

	it("a new text selection is recorded but not projected", () => {
		const { editor, blockId, root, input, focusRequests } = mount();
		input.focus();
		document.getSelection()?.removeAllRanges();

		editor.selectText(blockId, 2, 4);

		expect(editor.selection?.type).toBe("text");
		expect(focusRequests).toEqual([]);
		expect(domSelectionIsInside(root)).toBe(false);
		expect(document.activeElement).toBe(input);
	});

	it("a divergence report (P2) requests no focus either", () => {
		const { root, input, mounted, focusRequests } = mount();
		input.focus();
		document.getSelection()?.removeAllRanges();

		mounted.fieldEditor.requestDivergenceProjection();

		expect(focusRequests).toEqual([]);
		expect(domSelectionIsInside(root)).toBe(false);
		expect(document.activeElement).toBe(input);
	});

	it("the same write projects once nothing outside the editor owns focus", () => {
		const { editor, blockId, root, input, focusRequests } = mount();
		input.focus();
		input.blur();

		editor.selectText(blockId, 2, 4);

		expect(focusRequests.map((request) => request.action)).toContain(
			"project-selection",
		);
		expect(domSelectionIsInside(root)).toBe(true);
	});

	it("a gesture activation still projects, since it runs before the browser moves focus", () => {
		const { blockId, root, input, mounted, focusRequests } = mount();
		input.focus();

		mounted.fieldEditor.activateTextSelection(blockId, 2, 2);

		expect(focusRequests.map((request) => request.action)).toContain(
			"project-selection",
		);
		expect(domSelectionIsInside(root)).toBe(true);
	});

	it("a native textarea nested in the editor root keeps focus", () => {
		const { editor, blockId, root, focusRequests } = mount();
		const textarea = document.createElement("textarea");
		root.append(textarea);
		textarea.focus();
		document.getSelection()?.removeAllRanges();
		focusRequests.length = 0;

		editor.selectText(blockId, 2, 4);

		expect(editor.selection?.type).toBe("text");
		expect(focusRequests).toEqual([]);
		expect(document.activeElement).toBe(textarea);
	});

	it("the field editor itself is not treated as a foreign native control", () => {
		const { editor, blockId, root, focusRequests } = mount();
		const surface = root.querySelector("[data-pen-field-editor-surface]");
		expect(surface).toBeInstanceOf(HTMLElement);
		(surface as HTMLElement).focus();
		focusRequests.length = 0;

		editor.selectText(blockId, 2, 4);

		expect(focusRequests.map((request) => request.action)).toContain(
			"project-selection",
		);
	});
});
