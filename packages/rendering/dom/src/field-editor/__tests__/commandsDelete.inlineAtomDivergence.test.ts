import { describe, expect, it } from "vitest";
import type { Editor } from "@input/pen-types";
import { handleFieldEditorKeyDown } from "../keyHandling";
import {
	getYText,
	keyEvent,
	recordingController,
	runDirectHandler,
	seedParagraphs,
	spyDispatch,
} from "./fieldEditorFixtures.testHelpers";

/**
 * Owner-approved UX: Backspace next to an inline atom SELECTs on the first
 * press and deletes on the second. Live keydown and beforeinput both go
 * through `registry.dispatch` and must stay on SELECT.
 *
 * Second press is ordinary delete-the-selection (`handleDelete` on a
 * non-collapsed range), not a second atom-specific step.
 */

const MENTION = { type: "mention", props: { id: "1", label: "Ada" } };

/** `hi` + mention + `z`: the atom spans offsets 2..3. */
function createMentionEditor() {
	const {
		editor,
		blockIds: [blockId],
	} = seedParagraphs(["hiz"]);
	editor.apply([
		{
			type: "splice-text",
			blockId: blockId!,
			from: 2,
			to: 2,
			insert: { nodeType: MENTION.type, props: MENTION.props },
		},
	]);
	return { editor, blockId: blockId! };
}

function hasMention(editor: Editor, blockId: string): boolean {
	return (editor.getBlock(blockId)?.inlineDeltas() ?? []).some(
		(delta) => typeof delta.insert === "object" && delta.insert?.type === "mention",
	);
}

function expectAtomSelected(editor: Editor, blockId: string): void {
	expect(hasMention(editor, blockId)).toBe(true);
	expect(editor.getBlock(blockId)?.inlineDeltas()).toEqual([
		{ insert: "hi" },
		{ insert: MENTION },
		{ insert: "z" },
	]);
	expect(editor.selection).toMatchObject({
		type: "text",
		anchor: { blockId, offset: 2 },
		focus: { blockId, offset: 3 },
	});
}

function expectAtomDeleted(editor: Editor, blockId: string, dispatched: string[]): void {
	expect(dispatched.filter((name) => name === "pen.deleteBackward")).toHaveLength(2);
	expect(hasMention(editor, blockId)).toBe(false);
	expect(editor.getBlock(blockId)?.textContent()).toBe("hiz");
}

describe("inline atom delete select-then-delete", () => {
	it("handleFieldEditorKeyDown Backspace selects the adjacent atom, then deletes it on the second press", () => {
		const { editor, blockId } = createMentionEditor();
		const dispatched = spyDispatch(editor);
		const press = (start: number) =>
			handleFieldEditorKeyDown({
				event: keyEvent("Backspace"),
				editor,
				fieldEditor: recordingController(blockId, { commit: false }).controller,
				ytext: getYText(editor, blockId),
				range: { start, end: 3 },
			});

		expect(press(3)).toBe(true);
		expectAtomSelected(editor, blockId);

		expect(press(2)).toBe(true);
		expectAtomDeleted(editor, blockId, dispatched);
		editor.destroy();
	});

	it("DIRECT_HANDLERS.deleteContentBackward selects the adjacent atom, then deletes it on the second press", () => {
		const { editor, blockId } = createMentionEditor();
		const dispatched = spyDispatch(editor);
		const press = (start: number) =>
			runDirectHandler("deleteContentBackward", {
				editor,
				blockId,
				controller: recordingController(blockId, { commit: false }).controller,
				range: { start, end: 3 },
				applyInlineTextEdit: () => {
					throw new Error(
						"fallback applyInlineTextEdit must not run when registry dispatch succeeds",
					);
				},
			});

		press(3);
		expectAtomSelected(editor, blockId);

		press(2);
		expectAtomDeleted(editor, blockId, dispatched);
		editor.destroy();
	});
});
