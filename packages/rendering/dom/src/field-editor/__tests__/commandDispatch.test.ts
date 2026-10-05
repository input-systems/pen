import { describe, expect, it } from "vitest";
import { splitBlock } from "@input/pen-core";
import { applyEnterBehavior } from "../commandsEnter";
import { handleFieldEditorKeyDown } from "../keyHandling";
import {
	getYText,
	keyEvent,
	recordingController,
	runDirectHandler,
	seedParagraphs,
	spyDispatch,
} from "./fieldEditorFixtures.testHelpers";

/** The caret the authority and the controller both land on after a split. */
function expectCaretOnNewBlock(
	editor: ReturnType<typeof seedParagraphs>["editor"],
	activations: ReturnType<typeof recordingController>["activations"],
): void {
	const newBlockId = editor.documentState.blockOrder[1];
	expect(newBlockId).toEqual(expect.any(String));
	expect(editor.selection).toMatchObject({
		type: "text",
		anchor: { blockId: newBlockId, offset: 0 },
		focus: { blockId: newBlockId, offset: 0 },
	});
	expect(activations).toEqual([
		{ blockId: newBlockId, anchorOffset: 0, focusOffset: 0, kind: "commit" },
	]);
}

describe("field-editor command registry dispatch", () => {
	it("Enter splits through the core registry and keeps authority on the new block", () => {
		const {
			editor,
			blockIds: [blockId],
		} = seedParagraphs(["Hello"]);
		editor.selectText(blockId!, 2, 2);
		const dispatched = spyDispatch(editor);
		const { controller, activations } = recordingController(blockId!);

		const handled = handleFieldEditorKeyDown({
			event: keyEvent("Enter"),
			editor,
			fieldEditor: controller,
			ytext: getYText(editor, blockId!),
			range: { start: 2, end: 2 },
		});

		expect(handled).toBe(true);
		expect(dispatched).toContain(splitBlock.name);
		expect(editor.documentState.blockOrder).toHaveLength(2);
		expect(editor.getBlock(blockId!)?.textContent()).toBe("He");
		expectCaretOnNewBlock(editor, activations);
		editor.destroy();
	});

	it("beforeinput insertParagraph dispatches pen.splitBlock and keeps authority on the new block", () => {
		const {
			editor,
			blockIds: [blockId],
		} = seedParagraphs(["Hello"]);
		editor.selectText(blockId!, 5, 5);
		const dispatched = spyDispatch(editor);
		const { controller, activations } = recordingController(blockId!);

		runDirectHandler("insertParagraph", {
			editor,
			blockId: blockId!,
			controller,
			range: { start: 5, end: 5 },
		});

		expect(dispatched).toContain("pen.splitBlock");
		expect(editor.documentState.blockOrder).toHaveLength(2);
		expectCaretOnNewBlock(editor, activations);
		editor.destroy();
	});

	it("applyEnterBehavior lands authority on the new block after an enter split", () => {
		const {
			editor,
			blockIds: [blockId],
		} = seedParagraphs(["Hello"]);
		// start off the split offset so onCommit mapping cannot hide a missing write
		editor.selectText(blockId!, 0, 0);

		const target = applyEnterBehavior(editor, {
			blockId: blockId!,
			inputMode: "richtext",
			ytext: getYText(editor, blockId!),
			range: { start: 5, end: 5 },
		});

		const newBlockId = editor.documentState.blockOrder[1];
		expect(target).toEqual({ blockId: newBlockId, anchorOffset: 0, focusOffset: 0 });
		expect(editor.getBlock(blockId!)?.textContent()).toBe("Hello");
		expect(editor.getBlock(newBlockId!)?.textContent()).toBe("");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: newBlockId, offset: 0 },
			focus: { blockId: newBlockId, offset: 0 },
		});
		editor.destroy();
	});

	it("Backspace deletes a grapheme through the core registry", () => {
		const {
			editor,
			blockIds: [blockId],
		} = seedParagraphs(["Hi👋"]);
		const dispatched = spyDispatch(editor);

		const handled = handleFieldEditorKeyDown({
			event: keyEvent("Backspace"),
			editor,
			fieldEditor: recordingController(blockId!).controller,
			ytext: getYText(editor, blockId!),
			range: { start: "Hi👋".length, end: "Hi👋".length },
		});

		expect(handled).toBe(true);
		expect(dispatched).toContain("pen.deleteBackward");
		expect(editor.getBlock(blockId!)?.textContent()).toBe("Hi");
		editor.destroy();
	});

	it("Tab indents a nestable list item through pen.indent", () => {
		const {
			editor,
			blockIds: [firstBlockId, secondBlockId],
		} = seedParagraphs(["", "child"]);
		editor.apply([
			{ type: "set-props", blockId: firstBlockId!, props: { type: "bulletListItem" } },
			{
				type: "set-props",
				blockId: secondBlockId!,
				props: { type: "bulletListItem", indent: 0 },
			},
		]);
		const dispatched = spyDispatch(editor);
		const { controller, activations } = recordingController(secondBlockId!);

		const handled = handleFieldEditorKeyDown({
			event: keyEvent("Tab"),
			editor,
			fieldEditor: controller,
			ytext: getYText(editor, secondBlockId!),
			range: { start: 2, end: 2 },
		});

		expect(handled).toBe(true);
		expect(dispatched).toContain("pen.indent");
		expect(editor.getBlock(secondBlockId!)?.props.indent).toBe(1);
		expect(activations).toEqual([
			{ blockId: secondBlockId, anchorOffset: 2, focusOffset: 2, kind: "activate" },
		]);
		editor.destroy();
	});

	it("ArrowDown at a block edge dispatches pen.caretDown through the keymap", () => {
		const {
			editor,
			blockIds: [firstBlockId, secondBlockId],
		} = seedParagraphs(["Hi", ""]);
		editor.selectText(firstBlockId!, 2, 2);
		const dispatched = spyDispatch(editor);

		const handled = handleFieldEditorKeyDown({
			event: keyEvent("ArrowDown"),
			editor,
			fieldEditor: recordingController(firstBlockId!).controller,
			ytext: getYText(editor, firstBlockId!),
			range: { start: 2, end: 2 },
		});

		expect(handled).toBe(true);
		expect(dispatched).toContain("pen.caretDown");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: secondBlockId, offset: 0 },
			focus: { blockId: secondBlockId, offset: 0 },
		});
		editor.destroy();
	});

	it.each([
		{
			name: "at the live range when activateTextSelection cleared the programmatic caret",
			text: "First",
			before: "activate",
			caret: 0,
			live: 5,
			expected: "First!",
		},
		{
			name: "at the resolved live range when editor.selectText is stale",
			text: "Hello world",
			before: null,
			caret: 3,
			live: 11,
			expected: "Hello world!",
		},
		{
			// A stale {11,11} would land at the end.
			name: "at the live caret after same-turn P1, without a programmatic range resolver",
			text: "Hello world",
			before: "commit",
			caret: 3,
			live: 3,
			expected: "Hel!lo world",
		},
	] as const)("inserts $name", ({ text, before, caret, live, expected }) => {
		const {
			editor,
			blockIds: [blockId],
		} = seedParagraphs([text]);
		editor.selectText(blockId!, caret, caret);
		const { controller } = recordingController(blockId!);
		if (before === "activate") controller.activateTextSelection(blockId!, caret, caret);
		if (before === "commit") {
			controller.commitProgrammaticTextSelection(blockId!, caret, caret);
		}

		runDirectHandler("insertText", {
			editor,
			blockId: blockId!,
			controller,
			range: { start: live, end: live },
			data: "!",
		});

		expect(editor.getBlock(blockId!)?.textContent()).toBe(expected);
		editor.destroy();
	});
});
