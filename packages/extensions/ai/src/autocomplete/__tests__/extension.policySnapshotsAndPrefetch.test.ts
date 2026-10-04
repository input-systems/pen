import { describe, expect, it } from "vitest";
import { createEditor, getInlineCompletionController } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { autocompleteExtension, getAutocompleteController } from "../index";
import { fieldEditorSlot, waitForCondition } from "./extension.testHelpers";

describe("@input/pen-ai/autocomplete: policy snapshots and prefetch", () => {
	it("returns defensive block policy snapshots from both getters", () => {
		const { extension: fieldEditorSlotExtension } = fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					blockPolicy: {
						allowedBlockTypes: ["paragraph"],
						deniedBlockTypes: ["codeBlock"],
					},
				}),
				fieldEditorSlotExtension,
			],
		});

		const controller = getAutocompleteController(editor);
		const snapshot = controller?.getBlockPolicy();
		const stateSnapshot = controller?.getState();
		expect(snapshot).toEqual({
			allowInCodeBlocks: true,
			allowInTables: false,
			allowedBlockTypes: ["paragraph"],
			deniedBlockTypes: ["codeBlock"],
		});

		expect(() => {
			if (snapshot?.allowedBlockTypes) {
				(snapshot.allowedBlockTypes as string[]).push("heading");
			}
		}).toThrow();
		expect(() => {
			if (stateSnapshot?.blockPolicy.allowedBlockTypes) {
				(stateSnapshot.blockPolicy.allowedBlockTypes as string[]).push(
					"callout",
				);
			}
		}).toThrow();

		expect(controller?.getBlockPolicy().allowedBlockTypes).toEqual([
			"paragraph",
		]);
		expect(controller?.getState().blockPolicy.allowedBlockTypes).toEqual([
			"paragraph",
		]);
		expect(
			stateSnapshot?.diagnostics.lastPolicyInvalidationStage,
		).toBeNull();
		expect(stateSnapshot?.metrics.policyInvalidationScheduledCount).toBe(0);

		editor.destroy();
	});

	it("returns stable cached snapshots until controller state changes", () => {
		const { extension: fieldEditorSlotExtension } = fieldEditorSlot();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					blockPolicy: {
						allowedBlockTypes: ["paragraph"],
					},
				}),
				fieldEditorSlotExtension,
			],
		});

		const controller = getAutocompleteController(editor);
		const firstSnapshot = controller?.getSnapshot();
		const secondSnapshot = controller?.getSnapshot();
		const firstState = controller?.getState();
		const secondState = controller?.getState();
		const firstPolicy = controller?.getBlockPolicy();
		const secondPolicy = controller?.getBlockPolicy();
		const firstProviders = controller?.listProviderDescriptors();
		const secondProviders = controller?.listProviderDescriptors();

		expect(firstSnapshot).toBe(secondSnapshot);
		expect(firstState).toBe(secondState);
		expect(firstPolicy).toBe(secondPolicy);
		expect(firstProviders).toBe(secondProviders);
		expect(firstSnapshot?.state).toBe(firstState);
		expect(firstSnapshot?.state.blockPolicy).toBe(firstPolicy);
		expect(firstSnapshot?.providerDescriptors).toBe(firstProviders);

		controller?.updateBlockPolicy({ allowInCodeBlocks: false });

		const thirdSnapshot = controller?.getSnapshot();
		const thirdState = controller?.getState();
		const thirdPolicy = controller?.getBlockPolicy();

		expect(thirdSnapshot).not.toBe(firstSnapshot);
		expect(thirdState).not.toBe(firstState);
		expect(thirdPolicy).not.toBe(firstPolicy);
		expect(thirdSnapshot?.state).toBe(thirdState);
		expect(thirdSnapshot?.state.blockPolicy).toBe(thirdPolicy);
		expect(thirdSnapshot?.providerDescriptors).toBe(firstProviders);
		expect(thirdState?.blockPolicy.allowInCodeBlocks).toBe(false);
		expect(thirdPolicy?.allowInCodeBlocks).toBe(false);

		editor.destroy();
	});

	it("prefetches a continuation after accepting the current suggestion", async () => {
		let callCount = 0;
		const requestModes: Array<string | undefined> = [];
		let secondPrompt = "";
		let thirdPrompt = "";
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
							requestModes.push(options.requestMode);
							if (callCount === 1) {
								yield {
									type: "text-delta" as const,
									delta: " world from pen",
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
									delta: ". Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell.",
								};
								yield { type: "done" as const };
								return;
							}
							if (callCount === 3) {
								thirdPrompt = String(
									options.messages[1]?.content ?? "",
								);
								yield {
									type: "text-delta" as const,
									delta: " The photos alone could fill a journal.\n\nYou should turn the trip into a full essay while the details are still vivid.\n\nStart with the beach at sunset and the best meal of the week.",
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

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				". Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell.",
		);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"Hello world from pen",
		);
		expect(secondPrompt).toContain('prefix="Hello world from pen"');
		expect(secondPrompt).toContain("target_scope=finish-paragraph");
		expect(requestModes).toEqual([
			"inline-autocomplete",
			"inline-autocomplete",
		]);
		expect(inlineCompletion?.getState().visibleSuggestion?.text).toBe(
			". Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" The photos alone could fill a journal.",
		);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"Hello world from pen. Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell.",
		);
		expect(thirdPrompt).toContain(
			'prefix="Hello world from pen. Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell."',
		);
		expect(thirdPrompt).toContain(
			"target_scope=continue-across-paragraphs",
		);
		expect(
			inlineCompletion?.getState().visibleSuggestion?.previewBlocks,
		).toEqual([
			expect.objectContaining({
				text: "You should turn the trip into a full essay while the details are still vivid.",
				blockType: "paragraph",
			}),
			expect.objectContaining({
				text: "Start with the beach at sunset and the best meal of the week.",
				blockType: "paragraph",
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		const secondBlock = editor.getBlock(blockId)?.next;
		const thirdBlock = secondBlock?.next;
		expect(secondBlock).toBeTruthy();
		expect(thirdBlock).toBeTruthy();
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"Hello world from pen. Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell. The photos alone could fill a journal.",
		);
		expect(secondBlock?.textContent()).toBe(
			"You should turn the trip into a full essay while the details are still vivid.",
		);
		expect(thirdBlock?.textContent()).toBe(
			"Start with the beach at sunset and the best meal of the week.",
		);
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: {
				blockId: thirdBlock?.id,
				offset: 61,
			},
		});
		expect(requestModes).toEqual([
			"inline-autocomplete",
			"inline-autocomplete",
			"inline-autocomplete",
		]);
		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();

		editor.destroy();
	});

	it("accepts markdown continuation tails as structured blocks", async () => {
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
								delta: " with a plan\n- Book flights\n- Reserve the hotel",
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
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Trip" },
		]);
		editor.selectText(blockId, 4, 4);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" with a plan",
		);

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
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"Trip with a plan",
		);
		expect(secondBlock?.type).toBe("bulletListItem");
		expect(secondBlock?.textContent()).toBe("Book flights");
		expect(thirdBlock?.type).toBe("bulletListItem");
		expect(thirdBlock?.textContent()).toBe("Reserve the hotel");
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: {
				blockId: thirdBlock?.id,
				offset: 17,
			},
		});

		editor.destroy();
	});
});
