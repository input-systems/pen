import {
	aiAutocompleteControllerFacet,
	aiControllerFacet,
	aiInlineHistoryFacet,
	aiReviewControllerFacet,
	beforeApplyFacet,
	createDecorationSet,
	decorationsFacet,
	keyBindingPriorityToPrecedence,
	keymapFacet,
	scopedDecorationSource,
	summaryTouchedBlockIds,
	ensureInlineCompletionController,
	getInlineCompletionController,
	getOpOriginType,
} from "@input/pen-core";
import type {
	Editor,
	Extension,
	FacetProvider,
	KeyBinding,
} from "@input/pen-types";
import {
	AI_CONTROLLER_SLOT,
	AI_INLINE_HISTORY_SLOT,
	AI_REVIEW_CONTROLLER_SLOT,
} from "@input/pen-types";
import { defineExtension } from "@input/pen-core";
import { SuggestionDecorationIndex } from "./review/suggestionIndex";
import {
	AI_SESSION_SUGGESTION_ORIGIN,
	shouldBypassSuggestMode,
	SUGGESTION_RESOLUTION_ORIGIN,
	transformOpsForSuggestMode,
} from "./suggestions/suggestMode";
import type {
	AIController,
	AIExtensionConfig,
	AIInlineCompletionController,
	AIInlineHistoryController,
	AIReviewController,
} from "./types";
import { AIControllerImpl } from "./controller/aiController";
import { readModelId } from "./helpers";

export const AI_EXTENSION_NAME = "ai";

const AI_SHORTCUT_KEY_BINDINGS: readonly KeyBinding[] = [
	{
		key: "Mod-z",
		priority: 1000,
		description: "pen.ai.shortcut.undoInline",
		handler: (editor) => {
			const inlineHistory = getAIInlineHistoryController(editor);
			if (!inlineHistory?.canHandleShortcut("undo")) {
				return false;
			}
			return inlineHistory.handleShortcut("undo");
		},
	},
	{
		key: "Mod-Shift-z",
		priority: 1000,
		description: "pen.ai.shortcut.redoInline",
		handler: (editor) => {
			const inlineHistory = getAIInlineHistoryController(editor);
			if (!inlineHistory?.canHandleShortcut("redo")) {
				return false;
			}
			return inlineHistory.handleShortcut("redo");
		},
	},
	{
		key: "Ctrl-y",
		priority: 1000,
		description: "pen.ai.shortcut.redoInline",
		handler: (editor) => {
			const inlineHistory = getAIInlineHistoryController(editor);
			if (!inlineHistory?.canHandleShortcut("redo")) {
				return false;
			}
			return inlineHistory.handleShortcut("redo");
		},
	},
];

