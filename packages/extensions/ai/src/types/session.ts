import type {
	DocumentOp,
	InlineCompletionController as CoreInlineCompletionController,
	InlineCompletionState as CoreInlineCompletionState,
	ModelAdapter,
	ModelOperationScopedRangeTarget,
	ModelOperationSelectionTarget,
	TextSelection,
} from "@input/pen-types";
import type { AIToolConfirmFn, AIUnconfirmedDestructivePolicy } from "../tools";
import type { EditDocumentPreviewUpdate } from "../runtime/editDocumentPreview";
import type {
	AIMutationMode,
	AIMutationPreference,
	AIRouteLane,
	AIContentFormat,
	AITargetKind,
} from "../runtime/contracts";
import type {
	AICommandBinding,
	AIPromptTarget,
	AIRequestedOperation,
	GenerationDebugState,
	AIMutationReceipt,
} from "./controller";

export interface AIExtensionConfig {
	model?: ModelAdapter;
	suggestMode?: boolean;
	suggestionPresentation?: AISuggestionPresentation;
	commands?: AICommandBinding[];
	maxAgenticSteps?: number;
	allowedMutatingTools?: readonly string[];
	confirm?: AIToolConfirmFn;
	/**
	 * What happens to a destructive tool call when no `confirm` resolver is
	 * installed (AIB3). `"allow"` (default) runs it and emits
	 * `ai-tool-unconfirmed`; `"refuse"` blocks it with the document unchanged —
	 * the setting for a production host that exposes the external tools.
	 */
	unconfirmedDestructive?: AIUnconfirmedDestructivePolicy;
	author?: string;
	contentFormat?: AIContentFormatOptions;
	/**
	 * How AI mutations land by default. "suggestions" (default) stages
	 * track-changes suggestions for hosts with a review UI; "direct"
	 * applies edits to the document immediately.
	 */
	mutationPreference?: AIMutationPreference;
	/**
	 * How much of an `edit_document` call is shown while it streams. Never a
	 * channel, prompt, or schema fork (EC11 / EC15). Default is `"commit"`;
	 * adapters that cannot report partial tool input degrade to `"atomic"`.
	 */
	editStreaming?: AIEditStreaming;
}

/**
 * - `"atomic"`: nothing until the call lands.
 * - `"preview"`: text appears as a decoration; the document is untouched until
 *   the call lands, which is what a host wants when in-flight writes would be
 *   visible to someone else — a collaborator would otherwise watch blocks
 *   arrive and, on a refusal, be retracted (EC20).
 * - `"commit"`: as `"preview"`, plus each block whose structure is settled is
 *   written as it arrives, so headings, lists, and positions are real while
 *   the rest is still coming.
 */
export type AIEditStreaming = "atomic" | "preview" | "commit";

export type AISuggestionPresentation = "track-changes" | "final-text";

export interface AIContentFormatOptions {
	blockGeneration?: AIContentFormat;
	selectionRewrite?: AIContentFormat;
}

export type ResolvedEditTarget =
	| ModelOperationSelectionTarget
	| ModelOperationScopedRangeTarget;

export interface ResolvedEditProposal {
	promptIntent: string;
	target: ResolvedEditTarget;
}

export type AIStatus =
	| "idle"
	| "reading"
	| "thinking"
	| "writing"
	| "tool-calling";

export type AISurface = "inline-edit" | "bottom-chat";

export type AISessionStatus =
	| "idle"
	| "streaming"
	| "paused"
	| "complete"
	| "cancelled"
	| "error";

export type AISessionTarget =
	| {
			kind: "selection";
			selection: TextSelection;
			blockId: string | null;
	  }
	| {
			kind: "block";
			blockId: string;
	  }
	| {
			kind: "document";
	  };

export interface AISessionPrompt {
	id: string;
	prompt: string;
	createdAt: number;
	generationId?: string;
	operation?: AIRequestedOperation;
}

export interface AISessionSelectionSnapshot {
	anchor: { blockId: string; offset: number };
	focus: { blockId: string; offset: number };
	blockRange: string[];
	isMultiBlock: boolean;
}

