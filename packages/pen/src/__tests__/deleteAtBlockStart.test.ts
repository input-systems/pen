import { deleteBackward } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import {
	caretOf,
	convertFirstBlock,
	createPresetEditor,
	dispatchAt,
	insertBlockAfter,
} from "./presetCommands.testHelpers";

function backspaceAt(
	editor: Editor,
	blockId: string,
	from = 0,
	to = from,
): boolean {
	return dispatchAt(
		editor,
		deleteBackward,
		{ granularity: "grapheme" },
		blockId,
		from,
		to,
	);
}

/** `Hello` in the first block, then one block of `blockType` after it. */
function seedAfterHello(
	editor: Editor,
	blockType: string,
	text = "",
): { firstBlockId: string; blockId: string } {
	const firstBlockId = convertFirstBlock(editor, "paragraph", "Hello");
	const blockId = insertBlockAfter(editor, firstBlockId, blockType, { text });
	return { firstBlockId, blockId };
}

describe("Backspace at block start", () => {
	it.each(["heading", "bulletListItem", "blockquote", "codeBlock"])(
		"converts an empty leading %s to a paragraph",
		(type) => {
			const editor = createPresetEditor();
			const blockId = convertFirstBlock(editor, type);

			expect(backspaceAt(editor, blockId)).toBe(true);
			expect(editor.getBlock(blockId)?.type).toBe("paragraph");
			expect(caretOf(editor)).toEqual({ blockId, offset: 0 });

			editor.destroy();
		},
	);

	it("converts an empty code block below another block instead of removing it", () => {
		const editor = createPresetEditor();
		const { firstBlockId, blockId } = seedAfterHello(editor, "codeBlock");

		expect(backspaceAt(editor, blockId)).toBe(true);
		expect(editor.getBlock(blockId)?.type).toBe("paragraph");
		expect(editor.getBlock(firstBlockId)?.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("leaves a leading code block that still has text alone", () => {
		const editor = createPresetEditor();
		const blockId = convertFirstBlock(editor, "codeBlock", "code");

		expect(backspaceAt(editor, blockId)).toBe(false);
		expect(editor.getBlock(blockId)?.type).toBe("codeBlock");
		expect(editor.getBlock(blockId)?.textContent()).toBe("code");

		editor.destroy();
	});

	it("merges a paragraph into the block before it", () => {
		const editor = createPresetEditor();
		const { firstBlockId, blockId } = seedAfterHello(
			editor,
			"paragraph",
			"World",
		);

		expect(backspaceAt(editor, blockId)).toBe(true);
		expect(editor.getBlock(blockId)).toBeNull();
		expect(editor.getBlock(firstBlockId)?.textContent()).toBe("HelloWorld");
		expect(caretOf(editor)).toEqual({ blockId: firstBlockId, offset: 5 });

		editor.destroy();
	});

	it("removes an empty paragraph and leaves the block before it untouched", () => {
		const editor = createPresetEditor();
		const { firstBlockId, blockId } = seedAfterHello(editor, "paragraph");

		expect(backspaceAt(editor, blockId)).toBe(true);
		expect(editor.blockCount()).toBe(1);
		expect(editor.getBlock(firstBlockId)?.textContent()).toBe("Hello");
		expect(caretOf(editor)).toEqual({ blockId: firstBlockId, offset: 5 });

		editor.destroy();
	});

	it("treats a caret reported past the end of an empty paragraph as its start", () => {
		const editor = createPresetEditor();
		const { firstBlockId, blockId } = seedAfterHello(editor, "paragraph");

		expect(backspaceAt(editor, blockId, 1)).toBe(true);
		expect(editor.blockCount()).toBe(1);
		expect(editor.getBlock(firstBlockId)?.textContent()).toBe("Hello");
		expect(caretOf(editor)).toEqual({ blockId: firstBlockId, offset: 5 });

		editor.destroy();
	});

	it("removes an empty childless toggle and moves to the block before it", () => {
		const editor = createPresetEditor();
		const { firstBlockId, blockId } = seedAfterHello(editor, "toggle");

		expect(backspaceAt(editor, blockId)).toBe(true);
		expect(editor.getBlock(blockId)).toBeNull();
		expect(editor.blockCount()).toBe(1);
		expect(caretOf(editor)).toEqual({ blockId: firstBlockId, offset: 5 });

		editor.destroy();
	});

	it("does not treat a toggle with nested children as an empty toggle", () => {
		const editor = createPresetEditor();
		const { firstBlockId, blockId } = seedAfterHello(editor, "toggle");
		const childBlockId = insertBlockAfter(editor, blockId, "paragraph", {
			parentId: blockId,
		});

		expect(backspaceAt(editor, blockId)).toBe(true);
		expect(editor.getBlock(childBlockId)).not.toBeNull();
		expect(caretOf(editor)).toEqual({ blockId: firstBlockId, offset: 5 });

		editor.destroy();
	});
});

describe("Backspace over a selection", () => {
	it("deletes a selected range inside one block", () => {
		const editor = createPresetEditor();
		const blockId = convertFirstBlock(editor, "paragraph", "Hello");

		expect(backspaceAt(editor, blockId, 1, 4)).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Ho");
		expect(caretOf(editor)).toEqual({ blockId, offset: 1 });

		editor.destroy();
	});
});
