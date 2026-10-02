import type {
	AIRequestContext,
	BlockSuggestionAction,
	BlockSuggestionPreviousState,
	Editor,
	ModelAdapter,
	ModelMessage,
	ModelRequestedOperation,
	SelectionState,
	TextSelection,
	ToolRuntime,
} from "@input/pen-types";
import type { AIToolBudgetLimits, AIToolConfirmFn, AIToolTurn } from "../tools";
import type { EditDocumentPreviewUpdate } from "../runtime/editDocumentPreview";
import type {
	AIMutationPreference,
	AIRouteLane,
	AITargetKind,
	AIWorkingSetViewMode,
} from "../runtime/contracts";
import type {
	AIEditStreaming,
	AIStatus,
	AISurface,
	AIContextualPromptRect,
	AISession,
	AIStreamingReviewPreview,
	AIStreamingReviewPreviewInput,
	AIExternalInlineTurnResult,
	AgenticStep,
	AIStreamEvent,
	GenerationState,
	EphemeralSuggestion,
	PersistentSuggestionBase,
	PersistentTextSuggestion,
} from "./session";

export type { BlockSuggestionPreviousState };

export type PersistentBlockSuggestionAction = BlockSuggestionAction;

export interface PersistentBlockSuggestion extends PersistentSuggestionBase {
	kind: "block";
	action: PersistentBlockSuggestionAction;
	previousState?: BlockSuggestionPreviousState;
}

export type PersistentSuggestion =
	PersistentTextSuggestion | PersistentBlockSuggestion;

export interface BlockSuggestionMeta {
	id: string;
	action: PersistentBlockSuggestionAction;
	author: string;
	authorType: "user" | "ai";
	createdAt: number;
	model?: string;
	sessionId?: string;
	requestId?: string;
	turnId?: string;
	generationId?: string;
	previousState?: BlockSuggestionPreviousState;
}

export interface AIAwarenessState {
	status: AIStatus;
	activeBlockId: string | null;
	activeTool?: { name: string; toolCallId: string };
	model: string;
	generationZoneId?: string;
}

export interface AICommandContext {
	editor: Editor;
	selection: SelectionState;
	selectedText: string;
	blockType: string | null;
	blockId: string | null;
}

export type AICommandGuard = (ctx: AICommandContext) => boolean;

export interface AICommandBinding {
	id: string;
	label: string;
	description?: string;
	icon?: string;
	group?: string;
	prompt: string | ((ctx: AICommandContext) => string);
	guard?: AICommandGuard;
	shortcut?: string;
	target?: "selection" | "block";
}

export interface AIControllerState {
	status: AIStatus;
	activeGeneration: GenerationState | null;
	sessions: readonly AISession[];
	activeSessionId?: string | null;
	suggestMode: boolean;
	mutationPreference: AIMutationPreference;
	ephemeralSuggestion: EphemeralSuggestion | null;
	/** One entry per operation of the call currently streaming (EC15). */
	streamingReviewPreviews: readonly AIStreamingReviewPreview[];
	commandMenuOpen: boolean;
	lastRoute?: AIRouteLane;
}

export type AIPromptTarget = "auto" | "selection" | "block" | "document";

export type AISessionResolution = "accept" | "reject";

export type AIInlineHistoryDirection = "undo" | "redo";

export interface AIInlineHistoryController {
	canUndoInlineHistory(): boolean;
	canRedoInlineHistory(): boolean;
	canHandleShortcut(direction: AIInlineHistoryDirection): boolean;
	handleShortcut(direction: AIInlineHistoryDirection): boolean;
	undoInlineHistory(): boolean;
	redoInlineHistory(): boolean;
}

export interface AIReviewController {
	getSuggestions(): readonly PersistentSuggestion[];
	acceptSuggestion(id: string): boolean;
	rejectSuggestion(id: string): boolean;
	acceptAllSuggestions(): void;
	rejectAllSuggestions(): void;
}

export interface AICommandExecutionOptions {
	blockId?: string | null;
	maxSteps?: number;
	target?: AIPromptTarget;
	operation?: AIRequestedOperation | null;
}

export type AIRequestedOperation = ModelRequestedOperation;

