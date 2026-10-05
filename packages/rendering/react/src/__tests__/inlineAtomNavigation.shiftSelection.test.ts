import { describe, expect, it } from "vitest";
import {
	handleFieldEditorKeyDown,
} from "@input/pen-dom/field-editor/keyHandling";
import type { FieldEditorTextLike } from "@input/pen-dom/field-editor/crdt";
import {
	createFieldEditorMock,
	createKeyEvent,
	createPresetEditor,
	getYText,
} from "./utils/keyHandlingTestHelpers";

describe("@input/pen-react field editor inline atom navigation: shift selection", () => {
	const createAtomText = (): FieldEditorTextLike => ({
		length: 1,
		toString: () => "",
		toDelta: () => [
			{ insert: { type: "contact", props: { label: "Ada" } } },
		],
		insert: () => {},
		delete: () => {},
		observe: () => {},
		unobserve: () => {},
	});

	it("selects the atom to the left when the atom-only text serializes empty", () => {
		const editor = createPresetEditor({
			preset: {
				shortcuts: false,
			},
		});
		const blockId = editor.firstBlock()!.id;
		// An atom-only block in the model: the keymap decides from the
		// authority, not from the field's text (W35.R18).
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: { nodeType: "mention", props: { id: "user-ada", label: "Ada" } },
			},
		]);
		const fieldEditor = createFieldEditorMock(blockId);

		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("ArrowLeft"),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, blockId),
			range: { start: 1, end: 1 },
		});

		expect(handled).toBe(true);
		expect(fieldEditor.activations).toEqual([
			{ blockId, anchorOffset: 0, focusOffset: 1 },
		]);

		editor.destroy();
	});

	it("preserves selection direction when shift-selecting an atom to the left", () => {
		const editor = createPresetEditor({
			preset: {
				shortcuts: false,
			},
		});
		const blockId = editor.firstBlock()!.id;
		// An atom-only block in the model: the keymap decides from the
		// authority, not from the field's text (W35.R18).
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: { nodeType: "mention", props: { id: "user-ada", label: "Ada" } },
			},
		]);
		const fieldEditor = createFieldEditorMock(blockId);

		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("ArrowLeft", { shiftKey: true }),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, blockId),
			range: { start: 1, end: 1 },
		});

		expect(handled).toBe(true);
		expect(fieldEditor.activations).toEqual([
			{ blockId, anchorOffset: 1, focusOffset: 0 },
		]);

		editor.destroy();
	});

	it("shrinks a shift-selected atom when extending back to the anchor", () => {
		const editor = createPresetEditor({
			preset: {
				shortcuts: false,
			},
		});
		const blockId = editor.firstBlock()!.id;
		// the mock ytext below claims a one-atom block, so the real document has
		// to hold one too: A1 clamps to logical length, and an empty paragraph
		// has no offset 1 to anchor at.
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: {
						nodeType: "mention",
						props: { id: "user-1", label: "Ada" },
					},
				},
			],
			{ origin: "user" },
		);
		editor.selectText(blockId, 1, 0);
		const fieldEditor = createFieldEditorMock(blockId);

		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("ArrowRight", { shiftKey: true }),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: createAtomText(),
			range: { start: 0, end: 1 },
		});

		expect(handled).toBe(true);
		expect(fieldEditor.activations).toEqual([
			{ blockId, anchorOffset: 1, focusOffset: 1 },
		]);

		editor.destroy();
	});
});
