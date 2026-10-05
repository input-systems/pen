import { describe, expect, it } from "vitest";

import {
	BODY_ID,
	BODY_TEXT,
	TITLE_ID,
	createUndoEditor,
} from "./undoEditorFixture";

describe("@input/pen-undo drift over shared anchors", () => {
	it("AN14/AS1: drift shared with the selection authority is repaired from its pre-commit position, not the authority's after-commit resolve", async () => {
		const { editor } = createUndoEditor();
		const end = BODY_TEXT.length;
		editor.selectText(BODY_ID, end, end);
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: end,
					to: end,
					insert: "!",
				},
			],
			{ origin: "user" },
		);
		expect(editor.selection).toMatchObject({
			anchor: { blockId: BODY_ID, offset: end + 1 },
		});
		// The entry's after-drift is captured in a microtask: the authority's pair.
		await Promise.resolve();

		// One collaborator commit whose same-length delete and insert undo pairs
		// as a move. The caret (body:17) sits after the moved range [10, 14), but
		// its after-commit position (body:13) falls inside it.
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: 10,
					to: 14,
					insert: "",
				},
				{
					type: "splice-text",
					blockId: TITLE_ID,
					from: 0,
					to: 0,
					insert: "abcd",
				},
			],
			{ origin: "collaborator" },
		);
		expect(editor.selection).toMatchObject({
			anchor: { blockId: BODY_ID, offset: end - 3 },
		});

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.undoManager.redo()).toBe(true);

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: BODY_ID, offset: end - 3 },
			focus: { blockId: BODY_ID, offset: end - 3 },
		});
		editor.destroy();
	});

	it("AN14: the live caret undo holds between entries follows a move, so the next entry's before-caret is where the user typed", () => {
		const { editor } = createUndoEditor();
		const end = BODY_TEXT.length;
		editor.selectText(BODY_ID, end, end);

		// A collaborator move (same-length delete in the body, insert in the
		// title) re-mints the authority's anchors; the commit dispatch then
		// emits the `mapped` selection, which refreshes undo's live caret.
		editor.apply(
			[
				{ type: "splice-text", blockId: BODY_ID, from: 10, to: 14, insert: "" },
				{ type: "splice-text", blockId: TITLE_ID, from: 0, to: 0, insert: "abcd" },
			],
			{ origin: "collaborator" },
		);
		const caret = end - 4;
		expect(editor.selection).toMatchObject({
			anchor: { blockId: BODY_ID, offset: caret },
		});

		editor.apply(
			[{ type: "splice-text", blockId: BODY_ID, from: caret, to: caret, insert: "!" }],
			{ origin: "user" },
		);
		expect(editor.undoManager.undo()).toBe(true);

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: BODY_ID, offset: caret },
			focus: { blockId: BODY_ID, offset: caret },
		});
		editor.destroy();
	});
});
