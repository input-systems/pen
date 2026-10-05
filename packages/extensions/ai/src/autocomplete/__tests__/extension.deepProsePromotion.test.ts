import { describe, expect, it } from "vitest";
import { createEditor, getInlineCompletionController } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { autocompleteExtension, getAutocompleteController } from "../index";
import { fieldEditorSlot, waitForCondition } from "./extension.testHelpers";

describe("@input/pen-ai/autocomplete: deep prose promotion", () => {
	it("promotes long depth-two prose continuations into a new paragraph earlier", async () => {
		let callCount = 0;
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					prefetchAfterAccept: true,
					model: {
						async *stream() {
							callCount += 1;
							if (callCount === 1) {
								yield {
									type: "text-delta" as const,
									delta: '", tired from a long day at work."',
								};
								yield { type: "done" as const };
								return;
							}
							yield {
								type: "text-delta" as const,
								delta: '", but happy to be back. He looked forward to a quiet evening at home, away from the hustle and bustle of the office."',
							};
							yield { type: "done" as const };
						},
					},
				}),
				fieldEditorSlotExtension,
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "He came home ",
			},
		]);
		editor.selectText(blockId, 13, 13);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				"tired from a long day at work.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() =>
				(inlineCompletion?.getState().visibleSuggestion?.previewBlocks
					?.length ?? 0) === 1,
		);

		expect(
			inlineCompletion?.getState().visibleSuggestion?.previewBlocks,
		).toEqual([
			expect.objectContaining({
				blockType: "paragraph",
				text: expect.stringContaining(
					"He looked forward to a quiet evening at home, away from the hustle and bustle of the office.",
				),
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);

		const secondBlock = editor.getBlock(blockId)?.next;
		expect(secondBlock?.type).toBe("paragraph");
		expect(secondBlock?.textContent()).toContain(
			"He looked forward to a quiet evening at home, away from the hustle and bustle of the office.",
		);

		editor.destroy();
	});
});
