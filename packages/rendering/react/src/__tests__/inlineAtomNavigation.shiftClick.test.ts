import { describe, expect, it } from "vitest";
import { resolveShiftClickInlineAtomSelection } from "@input/pen-dom";
import { createPresetEditor } from "./utils/keyHandlingTestHelpers";

describe("@input/pen-react inline atom shift-click selection", () => {
	it("extends a selected atom range to the clicked atom on the right", () => {
		const editor = createPresetEditor({ preset: { shortcuts: false } });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "xxx" },
		]);
		editor.selectText(blockId, 0, 1);

		expect(
			resolveShiftClickInlineAtomSelection(editor, blockId, 1),
		).toEqual({
			blockId,
			anchorOffset: 0,
			focusOffset: 2,
		});

		editor.destroy();
	});

	it("extends a selected atom range to the clicked atom on the left", () => {
		const editor = createPresetEditor({ preset: { shortcuts: false } });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "xxx" },
		]);
		editor.selectText(blockId, 1, 2);

		expect(
			resolveShiftClickInlineAtomSelection(editor, blockId, 0),
		).toEqual({
			blockId,
			anchorOffset: 2,
			focusOffset: 0,
		});

		editor.destroy();
	});

	it("deselects the right edge atom when shift-clicking it again", () => {
		const editor = createPresetEditor({ preset: { shortcuts: false } });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "xxx" },
		]);
		editor.selectText(blockId, 0, 2);

		expect(
			resolveShiftClickInlineAtomSelection(editor, blockId, 1),
		).toEqual({
			blockId,
			anchorOffset: 0,
			focusOffset: 1,
		});

		editor.destroy();
	});

	it("deselects the left edge atom when shift-clicking it again", () => {
		const editor = createPresetEditor({ preset: { shortcuts: false } });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "xxx" },
		]);
		editor.selectText(blockId, 0, 2);

		expect(
			resolveShiftClickInlineAtomSelection(editor, blockId, 0),
		).toEqual({
			blockId,
			anchorOffset: 2,
			focusOffset: 1,
		});

		editor.destroy();
	});
});
