// @vitest-environment jsdom

import { createEditor, getEditorSelectionRecord } from "@input/pen-core";
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

	it.each<[string, (fixture: Fixture) => HTMLElement]>([
		[
			"a foreign input",
			({ input }) => {
				input.focus();
				return input;
			},
		],
		[
			"the body after the input blurred (a bare setSelection)",
			({ input }) => {
				input.focus();
				input.blur();
				return document.body;
			},
		],
		[
			"a native textarea nested in the root",
			({ root }) => {
				const textarea = document.createElement("textarea");
				root.append(textarea);
				textarea.focus();
				return textarea;
			},
		],
	])(
		"HOST9: a new text selection while %s holds focus is recorded but not projected",
		(_holder, takeFocus) => {
			const fixture = mount();
			const holder = takeFocus(fixture);
			document.getSelection()?.removeAllRanges();
			fixture.focusRequests.length = 0;

			fixture.editor.selectText(fixture.blockId, 2, 4);

			expect(fixture.editor.selection?.type).toBe("text");
			expect(fixture.focusRequests).toEqual([]);
			expect(domSelectionIsInside(fixture.root)).toBe(false);
			expect(document.activeElement).toBe(holder);
		},
	);

	it("a divergence report (P2) requests no focus either", () => {
		const { root, input, mounted, focusRequests } = mount();
		input.focus();
		document.getSelection()?.removeAllRanges();

		mounted.fieldEditor.projector.requestDivergenceProjection();

		expect(focusRequests).toEqual([]);
		expect(domSelectionIsInside(root)).toBe(false);
		expect(document.activeElement).toBe(input);
	});

	it("HOST9: a keyboard-origin write projects once nothing outside the editor owns focus", () => {
		const { editor, blockId, root, input, focusRequests } = mount();
		input.focus();
		input.blur();

		editor.selectText(blockId, 2, 4, { origin: "keyboard" });

		expect(focusRequests.map((request) => request.action)).toContain(
			"project-selection",
		);
		expect(domSelectionIsInside(root)).toBe(true);
	});

	it("HOST9: the editor's own user edit that maps the caret takes focus back from the body", () => {
		const { editor, blockId, root, input, focusRequests } = mount();
		input.focus();
		input.blur();

		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" }],
			{ origin: "user" },
		);

		expect(getEditorSelectionRecord(editor)?.origin).toBe("mapped");
		expect(focusRequests.map((request) => request.action)).toContain(
			"project-selection",
		);
		expect(domSelectionIsInside(root)).toBe(true);
	});

	it("HOST9: a collaborator's edit does not take focus from a host button", () => {
		const { editor, blockId, root, focusRequests } = mount();
		const button = document.createElement("button");
		document.body.append(button);
		button.focus();
		document.getSelection()?.removeAllRanges();

		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" }],
			{ origin: "collaborator" },
		);

		expect(getEditorSelectionRecord(editor)?.origin).toBe("mapped");
		expect(editor.selection).toMatchObject({
			focus: { blockId, offset: 6 },
		});
		expect(focusRequests).toEqual([]);
		expect(domSelectionIsInside(root)).toBe(false);
		expect(document.activeElement).toBe(button);
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

describe("HOST9: two editors on one page", () => {
	/** Editors A and B, both with an active field; the user is typing in B. */
	function mountTwo() {
		const a = mount();
		const b = mount();
		const surfaceB = b.root.querySelector<HTMLElement>(
			"[data-pen-field-editor-surface]",
		);
		expect(surfaceB).not.toBeNull();
		surfaceB!.focus();
		a.focusRequests.length = 0;
		b.focusRequests.length = 0;
		return { a, b, surfaceB: surfaceB! };
	}

	it("a collaborator edit before A's stale caret does not take focus from B", () => {
		const { a, surfaceB } = mountTwo();

		a.editor.apply(
			[
				{
					type: "splice-text",
					blockId: a.blockId,
					from: 0,
					to: 0,
					insert: "X",
				},
			],
			{ origin: "collaborator" },
		);

		expect(getEditorSelectionRecord(a.editor)?.origin).toBe("mapped");
		expect(a.editor.selection).toMatchObject({
			focus: { blockId: a.blockId, offset: 6 },
		});
		expect(a.focusRequests).toEqual([]);
		expect(document.activeElement).toBe(surfaceB);
	});

	it("a programmatic write in A does not take focus from B", () => {
		const { a, surfaceB } = mountTwo();

		a.editor.selectText(a.blockId, 2, 4);

		expect(a.focusRequests).toEqual([]);
		expect(document.activeElement).toBe(surfaceB);
	});

	it("a rebuild of A's field (P3) does not write while B holds focus", () => {
		const { a, surfaceB } = mountTwo();

		expect(
			a.mounted.fieldEditor.projector.shouldProjectSelectionAfterReconcile(),
		).toBe(false);
		a.mounted.fieldEditor.projectAfterRebuild([a.blockId]);

		expect(a.focusRequests).toEqual([]);
		expect(document.activeElement).toBe(surfaceB);
	});

	it("A still projects its own writes once A owns focus again", () => {
		const { a } = mountTwo();
		a.root.focus();
		a.focusRequests.length = 0;

		a.editor.selectText(a.blockId, 2, 4);

		expect(a.focusRequests.map((request) => request.action)).toContain(
			"project-selection",
		);
		expect(domSelectionIsInside(a.root)).toBe(true);
	});
});

describe("AX3: a divergence report while editor chrome inside the root owns focus", () => {
	function focusHandle(root: HTMLElement): HTMLElement {
		const handle = document.createElement("div");
		handle.tabIndex = 0;
		handle.setAttribute("role", "button");
		root.append(handle);
		handle.focus();
		return handle;
	}

	it("P2 does not take focus from a block handle in the root", () => {
		const { root, mounted, focusRequests } = mount();
		const handle = focusHandle(root);
		document.getSelection()?.removeAllRanges();
		focusRequests.length = 0;

		mounted.fieldEditor.projector.requestDivergenceProjection();

		expect(focusRequests).toEqual([]);
		expect(document.activeElement).toBe(handle);
	});

	it("P2 still projects while the field holds focus", () => {
		const { root, mounted, focusRequests } = mount();
		root.querySelector<HTMLElement>(
			"[data-pen-field-editor-surface]",
		)?.focus();
		document.getSelection()?.removeAllRanges();
		focusRequests.length = 0;

		mounted.fieldEditor.projector.requestDivergenceProjection();

		expect(focusRequests.map((request) => request.action)).toContain(
			"project-selection",
		);
		expect(domSelectionIsInside(root)).toBe(true);
	});
});
