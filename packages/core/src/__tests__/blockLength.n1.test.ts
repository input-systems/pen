import { describe, expect, it } from "vitest";

import { getEditorSelectionRecord } from "../index";
import { createEditor } from "./editorCore.testHelpers";

function createAtomOnlyBlock() {
	const editor = createEditor();
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{
			type: "splice-text",
			blockId,
			from: 0,
			to: 0,
			insert: { nodeType: "mention", props: { id: "user-ada", label: "Ada" } },
		},
	]);
	return { editor, blockId };
}

describe("BlockHandle.length (N1)", () => {
	it("N1: an atom-only block has logical length 1 and two normal positions", () => {
		const { editor, blockId } = createAtomOnlyBlock();
		const block = editor.getBlock(blockId)!;

		expect(block.textContent()).toBe("");
		expect(block.length()).toBe(1);

		editor.selectText(blockId, 1, 1);
		expect(getEditorSelectionRecord(editor)?.state).toMatchObject({
			type: "text",
			focus: { blockId, offset: 1 },
		});
		editor.selectText(blockId, 0, 0);
		expect(getEditorSelectionRecord(editor)?.state).toMatchObject({
			focus: { blockId, offset: 0 },
		});
		editor.destroy();
	});

	it("N1: an atom between characters counts one offset", () => {
		const { editor, blockId } = createAtomOnlyBlock();
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hi " },
			{ type: "splice-text", blockId, from: 4, to: 4, insert: "!" },
		]);

		expect(editor.getBlock(blockId)!.length()).toBe(5);
		editor.destroy();
	});
});
