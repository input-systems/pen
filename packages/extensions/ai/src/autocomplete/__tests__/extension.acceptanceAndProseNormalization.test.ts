import { describe, expect, it } from "vitest";
import { createEditor, getInlineCompletionController } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { autocompleteExtension, getAutocompleteController } from "../index";
import { fieldEditorSlot, waitForCondition } from "./extension.testHelpers";

describe("@input/pen-ai/autocomplete: acceptance and prose normalization", () => {
	it("accepts the whole visible suggestion and places the caret at the end", async () => {
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
								delta: " world from pen",
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
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller).toBeTruthy();
		expect(inlineCompletion).toBeTruthy();

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
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: {
				blockId,
				offset: 20,
			},
		});
		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();
		editor.destroy();
	});

	it("anchors end-of-line suggestions to the previous character for rendering", async () => {
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
								delta: " world!",
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
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" world!",
		);

		expect(inlineCompletion?.buildDecorations()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "inline",
					blockId,
					from: 4,
					to: 5,
					attributes: expect.objectContaining({
						"data-suggestion-placement": "after",
					}),
				}),
			]),
		);

		editor.destroy();
	});

	it("adds a separating space to prose suggestions when the model omits it", async () => {
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
								delta: "today, with more detail",
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
				insert: "Hello there",
			},
		]);
		editor.selectText(blockId, 11, 11);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" today, with more detail",
		);

		editor.destroy();
	});

	it("does not split a short partial word when normalizing prose suggestions", async () => {
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
								delta: "nd timeline",
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
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "a" },
		]);
		editor.selectText(blockId, 1, 1);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				"nd timeline",
		);

		editor.destroy();
	});

	it("rejects tiny single-word prose suggestions", async () => {
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "go" };
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
				insert: "Hello there",
			},
		]);
		editor.selectText(blockId, 11, 11);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(() => controller?.getState().status === "idle");

		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();
		expect(controller?.getState().visibleSuggestionId).toBeNull();

		editor.destroy();
	});

	it("accepts the full remaining completion in one step when full acceptance is enabled", async () => {
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					acceptanceStrategy: "full",
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: " world from pen",
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
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" world from pen",
		);

		expect(controller?.getState().settings.acceptanceStrategy).toBe("full");
		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"Hello world from pen",
		);
		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();
		expect(controller?.getState().metrics.acceptCount).toBe(1);

		editor.destroy();
	});

	it("keeps scheduled requests alive across selection sync events", async () => {
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 10,
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: " world from pen",
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
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request()).toBe(true);
		expect(controller?.getState().status).toBe("scheduled");

		editor.selectText(blockId, 5, 5);

		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" world from pen",
		);
		expect(controller?.getState().metrics.successCount).toBe(1);

		editor.destroy();
	});
});