export interface AIContextualPromptRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

export type AIContextualPromptAnchorKind = "text-range" | "block" | "document";

export type AIContextualPromptAnchorStatus = "valid" | "shifted" | "invalid";

export interface AIContextualPromptAnchor {
	kind: AIContextualPromptAnchorKind;
	selectionSnapshot?: AISessionSelectionSnapshot;
	focusBlockId: string | null;
	status: AIContextualPromptAnchorStatus;
	lastResolvedRect: AIContextualPromptRect | null;
}

export interface AIContextualPromptComposerState {
	draftPrompt: string;
	isOpen: boolean;
	isSubmitting: boolean;
	canSubmitFollowUp: boolean;
	openReason?: "user" | "history";
}

export interface AIContextualPromptState {
	anchor: AIContextualPromptAnchor;
	composer: AIContextualPromptComposerState;
}

export type AISessionTurnStatus =
	| "streaming"
	| "review"
	| "accepted"
	| "rejected"
	| "complete"
	| "cancelled"
	| "error";

export interface AISessionTurn {
	id: string;
	prompt: string;
	createdAt: number;
	undoGroupId?: string;
	generationId?: string;
	target: Exclude<AIPromptTarget, "auto">;
	status: AISessionTurnStatus;
	suggestionIds: string[];
	generatedBlockIds: string[];
	operation?: AIRequestedOperation;
	anchor?: AISessionAnchor;
	selection?: AISessionSelectionSnapshot;
}

export interface AISessionMetrics {
	firstTokenMs?: number;
	totalMs?: number;
	toolMs?: number;
	streamEventCount: number;
	patchCount: number;
	commit: AISessionCommitMetrics;
}

export interface AISessionCommitMetrics {
	attemptCount: number;
	selectionReplacementCount: number;
	scopedReplacementCount: number;
	plainMarkdownCount: number;
	failedCount: number;
}

export interface AISessionAnchor {
	blockId?: string;
	from?: number;
	to?: number;
}

export type AIStreamingReviewPreviewTarget =
	| {
			kind: "text-range";
			blockId: string;
			from: number;
			to: number;
	  }
	| {
			kind: "block-range";
			start: { blockId: string; offset: number };
			end: { blockId: string; offset: number };
			blockIds: string[];
	  }
	| {
			kind: "insertion-point";
			blockId: string;
			offset: number;
	  };

export interface AIStreamingReviewPreviewInput {
	sessionId: string;
	turnId?: string;
	/**
	 * Which operation of the streaming call this preview belongs to.
	 *
	 * One call carries several operations (EC4) and they arrive one after
	 * another, so a preview keyed only by its target would be replaced as soon
	 * as the next operation started — taking a finished-but-unwritten proposal
	 * off the screen. The index is the identity that survives the target
	 * moving, which it does: an insert re-anchors as its blocks are written.
	 */
	operationIndex?: number;
	target: AIStreamingReviewPreviewTarget;
	text: string;
	/**
	 * The replacement text has finished arriving. Without it a replacement
	 * shorter than the text it covers previews as still streaming and keeps
	 * the old tail on screen; with it the preview hides everything accept
	 * removes (RS6).
	 */
	complete?: boolean;
	/**
	 * The edit removes every block in the target. The preview hides them whole
	 * even though no replacement text ever arrives (RS6).
	 */
	deletesBlocks?: boolean;
}

export interface AIStreamingReviewPreview extends AIStreamingReviewPreviewInput {
	/** How much of `text` was already on screen, so the tail can be styled. */
	previousTextLength: number;
}

export interface AISession {
	id: string;
	surface: AISurface;
	status: AISessionStatus;
	target: AISessionTarget;
	operation?: AIRequestedOperation | null;
	contextualPrompt?: AIContextualPromptState;
	turns: AISessionTurn[];
	activeTurnId?: string;
	promptHistory: AISessionPrompt[];
	generationIds: string[];
	pendingSuggestionIds: string[];
	createdAt: number;
	updatedAt: number;
	metrics: AISessionMetrics;
	anchor?: AISessionAnchor;
}

