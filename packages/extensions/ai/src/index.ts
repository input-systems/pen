// getAIInlineCompletionController is the AI-package accessor.
// @input/pen-core already publishes getInlineCompletionController.
export {
	aiExtension,
	AI_EXTENSION_NAME,
	getAIController,
	getAIInlineCompletionController,
	getAIInlineHistoryController,
	getAIReviewController,
} from "./extension";

export { runAgenticLoop } from "./agentic/loop";
export { AI_TOOL_RESULT_MAX_CHARS } from "./runtime/stepJournal";
export {
	aiEgressFacet,
	aiEgressExtension,
	filterAIRequest,
	streamThroughEgress,
	AI_FEATURE_CONTENT,
	AI_EGRESS_INVENTORY_CODE,
	AI_REQUEST_REFUSED_CODE,
} from "./egress";
export { AICommandRegistry } from "./commands/registry";
export { defaultAICommands } from "./commands/defaultCommands";
export { AI_TARGET_KINDS } from "./runtime/contracts";
export type { AIMutationPreference, AITargetKind } from "./runtime/contracts";
export {
	acceptSuggestion,
	rejectSuggestion,
	acceptSuggestions,
	rejectSuggestions,
	acceptAllSuggestions,
	rejectAllSuggestions,
} from "./suggestions/acceptReject";
export {
	readAllSuggestions,
	readSuggestionsFromBlock,
	readBlockSuggestionMeta,
	createSuggestionMark,
} from "./suggestions/persistent";
export {
	AI_SESSION_SUGGESTION_ORIGIN,
	SUGGESTION_RESOLUTION_ORIGIN,
} from "./suggestions/suggestMode";
export { applySuggestedAIOperations } from "./suggestions/applySuggestedAIOperations";

export type {
	AIExtensionConfig,
	AIEditStreaming,
	AIStatus,
	AIContextualPromptAnchor,
	AIContextualPromptAnchorKind,
	AIContextualPromptAnchorStatus,
	AIContextualPromptComposerState,
	AIContextualPromptRect,
	AIContextualPromptState,
	AISession,
	AISessionAnchor,
	AIStreamingReviewPreview,
	AIStreamingReviewPreviewInput,
	AIStreamingReviewPreviewTarget,
	AISessionMetrics,
	AISessionCommitMetrics,
	AISessionPrompt,
	AISessionStatus,
	AISessionTarget,
	AISurface,
	AIAwarenessState,
	AIExternalInlineTurnResult,
	AgenticStep,
	GenerationState,
	EphemeralSuggestion,
	PersistentSuggestion,
	PersistentTextSuggestion,
	PersistentBlockSuggestion,
	BlockSuggestion,
	BlockSuggestionMeta,
	AICommandBinding,
	AICommandContext,
	AICommandGuard,
	AICommandExecutionOptions,
	AIControllerState,
	AIController,
	AIInlineCompletionState,
	AIInlineCompletionController,
	AIInlineHistoryDirection,
	AIInlineHistoryController,
	AIReviewController,
	AIPromptTarget,
	AISessionResolution,
	AIContentFormatOptions,
	AISuggestionPresentation,
	GenerationTargetKind,
	StructuredGenerationDebugState,
	CommitDebugState,
	AIWorkingSetRetrievedSpan,
	AIStreamEvent,
	AIStreamEventType,
	AIMutationReceipt,
	AIMutationReceiptEvidence,
	AIMutationReceiptStatus,
} from "./types";
export type {
	ApplySuggestedAIOperationsOptions,
	ApplySuggestedAIOperationsResult,
} from "./suggestions/applySuggestedAIOperations";

/** Class vocabulary for the review surface (RS4). */
export { REVIEW_SURFACE_CLASSES } from "@input/pen-types";
/** Per-action block-suggestion class vocabulary (RS4). */
export { REVIEW_SURFACE_BLOCK_SUGGESTION_CLASSES } from "@input/pen-types";
/** Theme custom properties for the review surface (RS4). */
export { REVIEW_SURFACE_CUSTOM_PROPERTIES } from "@input/pen-types";
