import { describe, expect, it } from "vitest";
import { createEditor, getInlineCompletionController } from "@input/pen-core";
import {
	AI_AUTOCOMPLETE_CONTROLLER_SLOT,
	FIELD_EDITOR_SLOT_KEY,
} from "@input/pen-types";
import { defineExtension } from "@input/pen-core";
import { aiExtension } from "@input/pen-ai";
import {
	handleFieldEditorKeyDown,
} from "@input/pen-dom/field-editor/keyHandling";
import {
	createFieldEditorMock,
	createKeyEvent,
	createPresetEditor,
	getYText,
} from "./utils/keyHandlingTestHelpers";

describe("@input/pen-react field editor Tab handling: list nesting and autocomplete", () => {
	it("handles Tab for list nesting and preserves selection", () => {
		const editor = createPresetEditor({
			preset: {
				tools: false,
				deltaStream: false,
				undo: false,
				shortcuts: false,
			},
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "set-props",
				blockId: firstBlockId,
				props: { type: "bulletListItem" },
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "bulletListItem",
				props: { indent: 0 },
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: secondBlockId,
				from: 0,
				to: 0,
				insert: "child",
			},
		]);

		const fieldEditor = createFieldEditorMock(secondBlockId);
		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("Tab"),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, secondBlockId),
			range: { start: 2, end: 2 },
		});

		expect(handled).toBe(true);
		expect(editor.getBlock(secondBlockId)?.props.indent).toBe(1);
		expect(fieldEditor.activations).toEqual([
			{ blockId: secondBlockId, anchorOffset: 2, focusOffset: 2 },
		]);

		editor.destroy();
	});

	it("does not handle Tab when a top-level list item cannot nest deeper", () => {
		const editor = createPresetEditor({
			preset: {
				tools: false,
				deltaStream: false,
				undo: false,
				shortcuts: false,
			},
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "set-props", blockId, props: { type: "bulletListItem" } },
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "root" },
		]);

		const fieldEditor = createFieldEditorMock(blockId);
		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("Tab"),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, blockId),
			range: { start: 4, end: 4 },
		});

		expect(handled).toBe(false);
		expect(editor.getBlock(blockId)?.props.indent).toBe(0);
		expect(fieldEditor.activations).toEqual([]);

		editor.destroy();
	});

	it("triggers explicit autocomplete when no inline suggestion is visible", () => {
		let requestCount = 0;
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const editor = createPresetEditor({
			preset: {
				shortcuts: false,
			},
			extensions: [
				defineExtension({
					name: "test-autocomplete-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.assignSlot(
							AI_AUTOCOMPLETE_CONTROLLER_SLOT,
							{
								getState: () => ({
									enabled: true,
									status: "idle",
									activeRequestId: null,
									visibleSuggestionId: null,
									settings: {
										debounceMs: 0,
										prefetchAfterAccept: false,
										acceptanceStrategy: "full" as const,
										staleAfterMs: 0,
									},
									metrics: {
										requestCount: 0,
										successCount: 0,
										cancelCount: 0,
										staleDropCount: 0,
										explicitTabTriggerCount: 0,
										acceptCount: 0,
										policyInvalidationScheduledCount: 0,
										policyInvalidationRequestingCount: 0,
										policyInvalidationShowingCount: 0,
									},
									providerTimings: [],
									diagnostics: {
										lastDismissReason: null,
										lastBlockedReason: null,
										lastPolicyInvalidationStage: null,
									},
								}),
								subscribe: () => () => {},
								request: (options?: { explicit?: boolean }) => {
									requestCount += 1;
									return options?.explicit === true;
								},
								acceptVisibleSuggestion: () => false,
								hasVisibleSuggestion: () => false,
								registerProvider: () => () => {},
								listProviderDescriptors: () => [],
								updateRuntimeSettings: () => {},
								dismiss: () => {},
								setEnabled: () => {},
							},
						);
					},
					deactivateClient: async () => {
						activeEditor?.internals.assignSlot(
							AI_AUTOCOMPLETE_CONTROLLER_SLOT,
							null,
						);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "root" },
		]);

		const fieldEditor = createFieldEditorMock(blockId);
		let prevented = false;
		const event = {
			...createKeyEvent("Tab"),
			preventDefault() {
				prevented = true;
			},
		} as KeyboardEvent;
		const handled = handleFieldEditorKeyDown({
			event,
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, blockId),
			range: { start: 4, end: 4 },
		});

		expect(handled).toBe(true);
		expect(requestCount).toBe(1);
		expect(prevented).toBe(true);

		editor.destroy();
	});

	it("delegates visible autocomplete suggestions to segmented acceptance", () => {
		let acceptVisibleSuggestionCount = 0;
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const editor = createPresetEditor({
			preset: {
				shortcuts: false,
			},
			extensions: [
				aiExtension(),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.assignSlot(FIELD_EDITOR_SLOT_KEY, {
							focusBlockId: null,
							isEditing: true,
							isFocused: true,
							isComposing: false,
						});
						nextEditor.internals.assignSlot(
							AI_AUTOCOMPLETE_CONTROLLER_SLOT,
							{
								getState: () => ({
									enabled: true,
									status: "showing",
									activeRequestId: "request-1",
									visibleSuggestionId: "suggestion-1",
									settings: {
										debounceMs: 0,
										prefetchAfterAccept: false,
										acceptanceStrategy: "full" as const,
										staleAfterMs: 0,
									},
									metrics: {
										requestCount: 0,
										successCount: 0,
										cancelCount: 0,
										staleDropCount: 0,
										explicitTabTriggerCount: 0,
										acceptCount: 0,
										policyInvalidationScheduledCount: 0,
										policyInvalidationRequestingCount: 0,
										policyInvalidationShowingCount: 0,
									},
									providerTimings: [],
									diagnostics: {
										lastDismissReason: null,
										lastBlockedReason: null,
										lastPolicyInvalidationStage: null,
									},
								}),
								subscribe: () => () => {},
								request: () => false,
								acceptVisibleSuggestion: () => {
									acceptVisibleSuggestionCount += 1;
									return true;
								},
								hasVisibleSuggestion: () => true,
								registerProvider: () => () => {},
								listProviderDescriptors: () => [],
								updateRuntimeSettings: () => {},
								dismiss: () => {},
								setEnabled: () => {},
							},
						);
					},
					deactivateClient: async () => {
						activeEditor?.internals.assignSlot(
							FIELD_EDITOR_SLOT_KEY,
							null,
						);
						activeEditor?.internals.assignSlot(
							AI_AUTOCOMPLETE_CONTROLLER_SLOT,
							null,
						);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = createFieldEditorMock(blockId);
		const inlineCompletion = getInlineCompletionController(editor);
		inlineCompletion?.showSuggestion({
			id: "suggestion-1",
			blockId,
			offset: 0,
			text: "ghost",
			type: "inline",
		});

		let prevented = false;
		const event = {
			...createKeyEvent("Tab"),
			preventDefault() {
				prevented = true;
			},
		} as KeyboardEvent;
		const handled = handleFieldEditorKeyDown({
			event,
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, blockId),
			range: { start: 0, end: 0 },
		});

		expect(handled).toBe(true);
		expect(acceptVisibleSuggestionCount).toBe(1);
		expect(prevented).toBe(true);

		editor.destroy();
	});
});