export interface AIInlineHistorySnapshot {
	id: string;
	sessionId: string | null;
	sessions: readonly AISession[];
	activeSessionId: string | null;
	documentVersion: number;
	kind: "document-coupled" | "ui-local";
}

export interface AIExternalInlineTurnResult {
	sessionId: string;
	turnId: string;
	historyId: string;
	operations: readonly DocumentOp[];
	suggestionIds: readonly string[];
}

export interface AgenticStep {
	index: number;
	type: "text" | "tool-call" | "tool-result";
	toolName?: string;
	toolCallId?: string;
	input?: unknown;
	output?: unknown;
	status: "pending" | "running" | "complete" | "error";
}

export type AIStreamEventType =
	| "generation-start"
	| "status"
	| "text-delta"
	| "operation"
	| "tool-call"
	| "tool-output"
	| "tool-result"
	| "generation-finish";

export interface AIStreamEventBase {
	type: AIStreamEventType;
	generationId: string;
	sessionId?: string;
	zoneId: string;
	blockId: string;
	timestamp: number;
}

export type AIStreamEvent =
	| (AIStreamEventBase & {
			type: "generation-start";
			prompt: string;
			target: GenerationState["target"];
	  })
	| (AIStreamEventBase & {
			type: "status";
			status: AIStatus;
	  })
	| (AIStreamEventBase & {
			type: "text-delta";
			delta: string;
			text: string;
	  })
	| (AIStreamEventBase & {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			input: unknown;
	  })
	| (AIStreamEventBase & {
			type: "tool-output";
			toolCallId: string;
			toolName: string;
			part: unknown;
			output: unknown;
	  })
	| (AIStreamEventBase & {
			type: "tool-result";
			toolCallId: string;
			toolName: string;
			output: unknown;
			state: "complete" | "error";
	  })
	| (AIStreamEventBase & {
			type: "operation";
			operation: AIRequestedOperation;
			phase: "preview" | "final" | "conflict";
			text?: string;
			reason?: string;
	  })
	| (AIStreamEventBase & {
			type: "generation-finish";
			status: GenerationState["status"];
			text: string;
	  });

export interface GenerationState {
	id: string;
	zoneId: string;
	blockId: string;
	target: "selection" | "block";
	sessionId?: string;
	turnId?: string;
	surface?: AISurface;
	prompt: string;
	operation?: AIRequestedOperation | null;
	status: "streaming" | "complete" | "cancelled" | "error";
	tokenCount: number;
	steps: AgenticStep[];
	undoGroupId: string;
	turnReason?: string | null;
	text: string;
	commandId?: string;
	suggestionIds?: string[];
	route?: AIRouteLane;
	mutationMode?: AIMutationMode;
	contentFormat?: AIContentFormat;
	/** Whether this turn's durable edits arrived as `edit_document` calls (EC1). */
	editsArriveAsToolCalls: boolean;
	targetKind?: GenerationTargetKind;
	mutationReceipt?: AIMutationReceipt | null;
	debug?: GenerationDebugState;
	editPreview?: EditDocumentPreviewUpdate | null;
}

export type GenerationTargetKind = AITargetKind;

export interface EphemeralSuggestion {
	id: string;
	blockId: string;
	offset: number;
	text: string;
	type: "inline" | "block";
	blockType?: string;
	props?: Record<string, unknown>;
}

export type AIInlineCompletionState = CoreInlineCompletionState;

export type AIInlineCompletionController = CoreInlineCompletionController;

export interface PersistentSuggestionBase {
	id: string;
	author: string;
	authorType: "user" | "ai";
	createdAt: number;
	model?: string;
	sessionId?: string;
	requestId?: string;
	turnId?: string;
	generationId?: string;
	blockId: string;
}

export interface PersistentTextSuggestion extends PersistentSuggestionBase {
	kind: "text";
	action: "insert" | "delete";
	offset: number;
	length: number;
	cell?: { row: number; col: number };
}
