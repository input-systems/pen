import { describe, expect, it } from "vitest";
import { createEditor, getInlineCompletionController } from "@input/pen-core";
import { AI_AUTOCOMPLETE_CONTROLLER_SLOT } from "@input/pen-types";
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

describe("@input/pen-react field editor Tab handling: autocomplete commit", () => {
	it("commits programmatic selection after accepting raw inline completions", () => {
		const editor = createPresetEditor({
			preset: {
				shortcuts: false,
			},
			extensions: [aiExtension()],
		});
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = createFieldEditorMock(blockId);
		const inlineCompletion = getInlineCompletionController(editor);
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);
		inlineCompletion?.showSuggestion({
			id: "suggestion-1",
			blockId,
			offset: 5,
			text: " world",
			type: "inline",
		});

		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("Tab"),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, blockId),
			range: { start: 5, end: 5 },
		});

		expect(handled).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world");
		expect(fieldEditor.programmaticSelections).toEqual([
			{ blockId, anchorOffset: 11, focusOffset: 11 },
		]);

		editor.destroy();
	});

	it("K5: accepts a visible inline completion instead of nesting a list item", () => {
		const editor = createPresetEditor({
			preset: {
				shortcuts: false,
			},
			extensions: [aiExtension()],
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
				insert: "Hello",
			},
		]);
		editor.selectText(secondBlockId, 5, 5);
		const fieldEditor = createFieldEditorMock(secondBlockId);
		getInlineCompletionController(editor)?.showSuggestion({
			id: "suggestion-1",
			blockId: secondBlockId,
			offset: 5,
			text: " world",
			type: "inline",
		});

		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("Tab"),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, secondBlockId),
			range: { start: 5, end: 5 },
		});

		expect(handled).toBe(true);
		expect(editor.getBlock(secondBlockId)?.textContent()).toBe(
			"Hello world",
		);
		expect(editor.getBlock(secondBlockId)?.props.indent).toBe(0);

		editor.destroy();
	});

	it("K5: outdents a list item on Shift-Tab while an inline completion is visible", () => {
		const editor = createPresetEditor({
			preset: {
				shortcuts: false,
			},
			extensions: [aiExtension()],
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
				props: { indent: 1 },
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: secondBlockId,
				from: 0,
				to: 0,
				insert: "Hello",
			},
		]);
		editor.selectText(secondBlockId, 5, 5);
		const fieldEditor = createFieldEditorMock(secondBlockId);
		getInlineCompletionController(editor)?.showSuggestion({
			id: "suggestion-1",
			blockId: secondBlockId,
			offset: 5,
			text: " world",
			type: "inline",
		});

		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("Tab", { shiftKey: true }),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, secondBlockId),
			range: { start: 5, end: 5 },
		});

		expect(handled).toBe(true);
		expect(editor.getBlock(secondBlockId)?.textContent()).toBe("Hello");
		expect(editor.getBlock(secondBlockId)?.props.indent).toBe(0);

		editor.destroy();
	});

	it("dismisses visible autocomplete on typing without handling the key event", () => {
		let dismissReason: string | null = null;
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const editor = createPresetEditor({
			preset: {
				shortcuts: false,
			},
			extensions: [
				defineExtension({
					name: "test-autocomplete-dismiss-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
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
								acceptVisibleSuggestion: () => false,
								hasVisibleSuggestion: () => true,
								registerProvider: () => () => {},
								listProviderDescriptors: () => [],
								updateRuntimeSettings: () => {},
								dismiss: (reason?: string) => {
									dismissReason = reason ?? null;
								},
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
		const fieldEditor = createFieldEditorMock(blockId);

		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("a"),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, blockId),
			range: { start: 0, end: 0 },
		});

		expect(handled).toBe(false);
		expect(dismissReason).toBe("typing");

		editor.destroy();
	});
});