export interface AIController {
	getState(): AIControllerState;
	subscribe(listener: () => void): () => void;
	getSessions(): readonly AISession[];
	getActiveSession(): AISession | null;
	subscribeSessions(listener: () => void): () => void;
	getStreamEvents(): readonly AIStreamEvent[];
	subscribeStreamEvents(listener: () => void): () => void;
	getCommands(): readonly AICommandBinding[];
	getCommandContext(): AICommandContext;
	startSession(input: {
		surface: AISurface;
		target?: "auto" | "selection" | "block" | "document";
	}): AISession;
	openContextualPrompt(input?: {
		surface?: Extract<AISurface, "inline-edit">;
		target?: "auto" | "selection" | "block" | "document";
	}): AISession | null;
	updateContextualPromptDraft(sessionId: string, draftPrompt: string): void;
	setContextualPromptAnchorRect(
		sessionId: string,
		rect: AIContextualPromptRect | null,
	): void;
	runSessionPrompt(
		sessionId: string,
		prompt: string,
		options?: AICommandExecutionOptions,
	): Promise<GenerationState>;
	canReuseSessionPrompt(
		sessionId: string,
		prompt: string,
		options?: AICommandExecutionOptions,
	): boolean;
	resolveSessionTurn(
		sessionId: string,
		turnId: string,
		resolution: AISessionResolution,
	): boolean;
	acceptSessionTurn(sessionId: string, turnId: string): boolean;
	rejectSessionTurn(sessionId: string, turnId: string): boolean;
	resolveSession(sessionId: string, resolution: AISessionResolution): boolean;
	acceptSession(sessionId: string): boolean;
	rejectSession(sessionId: string): boolean;
	registerExternalInlineTurnResult(
		input: AIExternalInlineTurnResult,
	): boolean;
	cancelSession(sessionId: string): void;
	suspendInlineSession(sessionId: string): void;
	resumeInlineSession(sessionId: string): void;
	canUndoInlineHistory(): boolean;
	canRedoInlineHistory(): boolean;
	undoInlineHistory(): boolean;
	redoInlineHistory(): boolean;
	runCommand(
		commandId: string,
		options?: AICommandExecutionOptions,
	): Promise<GenerationState>;
	runPrompt(
		prompt: string,
		options?: AICommandExecutionOptions,
	): Promise<GenerationState>;
	retryActiveGeneration(): Promise<GenerationState | null>;
	acceptActiveGeneration(): boolean;
	rejectActiveGeneration(): boolean;
	cancelActiveGeneration(): void;
	openCommandMenu(): void;
	closeCommandMenu(): void;
	setSuggestMode(enabled: boolean): void;
	setMutationPreference(preference: AIMutationPreference): void;
	setStreamingReviewPreview(input: AIStreamingReviewPreviewInput): void;
	clearStreamingReviewPreview(sessionId?: string): void;
	showEphemeralSuggestion(suggestion: EphemeralSuggestion): void;
	dismissEphemeralSuggestion(): void;
	acceptEphemeralSuggestion(): void;
	getSuggestions(): readonly PersistentSuggestion[];
	acceptSuggestion(id: string): boolean;
	rejectSuggestion(id: string): boolean;
	acceptAllSuggestions(): void;
	rejectAllSuggestions(): void;
}

