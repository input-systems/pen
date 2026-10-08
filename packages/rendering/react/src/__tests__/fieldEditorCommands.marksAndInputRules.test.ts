import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import {
	FIELD_EDITOR_SLOT_KEY,
	INPUT_RULES_ENGINE_SLOT_KEY,
} from "@input/pen-types";
import {
	applyListInputRule,
	getLogicalInlineLength,
	normalizeInlineOffset,
	toggleInlineMark,
} from "@input/pen-dom/field-editor/commands";
import { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import {
	editorOpts,
	getYText,
	visibleText,
} from "./utils/fieldEditorCommandsTestHelpers";
import { fieldEditorInternals } from "./utils/fieldEditorInternals";

describe("@input/pen-react field-editor commands: inline marks and input rules", () => {
	it("toggles an inline mark across a single-block text selection", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 0, 5);

		expect(toggleInlineMark(editor, "bold")).toBe(true);
		expect(editor.getBlock(blockId)!.textDeltas()).toEqual([
			{
				insert: "Hello",
				attributes: { bold: true },
			},
		]);

		editor.destroy();
	});

	it("toggles an inline mark across a multi-block selection", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "splice-text",
				blockId: firstBlockId,
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: secondBlockId,
				from: 0,
				to: 0,
				insert: "World",
			},
		]);

		editor.selectTextRange(
			{ blockId: firstBlockId, offset: 1 },
			{ blockId: secondBlockId, offset: 2 },
		);

		expect(toggleInlineMark(editor, "italic")).toBe(true);
		expect(editor.getBlock(firstBlockId)!.textDeltas()).toEqual([
			{ insert: "H" },
			{
				insert: "ello",
				attributes: { italic: true },
			},
		]);
		expect(editor.getBlock(secondBlockId)!.textDeltas()).toEqual([
			{
				insert: "Wo",
				attributes: { italic: true },
			},
			{ insert: "rld" },
		]);

		editor.destroy();
	});

	it("uses pending marks for collapsed rich-text selections", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = new FieldEditorImpl(editor);
		const ytext = getYText(editor, blockId);

		editor.internals.assignSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
		fieldEditor.activate(blockId);
		fieldEditor.setTextSelection(blockId, 0, 0);

		expect(toggleInlineMark(editor, "bold")).toBe(true);
		expect(fieldEditor.getPendingMarks()).toEqual({ bold: true });
		expect(
			fieldEditorInternals(fieldEditor).pendingMarks.resolveInsertMarks(
				ytext,
				0,
			),
		).toEqual({
			bold: true,
		});

		expect(toggleInlineMark(editor, "bold")).toBe(true);
		expect(fieldEditor.getPendingMarks()).toEqual({});
		expect(
			fieldEditorInternals(fieldEditor).pendingMarks.resolveInsertMarks(
				ytext,
				0,
			),
		).toBeUndefined();

		fieldEditor.destroy();
		editor.destroy();
	});

	it("returns explicit null marks when pending marks disable boundary formatting", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = new FieldEditorImpl(editor);
		const ytext = getYText(editor, blockId);

		editor.internals.assignSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hello",
				marks: { bold: true, italic: true },
			},
		]);
		fieldEditor.activate(blockId);
		fieldEditor.setTextSelection(blockId, 5, 5);

		expect(toggleInlineMark(editor, "bold")).toBe(true);
		expect(fieldEditor.getPendingMarks()).toEqual({ bold: null });
		expect(
			fieldEditorInternals(fieldEditor).pendingMarks.resolveInsertMarks(
				ytext,
				5,
			),
		).toEqual({
			bold: null,
			italic: true,
		});

		fieldEditor.destroy();
		editor.destroy();
	});

	it("opens the pointer window on a pointerdown gesture without muting reads", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = new FieldEditorImpl(editor);

		fieldEditor.activate(blockId);
		fieldEditorInternals(fieldEditor).reader.notifyGesture("pointerdown");
		expect(
			fieldEditorInternals(fieldEditor).reader.isAdmissibleRead(),
		).toBe(true);

		fieldEditor.deactivate();

		fieldEditor.destroy();
		expect(fieldEditor.getSnapshot().mode).toBe("inactive");

		editor.destroy();
	});

	it("does not toggle inline marks inside code blocks", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "set-props", blockId, props: { type: "codeBlock" } },
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "code" },
		]);
		editor.selectText(blockId, 0, 4);

		expect(toggleInlineMark(editor, "bold")).toBe(false);
		expect(editor.getBlock(blockId)!.textDeltas()).toEqual([
			{ insert: "code" },
		]);

		editor.destroy();
	});

	it("converts '- ' into a bullet list item only for empty paragraphs", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 0, end: 0 },
			text: "- ",
		});

		expect(target).toEqual({ blockId, anchorOffset: 0, focusOffset: 0 });
		expect(editor.getBlock(blockId)?.type).toBe("bulletListItem");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("");

		editor.destroy();
	});

	it("converts '[ ] ' into a check list item", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 0, end: 0 },
			text: "[ ] ",
		});

		expect(target).toEqual({ blockId, anchorOffset: 0, focusOffset: 0 });
		expect(editor.getBlock(blockId)?.type).toBe("checkListItem");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("");

		editor.destroy();
	});

	it("uses the headless input-rules engine when present", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;
		let receivedEditor: unknown = null;
		let receivedOffset: number | undefined;

		editor.internals.assignSlot(INPUT_RULES_ENGINE_SLOT_KEY, {
			tryMatch(
				nextEditor: typeof editor,
				nextBlockId: string,
				insertedText: string,
				options?: { offset?: number },
			) {
				receivedEditor = nextEditor;
				receivedOffset = options?.offset;
				if (insertedText !== "# ") return null;
				return [
					{
						type: "splice-text" as const,
						blockId: nextBlockId,
						from: 0,
						to: 0 + 2,
						insert: "",
					},
					{
						type: "set-props" as const,
						blockId: nextBlockId,
						props: { type: "heading", level: 1 },
					},
				];
			},
		});

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 0, end: 0 },
			text: "# ",
		});

		expect(receivedEditor).toBe(editor);
		expect(receivedOffset).toBe(0);
		expect(target).toEqual({ blockId, anchorOffset: 0, focusOffset: 0 });
		expect(editor.getBlock(blockId)?.type).toBe("heading");
		expect(editor.getBlock(blockId)?.props.level).toBe(1);

		editor.destroy();
	});

	it("preserves text after a leading input-rule marker", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "hello" },
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "*" },
		]);
		editor.internals.assignSlot(INPUT_RULES_ENGINE_SLOT_KEY, {
			tryMatch(
				_nextEditor: typeof editor,
				nextBlockId: string,
				insertedText: string,
				options?: { offset?: number },
			) {
				if (insertedText !== " " || options?.offset !== 1) return null;
				return [
					{
						type: "splice-text" as const,
						blockId: nextBlockId,
						from: 0,
						to: 2,
						insert: "",
					},
					{
						type: "set-props" as const,
						blockId: nextBlockId,
						props: { type: "bulletListItem" },
					},
				];
			},
		});

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 1, end: 1 },
			text: " ",
		});

		expect(target).toEqual({ blockId, anchorOffset: 0, focusOffset: 0 });
		expect(editor.getBlock(blockId)?.type).toBe("bulletListItem");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"hello",
		);

		editor.destroy();
	});

	it("does not convert non-paragraph blocks with list triggers", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "set-props", blockId, props: { type: "heading" } },
		]);

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 0, end: 0 },
			text: "- ",
		});

		expect(target).toBeNull();
		expect(editor.getBlock(blockId)?.type).toBe("heading");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("");

		editor.destroy();
	});

	it("does not convert paragraphs that already contain text", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hi" },
		]);

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 2, end: 2 },
			text: " ",
		});

		expect(target).toBeNull();
		expect(editor.getBlock(blockId)?.type).toBe("paragraph");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("Hi");

		editor.destroy();
	});

	it("treats placeholder-only blocks as logically empty", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;
		const ytext = getYText(editor, blockId);

		expect(getLogicalInlineLength(ytext)).toBe(0);
		expect(normalizeInlineOffset(ytext, 1)).toBe(0);

		editor.destroy();
	});
});
