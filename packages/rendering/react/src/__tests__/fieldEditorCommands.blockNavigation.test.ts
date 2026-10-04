import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { moveCaretAcrossBlocks } from "@input/pen-dom/field-editor/commands";
import { editorOpts, getYText } from "./utils/fieldEditorCommandsTestHelpers";

describe("@input/pen-react field-editor commands: block navigation", () => {
	it("moves to the previous block at the logical start", () => {
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
		]);

		const secondYText = getYText(editor, secondBlockId);
		const target = moveCaretAcrossBlocks(editor, {
			blockId: secondBlockId,
			ytext: secondYText,
			range: { start: 1, end: 1 },
			direction: "previous",
		});

		expect(target).toEqual({
			blockId: firstBlockId,
			anchorOffset: 5,
			focusOffset: 5,
		});

		editor.destroy();
	});

	it("moves to the next block at the logical end", () => {
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
		]);

		const firstYText = getYText(editor, firstBlockId);
		const target = moveCaretAcrossBlocks(editor, {
			blockId: firstBlockId,
			ytext: firstYText,
			range: { start: 5, end: 5 },
			direction: "next",
		});

		expect(target).toEqual({
			blockId: secondBlockId,
			anchorOffset: 0,
			focusOffset: 0,
		});

		editor.destroy();
	});

	it("skips hidden toggle children when moving through visible blocks", () => {
		const editor = createEditor(editorOpts());
		const toggleBlockId = editor.firstBlock()!.id;
		const childBlockId = crypto.randomUUID();
		const afterBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "set-props",
				blockId: toggleBlockId,
				props: { type: "toggle", ...{ open: false } },
			},
			{
				type: "splice-text",
				blockId: toggleBlockId,
				from: 0,
				to: 0,
				insert: "Toggle",
			},
			{
				type: "insert-block",
				blockId: childBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: toggleBlockId },
			},
			{
				type: "splice-text",
				blockId: childBlockId,
				from: 0,
				to: 0,
				insert: "Hidden child",
			},
			{
				type: "set-props",
				blockId: childBlockId,
				props: { parentId: toggleBlockId },
			},
			{
				type: "insert-block",
				blockId: afterBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: childBlockId },
			},
			{
				type: "splice-text",
				blockId: afterBlockId,
				from: 0,
				to: 0,
				insert: "After toggle",
			},
		]);

		const toggleYText = getYText(editor, toggleBlockId);
		const target = moveCaretAcrossBlocks(editor, {
			blockId: toggleBlockId,
			ytext: toggleYText,
			range: { start: 6, end: 6 },
			direction: "next",
		});

		expect(target).toEqual({
			blockId: afterBlockId,
			anchorOffset: 0,
			focusOffset: 0,
		});

		editor.destroy();
	});
});
