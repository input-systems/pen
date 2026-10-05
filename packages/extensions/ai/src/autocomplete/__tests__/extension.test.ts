import { describe, expect, it } from "vitest";
import { createEditor, getInlineCompletionController } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import {
	autocompleteExtension,
	createAutocompleteProvider,
	getAutocompleteController,
} from "../index";
import { fieldEditorSlot, waitForCondition } from "./extension.testHelpers";

describe("@input/pen-ai/autocomplete", () => {
	it("includes registered provider context in autocomplete prompts", async () => {
		let firstPrompt = "";
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					providers: [
						createAutocompleteProvider({
							id: "route-hint",
							describe: () => ({
								id: "route-hint",
								description:
									"Adds the current route to autocomplete context",
								kind: "consumer",
							}),
							provide: () => "route=/settings/profile",
						}),
					],
					model: {
						async *stream(options) {
							if (!firstPrompt) {
								firstPrompt = String(
									options.messages[1]?.content ?? "",
								);
							}
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
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(() => firstPrompt.length > 0);

		expect(firstPrompt).toContain('prefix="Hello"');
		expect(firstPrompt).toContain("[provider:route-hint]");
		expect(firstPrompt).toContain("route=/settings/profile");
		expect(
			controller
				?.listProviderDescriptors()
				.some((descriptor) => descriptor.id === "route-hint"),
		).toBe(true);
		expect(controller?.getState().metrics.requestCount).toBe(1);
		expect(controller?.getState().metrics.successCount).toBe(1);
		expect(controller?.getState().metrics.explicitTabTriggerCount).toBe(1);
		expect(controller?.getState().providerTimings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "route-hint",
					chars: "route=/settings/profile".length,
				}),
			]),
		);

		editor.destroy();
	});

	it("strips echoed prefix text from end-of-block completions", async () => {
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
								delta: "print('hello')",
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
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "pri" },
		]);
		editor.selectText(blockId, 3, 3);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				"nt('hello')",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("print('hello')");

		editor.destroy();
	});

	it("strips wrapped quotes and stray leading punctuation from prose completions", async () => {
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
								delta: '", tired from a long day at work, but happy to be back."',
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
				"tired from a long day at work, but happy to be back.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"He came home tired from a long day at work, but happy to be back.",
		);

		editor.destroy();
	});

	it("keeps short but meaningful single-word prose continuations", async () => {
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
								delta: "cat",
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
				insert: "The ",
			},
		]);
		editor.selectText(blockId, 4, 4);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text === "cat",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("The cat");

		editor.destroy();
	});

	it("drops stray continuation commas after sentence-ending punctuation", async () => {
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
								delta: ", but happy to be back.",
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
				insert: "He came home.",
			},
		]);
		editor.selectText(blockId, 13, 13);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" But happy to be back.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"He came home. But happy to be back.",
		);

		editor.destroy();
	});

	it("capitalizes prose continuations after sentence-ending punctuation", async () => {
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
								delta: "so he decided to relax by watching some TV.",
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
				insert: "He came home tired from a long day at work. ",
			},
		]);
		editor.selectText(blockId, 44, 44);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				"So he decided to relax by watching some TV.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"He came home tired from a long day at work. So he decided to relax by watching some TV.",
		);

		editor.destroy();
	});
});