export interface AgenticLoopOptions {
	model: ModelAdapter;
	editor: Editor;
	toolRuntime: ToolRuntime;
	prompt: string;
	blockId: string;
	generationId?: string;
	zoneId?: string;
	maxSteps?: number;
	allowedMutatingTools?: readonly string[];
	confirm?: AIToolConfirmFn;
	toolBudget?: Partial<AIToolBudgetLimits>;
	toolTurn?: AIToolTurn;
	signal?: AbortSignal;
	requestMode?: string;
	operation?: AIRequestedOperation | null;
	sessionId?: string;
	turnId?: string;
	onStatusChange?: (status: AIAwarenessState["status"]) => void;
	onStep?: (step: AgenticStep) => void;
	onTextDelta?: (delta: string) => void;
	onCompleteText?: (text: string) => void;
	onToolCall?: (event: {
		toolCallId: string;
		toolName: string;
		input: unknown;
	}) => void;
	onToolOutput?: (event: {
		toolCallId: string;
		toolName: string;
		part: unknown;
		output: unknown;
	}) => void;
	onToolResult?: (event: {
		toolCallId: string;
		toolName: string;
		output: unknown;
		state: "complete" | "error";
	}) => void;
	onStructuredData?: (event: { data: unknown; final: boolean }) => void;
	onMessagesChange?: (messages: ModelMessage[]) => void;
	onStreamingStart?: (zoneId: string, blockId: string) => void;
	onStreamingEnd?: (status: "complete" | "cancelled" | "error") => void;
	workingSet?: AIWorkingSetEnvelope | null;
	validateWorkingSet?: (workingSet: AIWorkingSetEnvelope | null) => {
		valid: boolean;
		canRefresh: boolean;
		reason?: string;
	};
	refreshWorkingSet?: () => Promise<AIWorkingSetEnvelope | null>;
	onDebug?: (debug: GenerationDebugState) => void;
	feature?: AIRequestContext["feature"];
	/**
	 * Whether this route's durable edits arrive as `edit_document` calls. That
	 * is the edit channel, which owns two loop behaviors: a clean mutating pass
	 * ends the turn (EC14), and a stale working set is corrected in-turn rather
	 * than thrown (EC9). Absent, the pass is not the edit channel and neither
	 * behavior applies.
	 */
	editsArriveAsToolCalls?: boolean;
	/**
	 * Whether the prompt asked for an edit. EC17 forces the edit tool on an
	 * edit-intent pass only: forcing a pass that asked a question would answer
	 * it by rewriting the document. Absent, the pass is treated as edit intent,
	 * which is what every caller before the question intent existed meant.
	 */
	editIntent?: boolean;
	/**
	 * Host gate for EC15/EC20. `"preview"` consumes tool-input-delta text as a
	 * decoration, `"commit"` also writes each settled block as it arrives, and
	 * `"atomic"` ignores partials. Default is resolved by the adapter.
	 */
	editStreaming?: AIEditStreaming;
	onEditPreview?: (preview: EditDocumentPreviewUpdate | null) => void;
	mutationPreference?: AIMutationPreference;
}

export interface AIWorkingSetEnvelope {
	documentVersion: number;
	viewMode: AIWorkingSetViewMode;
	source: "cursor-context" | "document-summary" | "selection";
	context: unknown;
	routeConfidence?: number;
	trackedBlockIds: string[];
	viewHashes?: Record<string, string>;
	selectionSignature: string | null;
}

export type AISelectionWorkingSetScope = "partial" | "whole-blocks";

export type AISelectionWorkingSetContext =
	| {
			selectionScope: "partial";
			selection: TextSelection;
			selectedText: string;
	  }
	| {
			selectionScope: "whole-blocks";
			selection: TextSelection;
			selectedText: string;
			markdown: string;
	  };

export interface AIWorkingSetRetrievedSpan {
	id: string;
	blockIds: string[];
	range: {
		startBlockId: string;
		endBlockId: string;
	};
	blockTypes: string[];
	headingPath: string[];
	preview: string;
	markdown: string;
	score: number;
	rationale: string;
	neighbors: {
		beforeBlockId: string | null;
		afterBlockId: string | null;
	};
}

export interface GenerationDebugState {
	messageAssemblyLatencyMs: number;
	firstToolStartMs: number | null;
	firstToolResultMs: number | null;
	firstVisibleTextMs: number | null;
	toolExecutionMs: number;
	qualitySignals: {
		staleContextRate?: number;
		requestRestartRateUnderChurn?: number;
	};
	routeConfidence?: number;
	structured?: StructuredGenerationDebugState;
	commit?: CommitDebugState;
}

export interface StructuredGenerationDebugState {
	targetKind?: AITargetKind;
	validationIssueCount?: number;
}

export interface CommitDebugState {
	attempted: boolean;
	succeeded: boolean;
	executionPath?:
		"selection-replacement" | "scoped-replacement" | "plain-markdown";
	contextChars?: number;
	diffChars?: number;
	fallbackReason?: string;
	fallback?: CommitFallbackMetrics;
}

export interface CommitFallbackMetrics {
	kind: "scoped-replacement" | "plain-markdown";
	opsCount: number;
	insertedBlockCount: number;
	deletedBlockCount: number;
	targetBlockCount?: number;
}

export type AIMutationReceiptStatus =
	"applied" | "staged_suggestions" | "noop" | "invalid" | "error";

export interface AIMutationReceiptEvidence {
	commitId: string;
	opsCount: number;
	affectedBlockIds: string[];
	createdBlockIds: string[];
}

export interface AIMutationReceipt {
	id: string;
	status: AIMutationReceiptStatus;
	evidence: AIMutationReceiptEvidence;
	issues: string[];
}
