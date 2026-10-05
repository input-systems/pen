import type { DiagnosticEvent } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { BODY_ID, BODY_TEXT, createUndoEditor } from "./undoEditorFixture";

const STRUCTURAL_CASES = [
	{ blockType: "table", blockId: "fixture-table" },
	{ blockType: "divider", blockId: "fixture-divider" },
] as const;

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
			expect(
				diagnostics.filter((event) => event.code === "anchor-target-missing"),
			).toEqual([]);

			editor.selectText(BODY_ID, BODY_TEXT.length, BODY_TEXT.length);
			editor.apply(
				[
					{
						type: "splice-text",
						blockId: BODY_ID,
						from: BODY_TEXT.length,
						to: BODY_TEXT.length,
						insert: "!",
					},
				],
				{ origin: "user" },
			);
			expect(editor.undoManager.undo()).toBe(true);
			expect(editor.getBlock(BODY_ID)?.textContent()).toBe(BODY_TEXT);
			expect(diagnostics).toEqual([]);

			unsubscribe();
			editor.destroy();
		},
	);
});
