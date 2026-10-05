import { describe, expect, it } from "vitest";
import { createEditor, getInlineCompletionController } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { autocompleteExtension, getAutocompleteController } from "../index";
import { fieldEditorSlot, waitForCondition } from "./extension.testHelpers";

describe("@input/pen-ai/autocomplete: continuation context", () => {
	it("preserves a leading newline when a continuation starts with markdown blocks", async () => {
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "\n- Book flights\n- Reserve the hotel",
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
				insert: "Trip plan",
			},
		]);
		editor.selectText(blockId, 9, 9);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.previewBlocks
					?.length === 2,
		);

		expect(inlineCompletion?.getState().visibleSuggestion?.text).toBe("");
		expect(
			inlineCompletion?.getState().visibleSuggestion?.previewBlocks,
		).toEqual([
			expect.objectContaining({
				text: "Book flights",
				blockType: "bulletListItem",
			}),
			expect.objectContaining({
				text: "Reserve the hotel",
				blockType: "bulletListItem",
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);

		const secondBlock = editor.getBlock(blockId)?.next;
		const thirdBlock = secondBlock?.next;
		expect(editor.getBlock(blockId)?.textContent()).toBe("Trip plan");
		expect(secondBlock?.type).toBe("bulletListItem");
		expect(secondBlock?.textContent()).toBe("Book flights");
		expect(thirdBlock?.type).toBe("bulletListItem");
		expect(thirdBlock?.textContent()).toBe("Reserve the hotel");

		editor.destroy();
	});

	it("builds continuation context from the newly inserted block after structured accept", async () => {
		let callCount = 0;
		let secondPrompt = "";
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					prefetchAfterAccept: true,
					model: {
						async *stream(options) {
							callCount += 1;
							if (callCount === 1) {
								yield {
									type: "text-delta" as const,
									delta: "\n- Book flights",
								};
								yield { type: "done" as const };
								return;
							}
							if (callCount === 2) {
								secondPrompt = String(
									options.messages[1]?.content ?? "",
								);
								yield {
									type: "text-delta" as const,
									delta: "\n- Reserve the hotel",
								};
								yield { type: "done" as const };
								return;
							}
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
				insert: "Trip plan",
			},
		]);
		editor.selectText(blockId, 9, 9);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.previewBlocks
					?.length === 1,
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion
					?.previewBlocks?.[0]?.text === "Reserve the hotel",
		);

		expect(secondPrompt).toContain("block_type=bulletListItem");
		expect(secondPrompt).toContain('prefix="Book flights"');

		editor.destroy();
	});

	it("treats multiline prose continuations as appended paragraph blocks", async () => {
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: " with notes\nBook flights this week.\nReserve the hotel before Friday.",
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
				insert: "Trip plan",
			},
		]);
		editor.selectText(blockId, 9, 9);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" with notes",
		);

		expect(
			inlineCompletion?.getState().visibleSuggestion?.previewBlocks,
		).toEqual([
			expect.objectContaining({
				text: "Book flights this week.",
				blockType: "paragraph",
			}),
			expect.objectContaining({
				text: "Reserve the hotel before Friday.",
				blockType: "paragraph",
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);

		const secondBlock = editor.getBlock(blockId)?.next;
		const thirdBlock = secondBlock?.next;
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"Trip plan with notes",
		);
		expect(secondBlock?.type).toBe("paragraph");
		expect(secondBlock?.textContent()).toBe("Book flights this week.");
		expect(thirdBlock?.type).toBe("paragraph");
		expect(thirdBlock?.textContent()).toBe(
			"Reserve the hotel before Friday.",
		);

		editor.destroy();
	});

	it("converts deep single-line prose continuations into appended paragraph blocks", async () => {
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
									delta: " find his family waiting for him.",
								};
								yield { type: "done" as const };
								return;
							}
							if (callCount === 2) {
								yield {
									type: "text-delta" as const,
									delta: ", but they were not the welcoming party he had expected. Instead, he found them in a state of distress, with worried expressions on their faces.",
								};
								yield { type: "done" as const };
								return;
							}
							yield {
								type: "text-delta" as const,
								delta: ' He approached them cautiously, his heart beginning to pound. "What happened?" he asked, scanning each of their faces for answers. For a moment, no one spoke, and the silence made the room feel even heavier. Then his mother stepped forward and told him everything that had changed while he was away.',
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
				insert: "He came home to",
			},
		]);
		editor.selectText(blockId, 16, 16);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" find his family waiting for him.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion
					?.getState()
					.visibleSuggestion?.text?.includes("welcoming party") ===
				true,
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() =>
				(inlineCompletion?.getState().visibleSuggestion?.previewBlocks
					?.length ?? 0) > 0,
		);

		expect(
			inlineCompletion?.getState().visibleSuggestion?.previewBlocks,
		).toEqual([
			expect.objectContaining({
				text: expect.stringContaining(
					"For a moment, no one spoke, and the silence made the room feel even heavier.",
				),
				blockType: "paragraph",
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);

		const secondBlock = editor.getBlock(blockId)?.next;
		const thirdBlock = secondBlock?.next;
		expect(secondBlock?.type).toBe("paragraph");
		expect(secondBlock?.textContent()).toContain(
			"Instead, he found them in a state of distress, with worried expressions on their faces.",
		);
		expect(secondBlock?.textContent()).toContain(
			'He approached them cautiously, his heart beginning to pound. "What happened?" he asked, scanning each of their faces for answers.',
		);
		expect(thirdBlock?.type).toBe("paragraph");
		expect(thirdBlock?.textContent()).toContain(
			"For a moment, no one spoke, and the silence made the room feel even heavier.",
		);
		expect(thirdBlock?.textContent()).toContain(
			"Then his mother stepped forward and told him everything that had changed while he was away.",
		);

		editor.destroy();
	});
});
