import { describe, expect, it } from "vitest";
import { createEditor, getInlineCompletionController } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { createModelDouble } from "@input/pen-test";
import { undoExtension } from "@input/pen-undo";
import { autocompleteExtension, getAutocompleteController } from "../index";
import { fieldEditorSlot, waitForCondition } from "./extension.testHelpers";

describe("AIB4 autocomplete accept undo", () => {
	it("AIB4: autocomplete accept is a single undo step", async () => {
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				autocompleteExtension({
					debounceMs: 0,
					model: createModelDouble({
						responses: [{ text: " world from pen" }],
					}),
				}),
				fieldEditorSlotExtension,
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" }],
			{ origin: "user" },
		);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" world from pen",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"Hello world from pen",
		);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("");

		editor.destroy();
	});
});
