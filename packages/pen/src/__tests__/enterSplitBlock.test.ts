import { getNumberedListItemValue, splitBlock } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import {
	caretOf,
	convertFirstBlock,
	createPresetEditor,
	dispatchAt,
	insertBlockAfter,
} from "./presetCommands.testHelpers";

function enterAt(editor: Editor, blockId: string, offset = 0): boolean {
	return dispatchAt(editor, splitBlock, undefined, blockId, offset);
}

function secondBlockId(editor: Editor): string {
	return editor.documentState.blockOrder[1]!;
}

describe("Enter", () => {
	it("splits a paragraph at the caret and lands on the new block", () => {
		const editor = createPresetEditor();
		const blockId = convertFirstBlock(editor, "paragraph", "HelloWorld");

		expect(enterAt(editor, blockId, 5)).toBe(true);
		const newBlockId = secondBlockId(editor);
		expect(editor.blockCount()).toBe(2);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(editor.getBlock(newBlockId)?.type).toBe("paragraph");
		expect(editor.getBlock(newBlockId)?.textContent()).toBe("World");
		expect(caretOf(editor)).toEqual({ blockId: newBlockId, offset: 0 });

		editor.destroy();
	});

	it("continues a heading as a paragraph", () => {
		const editor = createPresetEditor();
		const blockId = convertFirstBlock(editor, "heading", "Title");

		expect(enterAt(editor, blockId, 5)).toBe(true);
		expect(editor.getBlock(blockId)?.type).toBe("heading");
		expect(editor.getBlock(secondBlockId(editor))?.type).toBe("paragraph");

		editor.destroy();
	});

	it.each(["bulletListItem", "blockquote"])(
		"keeps the type when splitting a %s that has text",
		(type) => {
			const editor = createPresetEditor();
			const blockId = convertFirstBlock(editor, type, "item");

			expect(enterAt(editor, blockId, 4)).toBe(true);
			expect(editor.blockCount()).toBe(2);
			expect(editor.getBlock(secondBlockId(editor))?.type).toBe(type);

			editor.destroy();
		},
	);

	it.each([
		"bulletListItem",
		"numberedListItem",
		"checkListItem",
		"blockquote",
		"callout",
	])("converts an empty %s to a paragraph without adding a block", (type) => {
		const editor = createPresetEditor();
		const blockId = convertFirstBlock(editor, type);

		expect(enterAt(editor, blockId)).toBe(true);
		expect(editor.blockCount()).toBe(1);
		expect(editor.getBlock(blockId)?.type).toBe("paragraph");
		expect(caretOf(editor)).toEqual({ blockId, offset: 0 });

		editor.destroy();
	});

	it("continues a numbered list with the next value", () => {
		const editor = createPresetEditor();
		const blockId = convertFirstBlock(editor, "paragraph", "third");
		editor.apply([
			{
				type: "set-props",
				blockId,
				props: { type: "numberedListItem", start: 3 },
			},
		]);

		expect(enterAt(editor, blockId, 5)).toBe(true);
		const newBlock = editor.getBlock(secondBlockId(editor));
		expect(newBlock?.type).toBe("numberedListItem");
		expect(getNumberedListItemValue(editor.getBlock(blockId))).toBe(3);
		expect(getNumberedListItemValue(newBlock)).toBe(4);

		editor.destroy();
	});

	it("inserts a newline in a code block instead of splitting it", () => {
		const editor = createPresetEditor();
		const blockId = convertFirstBlock(editor, "codeBlock", "abcd");

		expect(enterAt(editor, blockId, 2)).toBe(true);
		expect(editor.blockCount()).toBe(1);
		expect(editor.getBlock(blockId)?.textContent()).toBe("ab\ncd");
		expect(caretOf(editor)).toEqual({ blockId, offset: 3 });

		editor.destroy();
	});

	it("lifts an empty paragraph out of its toggle", () => {
		const editor = createPresetEditor();
		const toggleBlockId = convertFirstBlock(editor, "toggle");
		const childBlockId = insertBlockAfter(
			editor,
			toggleBlockId,
			"paragraph",
			{
				parentId: toggleBlockId,
			},
		);

		expect(enterAt(editor, childBlockId)).toBe(true);
		expect(editor.documentState.parentOf(childBlockId)).toBeNull();
		expect(editor.getBlock(childBlockId)?.type).toBe("paragraph");
		expect(caretOf(editor)).toEqual({ blockId: childBlockId, offset: 0 });

		editor.destroy();
	});

	it("exits an empty list item inside a toggle in two presses", () => {
		const editor = createPresetEditor();
		const toggleBlockId = convertFirstBlock(editor, "toggle");
		const childBlockId = insertBlockAfter(
			editor,
			toggleBlockId,
			"bulletListItem",
			{ parentId: toggleBlockId },
		);

		expect(enterAt(editor, childBlockId)).toBe(true);
		expect(editor.getBlock(childBlockId)?.type).toBe("paragraph");
		expect(editor.documentState.parentOf(childBlockId)).toBe(toggleBlockId);

		expect(enterAt(editor, childBlockId)).toBe(true);
		expect(editor.documentState.parentOf(childBlockId)).toBeNull();

		editor.destroy();
	});
});
