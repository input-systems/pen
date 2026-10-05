import type { Editor } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";
import type { EditorSelectAllBehavior } from "../../constants/selectAll";
import { FieldEditorImpl } from "../fieldEditorImpl";
import { handleSelectAllShortcut } from "../keyHandling";
import { keyEvent, seedParagraphs } from "./fieldEditorFixtures.testHelpers";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Two paragraphs, "hello" and "world", with the caret at 2 in `caretIn`. */
function createTwoBlockFixture(
	selectAllBehavior: EditorSelectAllBehavior,
	caretIn: 0 | 1,
): { editor: Editor; blockIds: string[]; press: () => boolean } {
	const { editor, blockIds } = seedParagraphs(["hello", "world"]);
	const fieldEditor = new FieldEditorImpl(editor, { selectAllBehavior });
	cleanups.push(() => {
		fieldEditor.destroy();
		editor.destroy();
	});
	editor.selectText(blockIds[caretIn]!, 2, 2);
	fieldEditor.activate(blockIds[caretIn]!);
	const press = () =>
		handleSelectAllShortcut(editor, keyEvent("a", { metaKey: true }), fieldEditor);
	return { editor, blockIds, press };
}

describe("handleSelectAllShortcut vs T1 ladder", () => {
	it.each([
		["block-first Mod-a takes the block rung", "block-first", 0, [0, 5]],
		["document-first Mod-a covers all content", "document-first", 0, [1, 5]],
		["document-first reaches back past the active block", "document-first", 1, [1, 5]],
	] as const)("T1: %s, then BlockSelection", (_name, behavior, caretIn, [focusIndex, focusOffset]) => {
		const { editor, blockIds, press } = createTwoBlockFixture(behavior, caretIn);

		expect(press()).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: blockIds[0], offset: 0 },
			focus: { blockId: blockIds[focusIndex], offset: focusOffset },
		});

		expect(press()).toBe(true);
		expect(editor.selection).toEqual({
			type: "block",
			blockIds,
			head: blockIds[1],
		});
	});
});
