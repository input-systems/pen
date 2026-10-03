import { getEditorSelectionRecord } from "@input/pen-core";
import { describe, expect, it } from "vitest";

import { BODY_ID, BODY_TEXT, createUndoEditor } from "./undoEditorFixture";

describe("@input/pen-undo selection restore origin", () => {
	it("S3: undo and redo restore the selection with origin restore", async () => {
		const { editor } = createUndoEditor();
		const end = BODY_TEXT.length;
		editor.selectText(BODY_ID, end, end, { origin: "keyboard" });
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
		// CURSOR_AFTER settles in a microtask after the edit group.
		await Promise.resolve();
		editor.selectText(BODY_ID, 0, 0, { origin: "pointer" });

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId: BODY_ID, offset: end },
		});
		expect(getEditorSelectionRecord(editor)?.origin).toBe("restore");

		editor.selectText(BODY_ID, 3, 3, { origin: "pointer" });
		expect(editor.undoManager.redo()).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId: BODY_ID, offset: end + 1 },
		});
		expect(getEditorSelectionRecord(editor)?.origin).toBe("restore");
		editor.destroy();
	});

	it("S3: undo keeps origin restore when mapping the restored caret changes nothing", async () => {
		const { editor } = createUndoEditor();
		editor.selectText(BODY_ID, 0, 0, { origin: "keyboard" });
		editor.apply(
			[{ type: "splice-text", blockId: BODY_ID, from: 0, to: 0, insert: "x" }],
			{ origin: "user" },
		);
		editor.selectText(BODY_ID, 1, 1, { origin: "keyboard" });
		await Promise.resolve();

		// The caret never moved away: undo restores offset 0, which is also
		// where the deletion maps it.
		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.selection).toMatchObject({ focus: { blockId: BODY_ID, offset: 0 } });
		expect(getEditorSelectionRecord(editor)?.origin).toBe("restore");
		editor.destroy();
	});
});
