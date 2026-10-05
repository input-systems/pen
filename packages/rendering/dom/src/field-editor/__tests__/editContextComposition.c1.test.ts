// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupMountedFields,
	type FakeEditContext,
	mountField,
} from "./fieldEditorFixtures.testHelpers";

afterEach(cleanupMountedFields);

function mountEditContextField(options: { undo?: boolean } = {}) {
	const field = mountField("Hello world", { editContext: true, ...options });
	if (options.undo) field.editor.undoManager.stopCapturing();
	return field;
}

function endComposition(inline: HTMLElement, data: string): void {
	inline.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data }));
}

describe("C1 EditContext composition apply sequencing", () => {
	it.each([
		["", "Hello world", "a cancelled compositionend does not commit"],
		["nihao", "Hello worldnihao", "a committed compositionend applies the held text"],
	])(
		"C1: textformatupdate rewinds the preceding textupdate; compositionend with data %j settles the held apply",
		(data, expected, message) => {
			const { inline, editContext, text } = mountEditContextField();

			editContext.textUpdate(11, 11, "nihao");
			editContext.textFormatUpdate();
			expect(text(), "C1: textformatupdate rewound the composing apply").toBe("Hello world");

			endComposition(inline, data);
			expect(text(), `C1: ${message}`).toBe(expected);
		},
	);

	it("C1: Escape leaves the discarded insert off the undo stack", () => {
		const { editor, inline, blockId, editContext, text } = mountEditContextField({ undo: true });
		editor.apply(
			[{ type: "splice-text", blockId, from: 11, to: 11, insert: "!" }],
			{ origin: "user" },
		);
		editor.selectText(blockId, 12, 12);
		editor.undoManager.stopCapturing();

		editContext.textUpdate(12, 12, "nihao");
		expect(text()).toBe("Hello world!nihao");
		editContext.textFormatUpdate();
		inline.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
		);

		expect(text()).toBe("Hello world!");
		expect(editor.undoManager.undo()).toBe(true);
		expect(
			text(),
			"C1: first undo after Escape reverts the last real user edit, not a discarded IME insert",
		).toBe("Hello world");
		expect(editor.undoManager.undo()).toBe(true);
		expect(text()).toBe("");
		expect(editor.undoManager.canUndo()).toBe(false);
	});

	it.each([
		["an ordinary textupdate applies immediately and", "!"],
		["a speculative textupdate", "nihao"],
	])("C1: %s is a tracked origin-user undo item", (_name, insert) => {
		const { editor, editContext, text } = mountEditContextField({ undo: true });

		editContext.textUpdate(11, 11, insert);

		expect(text()).toBe(`Hello world${insert}`);
		expect(editor.undoManager.undo()).toBe(true);
		expect(text()).toBe("Hello world");
	});
});

/** Chromium updates the buffer, then fires `textupdate` over it. */
function imeUpdate(editContext: FakeEditContext, start: number, end: number, text: string): void {
	editContext.updateText(start, end, text);
	editContext.updateSelection(start + text.length, start + text.length);
	editContext.textUpdate(start, end, text);
	editContext.textFormatUpdate();
}

function emitComposition(
	editContext: FakeEditContext,
	type: "compositionstart" | "compositionend",
	data = "",
): void {
	editContext.emit(type, new CompositionEvent(type, { data }));
}

function caretOffset(field: ReturnType<typeof mountField>): number | null {
	const selection = field.editor.selection;
	return selection?.type === "text" ? selection.focus.offset : null;
}

/** Opens a composition over `[anchor, focus)` of "Hello world". */
function composeAt(anchor: number, focus = anchor, options: { undo?: boolean } = {}) {
	const field = mountEditContextField(options);
	field.editor.selectText(field.blockId, anchor, focus, { origin: "keyboard" });
	emitComposition(field.editContext, "compositionstart");
	return field;
}

