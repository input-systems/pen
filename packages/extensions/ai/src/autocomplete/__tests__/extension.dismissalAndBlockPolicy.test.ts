import { describe, expect, it } from "vitest";
import { createEditor, getInlineCompletionController } from "@input/pen-core";
import { FIELD_EDITOR_SLOT_KEY } from "@input/pen-types";
import { defineExtension } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { autocompleteExtension, getAutocompleteController } from "../index";
import { waitForCondition } from "./extension.testHelpers";

describe("@input/pen-ai/autocomplete: dismissal and block policy", () => {
	it("dismisses visible suggestions when the selection changes after showing", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
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
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							fieldEditor,
						);
					},
					deactivateClient: async () => {
						activeEditor?.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							null,
						);
						activeEditor = null;
					},
				}),
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

		editor.selectText(blockId, 0, 0);

		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"selection-change",
		);

		editor.destroy();
	});

	it("keeps visible suggestions when selection-change keeps the same caret", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
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
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							fieldEditor,
						);
					},
					deactivateClient: async () => {
						activeEditor?.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							null,
						);
						activeEditor = null;
					},
				}),
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

		editor.selectText(blockId, 5, 5);

		expect(inlineCompletion?.getState().visibleSuggestion?.text).toBe(
			" world from pen",
		);
		expect(controller?.getState().visibleSuggestionId).not.toBeNull();
		expect(controller?.getState().status).toBe("showing");

		editor.destroy();
	});

	it("drops stale results and records the stale dismissal reason", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					staleAfterMs: 1,
					model: {
						async *stream() {
							await new Promise((resolve) =>
								setTimeout(resolve, 5),
							);
							yield {
								type: "text-delta" as const,
								delta: " world from pen",
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							fieldEditor,
						);
					},
					deactivateClient: async () => {
						activeEditor?.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							null,
						);
						activeEditor = null;
					},
				}),
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
		await waitForCondition(
			() => controller?.getState().metrics.staleDropCount === 1,
		);

		expect(controller?.getState().visibleSuggestionId).toBeNull();
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"stale",
		);

		editor.destroy();
	});

	it("blocks requests in code blocks when the block policy disables them", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let modelCalled = false;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
			activeCellCoord: null,
		};
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					blockPolicy: {
						allowInCodeBlocks: false,
					},
					model: {
						async *stream() {
							modelCalled = true;
							yield {
								type: "text-delta" as const,
								delta: " never runs",
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							fieldEditor,
						);
					},
					deactivateClient: async () => {
						activeEditor?.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							null,
						);
						activeEditor = null;
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const codeBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "insert-block",
				blockId: codeBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: codeBlockId,
				from: 0,
				to: 0,
				insert: "const answer =",
			},
		]);
		fieldEditor.focusBlockId = codeBlockId;
		editor.selectText(codeBlockId, 14, 14);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(false);
		expect(modelCalled).toBe(false);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"code-block-disabled",
		);

		editor.destroy();
	});

	it("respects allowed block type policies before scheduling a request", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let modelCalled = false;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
			activeCellCoord: null,
		};
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					blockPolicy: {
						allowedBlockTypes: ["heading"],
					},
					model: {
						async *stream() {
							modelCalled = true;
							yield {
								type: "text-delta" as const,
								delta: " blocked",
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							fieldEditor,
						);
					},
					deactivateClient: async () => {
						activeEditor?.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							null,
						);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(false);
		expect(modelCalled).toBe(false);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"block-type-not-allowed",
		);

		editor.destroy();
	});

	it("updates block policy at runtime without recreating the controller", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let modelCalled = false;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
			activeCellCoord: null,
		};
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					blockPolicy: {
						allowInCodeBlocks: false,
					},
					model: {
						async *stream() {
							modelCalled = true;
							yield {
								type: "text-delta" as const,
								delta: " value",
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							fieldEditor,
						);
					},
					deactivateClient: async () => {
						activeEditor?.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							null,
						);
						activeEditor = null;
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const codeBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "insert-block",
				blockId: codeBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: codeBlockId,
				from: 0,
				to: 0,
				insert: "const answer =",
			},
		]);
		fieldEditor.focusBlockId = codeBlockId;
		editor.selectText(codeBlockId, 14, 14);

		const controller = getAutocompleteController(editor);
		expect(controller?.getState().blockPolicy.allowInCodeBlocks).toBe(
			false,
		);
		expect(controller?.request({ explicit: true })).toBe(false);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"code-block-disabled",
		);

		controller?.updateBlockPolicy({ allowInCodeBlocks: true });
		expect(controller?.getState().blockPolicy.allowInCodeBlocks).toBe(true);
		expect(controller?.getBlockPolicy().allowInCodeBlocks).toBe(true);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(() => modelCalled);

		editor.destroy();
	});
});
