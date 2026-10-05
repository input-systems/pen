import type { DiagnosticEvent } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import {
	BODY_ID,
	BODY_TEXT,
	TITLE_ID,
	createUndoEditor,
	splice,
} from "./undoEditorFixture";

const END = BODY_TEXT.length;

const STRUCTURAL_CASES = [
	{ blockType: "table", blockId: "fixture-table" },
	{ blockType: "divider", blockId: "fixture-divider" },
] as const;

// One collaborator commit whose same-length delete (body [10, 14)) and insert
// (title) undo pairs as a move; it re-mints the authority's anchors.
const COLLABORATOR_MOVE = [
	splice(BODY_ID, 10, 14, ""),
	splice(TITLE_ID, 0, 0, "abcd"),
];

describe("@input/pen-undo drift anchors", () => {
	it("AN9/AS1: a caret write mints only the selection authority's two anchors", () => {
		const { editor } = createUndoEditor();
		const before = editor.anchors.liveCount;

		editor.selectText(BODY_ID, 3, 3);

		expect(editor.anchors.liveCount - before).toBe(2);
		editor.destroy();
	});

	it.each(STRUCTURAL_CASES)(
		"AN1/AS1: a text range ending on a $blockType mints no drift anchor and emits no anchor-target-missing",
		({ blockType, blockId }) => {
			const { editor } = createUndoEditor();
			editor.apply(
				[
					{
						type: "insert-block",
						blockId,
						blockType,
						props: {},
						position: { after: BODY_ID },
					},
				],
				{ origin: "system" },
			);
			const diagnostics: DiagnosticEvent[] = [];
			const unsubscribe = editor.on("diagnostic", (event) => {
				diagnostics.push(event);
			});

			editor.selectTextRange(
				{ blockId: BODY_ID, offset: 0 },
				{ blockId, offset: 1 },
			);

			expect(editor.selection).toMatchObject({
				type: "text",
				focus: { blockId },
			});

			editor.selectText(BODY_ID, END, END);
			editor.apply([splice(BODY_ID, END, END, "!")], { origin: "user" });
			expect(editor.undoManager.undo()).toBe(true);
			expect(editor.getBlock(BODY_ID)?.textContent()).toBe(BODY_TEXT);
			// covers anchor-target-missing from the range write and the undo
			expect(diagnostics).toEqual([]);

			unsubscribe();
			editor.destroy();
		},
	);
});

describe("@input/pen-undo drift over shared anchors", () => {
	it("AN14/AS1: drift shared with the selection authority is repaired from its pre-commit position, not the authority's after-commit resolve", async () => {
		const { editor } = createUndoEditor();
		editor.selectText(BODY_ID, END, END);
		editor.apply([splice(BODY_ID, END, END, "!")], { origin: "user" });
		expect(editor.selection).toMatchObject({
			anchor: { blockId: BODY_ID, offset: END + 1 },
		});
		// The entry's after-drift is captured in a microtask: the authority's pair.
		await Promise.resolve();

		// The caret (body:17) sits after the moved range [10, 14), but its
		// after-commit position (body:13) falls inside it.
		editor.apply(COLLABORATOR_MOVE, { origin: "collaborator" });
		expect(editor.selection).toMatchObject({
			anchor: { blockId: BODY_ID, offset: END - 3 },
		});

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.undoManager.redo()).toBe(true);

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: BODY_ID, offset: END - 3 },
			focus: { blockId: BODY_ID, offset: END - 3 },
		});
		editor.destroy();
	});

	it("AN14: the live caret undo holds between entries follows a move, so the next entry's before-caret is where the user typed", () => {
		const { editor } = createUndoEditor();
		editor.selectText(BODY_ID, END, END);

		// The commit dispatch emits the `mapped` selection after the move, which
		// refreshes undo's live caret.
		editor.apply(COLLABORATOR_MOVE, { origin: "collaborator" });
		const caret = END - 4;
		expect(editor.selection).toMatchObject({
			anchor: { blockId: BODY_ID, offset: caret },
		});

		editor.apply([splice(BODY_ID, caret, caret, "!")], { origin: "user" });
		expect(editor.undoManager.undo()).toBe(true);

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: BODY_ID, offset: caret },
			focus: { blockId: BODY_ID, offset: caret },
		});
		editor.destroy();
	});
});