describe("C4 EditContext composition lifecycle", () => {
	it("C4: a multi-update composition holds its text and commits once at compositionend", () => {
		const field = composeAt(5, 5, { undo: true });
		const { editor, inline, editContext, text } = field;
		let previous = "";
		for (const typed of ["n", "ni", "nih", "niha", "nihao"]) {
			imeUpdate(editContext, 5, 5 + previous.length, typed);
			previous = typed;
			expect(text()).toBe("Hello world");
			expect(inline.textContent).toBe(`Hello${typed} world`);
		}
		imeUpdate(editContext, 5, 10, "你好");
		emitComposition(editContext, "compositionend", "你好");

		expect(text()).toBe("Hello你好 world");
		expect(editContext.text).toBe("Hello你好 world");
		expect(inline.textContent).toBe("Hello你好 world");
		expect(caretOffset(field)).toBe(7);
		expect(editor.undoManager.undo()).toBe(true);
		expect(text(), "C4: the composition is one undo step").toBe("Hello world");
	});

	it.each([
		{
			name: "a composition over a selection replaces exactly the selection",
			selection: [6, 11],
			updates: [[6, 11, "せ"], [6, 7, "せかい"], [6, 9, "世界"]],
			data: "世界",
			expected: "Hello 世界",
		},
		{
			// A reconversion takes in the "o" before the composed text and the
			// space after it.
			name: "an update that reaches past the composed text grows the replaced range",
			selection: [5, 5],
			updates: [[5, 5, "ka"], [4, 8, "化"]],
			data: "化",
			expected: "Hell化world",
		},
		{
			name: "an empty compositionend drops the composition and restores the field",
			selection: [5, 5],
			updates: [[5, 5, "k"], [5, 6, "ka"], [5, 7, ""]],
			data: "",
			expected: "Hello world",
		},
	] as const)("C4: $name", ({ selection, updates, data, expected }) => {
		const { inline, editContext, text } = composeAt(selection[0], selection[1]);
		for (const [start, end, typed] of updates) imeUpdate(editContext, start, end, typed);
		expect(text()).toBe("Hello world");
		emitComposition(editContext, "compositionend", data);

		expect(text()).toBe(expected);
		expect(editContext.text).toBe(expected);
		expect(inline.textContent).toBe(expected);
	});

	it("C4: deactivating mid-composition commits the composed text", () => {
		const { fieldEditor, editContext, text } = composeAt(11);
		imeUpdate(editContext, 11, 11, "k");
		fieldEditor.deactivate();

		expect(text()).toBe("Hello worldk");
		expect(fieldEditor.isComposing).toBe(false);
	});

	it("C2: collaborator edits mid-composition are deferred, leave the field DOM untouched, and the one commit rebases over them", () => {
		const field = composeAt(11);
		const { editor, inline, blockId, editContext, text } = field;
		let previous = "";
		for (const typed of ["n", "ni", "nih", "niha"]) {
			imeUpdate(editContext, 11, 11 + previous.length, typed);
			previous = typed;
			editor.apply(
				[{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" }],
				{ origin: "collaborator" },
			);
			expect(inline.textContent).toBe(`Hello world${typed}`);
		}
		imeUpdate(editContext, 11, 15, "你");
		emitComposition(editContext, "compositionend", "你");

		expect(text()).toBe("XXXXHello world你");
		expect(editContext.text).toBe("XXXXHello world你");
		expect(inline.textContent).toBe("XXXXHello world你");
		expect(caretOffset(field)).toBe(16);
	});

	it("C4: a typed textupdate is not replayed into a buffer that already holds it", () => {
		const { editor, blockId, editContext, text } = mountEditContextField();
		editor.selectText(blockId, 11, 11, { origin: "keyboard" });
		for (const [index, char] of ["a", "b", "c"].entries()) {
			editContext.updateText(11 + index, 11 + index, char);
			editContext.textUpdate(11 + index, 11 + index, char);
		}

		expect(text()).toBe("Hello worldabc");
		expect(editContext.text).toBe("Hello worldabc");
	});
});