export function aiExtension(config: AIExtensionConfig = {}): Extension {
	let unsubscribeTrackedOrigins: (() => void) | null = null;
	let controller: AIControllerImpl | null = null;
	let inlineCompletion: AIInlineCompletionController | null = null;
	let releaseInlineCompletion: (() => void) | null = null;
	let inlineHistory: AIInlineHistoryController | null = null;
	let activeEditor: Editor | null = null;

	// Suggestion decorations are scoped (SCALE2): a commit re-reads suggestion
	// marks and block meta only on the blocks it touched. Presentation is fixed
	// per config, so nothing else asks for a full re-read.
	const suggestionIndex = new SuggestionDecorationIndex(
		config.suggestionPresentation ?? "track-changes",
	);
	const reviewSuggestionSource = scopedDecorationSource({
		interest: ({ summary }) => summaryTouchedBlockIds(summary),
		decorate: (blockIds, editor) => suggestionIndex.refresh(editor, blockIds),
	});

	return defineExtension({
		name: AI_EXTENSION_NAME,
		dependencies: ["tools", "delta-stream", "undo"],
		facets: [
			...aiKeymapProviders(AI_SHORTCUT_KEY_BINDINGS),
			beforeApplyFacet.of((ops, options) => {
				if (!controller?.getState().suggestMode) {
					return ops;
				}
				if (shouldBypassSuggestMode(options.origin)) {
					return ops;
				}
				const editor = activeEditor;
				if (!editor) {
					return ops;
				}
				const originType = options.origin
					? getOpOriginType(options.origin)
					: undefined;
				return transformOpsForSuggestMode(
					ops,
					editor,
					originType === "ai"
						? "assistant"
						: (config.author ?? "user"),
					originType === "ai" ? "ai" : "user",
					readModelId(config.model),
					undefined,
					{ origin: options.origin },
				);
			}, "high"),
			decorationsFacet.of(reviewSuggestionSource),
			decorationsFacet.of(() => {
				const decorations =
					controller?.buildPresentationDecorations(suggestionIndex) ?? [];
				const inlineDecorations =
					activeEditor?.facet(aiAutocompleteControllerFacet) == null
						? (inlineCompletion?.buildDecorations() ?? [])
						: [];
				return createDecorationSet([
					...decorations,
					...inlineDecorations,
				]);
			}),
		],

		activateClient: async ({ editor }) => {
			activeEditor = editor;
			const inlineCompletionRegistration =
				ensureInlineCompletionController(editor);
			inlineCompletion = inlineCompletionRegistration.controller;
			releaseInlineCompletion = inlineCompletionRegistration.release;
			controller = new AIControllerImpl(editor, config, {
				inlineCompletion,
			});
			inlineHistory = {
				canUndoInlineHistory: () =>
					controller ? controller.canUndoInlineHistory() : false,
				canRedoInlineHistory: () =>
					controller ? controller.canRedoInlineHistory() : false,
				canHandleShortcut: (direction) =>
					controller
						? controller.canHandleInlineHistoryShortcut(direction)
						: false,
				handleShortcut: (direction) =>
					controller
						? controller.handleInlineHistoryShortcut(direction)
						: false,
				undoInlineHistory: () =>
					controller ? controller.undoInlineHistory() : false,
				redoInlineHistory: () =>
					controller ? controller.redoInlineHistory() : false,
			};
			editor.internals.assignSlot(AI_CONTROLLER_SLOT, controller);
			editor.internals.assignSlot(AI_INLINE_HISTORY_SLOT, inlineHistory);
			editor.internals.assignSlot(AI_REVIEW_CONTROLLER_SLOT, controller);
			unsubscribeTrackedOrigins =
				editor.undoManager.registerTrackedOrigins([
					AI_SESSION_SUGGESTION_ORIGIN,
					SUGGESTION_RESOLUTION_ORIGIN,
				]);
		},

		deactivateClient: async () => {
			controller?.cancelActiveGeneration();
			controller?.destroy();
			activeEditor?.internals.assignSlot(AI_CONTROLLER_SLOT, null);
			activeEditor?.internals.assignSlot(AI_INLINE_HISTORY_SLOT, null);
			activeEditor?.internals.assignSlot(AI_REVIEW_CONTROLLER_SLOT, null);
			releaseInlineCompletion?.();
			unsubscribeTrackedOrigins?.();
			unsubscribeTrackedOrigins = null;
			controller = null;
			suggestionIndex.clear();
			inlineCompletion = null;
			releaseInlineCompletion = null;
			inlineHistory = null;
			activeEditor = null;
		},

		observe: (events, editor) => {
			if (!controller) {
				editor.requestDecorationUpdate();
				return;
			}
			controller.handleDocumentChange(events);
		},
	});
}

export function getAIController(editor: Editor): AIController | null {
	return (editor.facet(aiControllerFacet) as AIController | null) ?? null;
}

export function getAIInlineCompletionController(
	editor: Editor,
): AIInlineCompletionController | null {
	return getInlineCompletionController(editor);
}

export function getAIInlineHistoryController(
	editor: Editor,
): AIInlineHistoryController | null {
	return (
		(editor.facet(
			aiInlineHistoryFacet,
		) as AIInlineHistoryController | null) ?? null
	);
}

export function getAIReviewController(
	editor: Editor,
): AIReviewController | null {
	return (
		(editor.facet(aiReviewControllerFacet) as AIReviewController | null) ??
		null
	);
}

function aiKeymapProviders(
	bindings: readonly KeyBinding[],
): readonly FacetProvider[] {
	return bindings.map((binding) =>
		keymapFacet.of(
			[binding],
			keyBindingPriorityToPrecedence(binding.priority ?? 300),
		),
	);
}

