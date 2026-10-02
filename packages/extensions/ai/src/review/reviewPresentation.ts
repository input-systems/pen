import type { Decoration, Editor } from "@input/pen-types";
import type {
	AIExtensionConfig,
	AISession,
	AIStreamingReviewPreview,
	GenerationState,
} from "../types";
import {
	buildContextDecorations,
	shouldShowSelectionContext,
} from "./contextDecorations";
import { resolveAIReviewPresentationState } from "./reviewPresentationState";
import {
	collectSuggestionDecorations,
	type SuggestionInlineRange,
} from "./suggestionDecorations";
import { buildStreamingReviewPreviewDecorations } from "./streamingPreviewDecorations";

export {
	buildStreamingReviewPreviewDecorations,
	resolveAIReviewPresentationState,
};

export function buildAIReviewPresentationDecorations({
	activeGeneration,
	activeSessionId,
	editor,
	sessions,
	suggestionPresentation,
	streamingReviewPreviews,
	suggestions,
}: {
	activeGeneration?: GenerationState | null;
	activeSessionId: string | null | undefined;
	editor: Editor;
	sessions: readonly AISession[];
	suggestionPresentation: NonNullable<
		AIExtensionConfig["suggestionPresentation"]
	>;
	streamingReviewPreviews?: readonly AIStreamingReviewPreview[];
	/**
	 * Suggestion state from the scoped index. When given, suggestion
	 * decorations come from the review source and are not rebuilt here.
	 */
	suggestions?: {
		readonly hasSuggestions: boolean;
		readonly rangesByBlock: Map<string, SuggestionInlineRange[]>;
	};
}): Decoration[] {
	const activeSession =
		sessions.find((session) => session.id === activeSessionId) ?? null;
	const {
		decorations: suggestionDecorations,
		suggestionRangesByBlock,
		hasSuggestions,
	} = suggestions
		? {
				decorations: [],
				suggestionRangesByBlock: suggestions.rangesByBlock,
				hasSuggestions: suggestions.hasSuggestions,
			}
		: collectSuggestionDecorations(editor, suggestionPresentation);

	const reviewState = resolveAIReviewPresentationState({
		activeGeneration,
		activeSession,
		hasSuggestions,
	});
	// A preview belongs to a turn, and a turn does not always have a session:
	// chat prompts run a generation with no session row at all. Asking for one
	// here meant the surface most edits arrive through built its preview and
	// then dropped it, so the edit only ever appeared as the finished replace.
	// The controller stamps the preview with `sessionId ?? id`; read it back
	// the same way rather than through a row that may not exist.
	const streamingPreviewOwnerId =
		activeGeneration != null
			? (activeGeneration.sessionId ?? activeGeneration.id)
			: (activeSession?.id ?? null);
	// Every operation of the streaming call is on screen at once: one has
	// finished arriving while the next is still coming, and neither is written
	// until the call closes (EC15).
	const activePreviews =
		streamingPreviewOwnerId == null
			? []
			: (streamingReviewPreviews ?? []).filter(
					(preview) => preview.sessionId === streamingPreviewOwnerId,
				);
	const hasActiveStreamingReviewPreview = activePreviews.length > 0;
	const contextDecorations = shouldShowSelectionContext({
		hasActiveStreamingReviewPreview,
		hasSuggestions,
		suggestionPresentation,
	})
		? buildContextDecorations({
				activeSession,
				editor,
				reviewState,
				suggestionRangesByBlock,
			})
		: [];
	const previewDecorations = activePreviews.flatMap((preview) =>
		buildStreamingReviewPreviewDecorations({
			editor,
			preview,
			suggestionPresentation,
		}),
	);

	return [
		...suggestionDecorations,
		...contextDecorations,
		...previewDecorations,
	];
}
