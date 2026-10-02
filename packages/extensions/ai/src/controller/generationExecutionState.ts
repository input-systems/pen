import type {
	DocumentRange,
	StreamingTarget,
	ToolRuntime,
} from "@input/pen-types";
import type { AIContentFormat } from "../runtime/contracts";
import type { RequestRouterDecision } from "../runtime/router";
import type {
	AIMutationReceipt,
	AIRequestedOperation,
	AISession,
	AIWorkingSetEnvelope,
	GenerationState,
} from "../types";
import type { AISelectionWorkingSetScope } from "../types/controller";
import type { GenerationExecutionContext, GenerationTarget } from "../helpers";
import type {
	GenerationStreamingSink,
	SuggestionSpliceHead,
} from "./streamingSink";

export interface ExecuteGenerationInput {
	prompt: string;
	target: GenerationTarget;
	commandId?: string;
	maxSteps?: number;
	context?: GenerationExecutionContext;
}

export interface ExecuteLocalOperationInput {
	prompt: string;
	target: GenerationTarget;
	blockId: string;
	commandId?: string;
	context?: GenerationExecutionContext;
	abortController: AbortController;
	baselineSuggestionIds: Set<string>;
	operation: AIRequestedOperation;
}

export interface LocalOperationExecutionState {
	context?: GenerationExecutionContext;
	sessionTurnId: string | undefined;
	operation: AIRequestedOperation;
	currentText: string;
	currentMutationReceipt: AIMutationReceipt | null;
	seedGeneration: GenerationState;
	abortController: AbortController;
	baselineSuggestionIds: Set<string>;
}

export interface GenerationExecutionState {
	prompt: string;
	target: GenerationTarget;
	commandId?: string;
	maxSteps?: number;
	context?: GenerationExecutionContext;
	toolRuntime: ToolRuntime;
	abortController: AbortController;
	baselineSuggestionIds: Set<string>;
	blockId: string;
	requestedOperation: AIRequestedOperation | null;
	selectionScope: AISelectionWorkingSetScope;
	route: RequestRouterDecision;
	workingSet: AIWorkingSetEnvelope | null;
	contentFormat: AIContentFormat;
	currentText: string;
	streamingTarget: StreamingTarget | null;
	blockStreamingStarted: boolean;
	selectionRange: DocumentRange | null;
	selectionSourceText: string;
	shouldReplaceMarkdownTarget: boolean;
	streamingSink: GenerationStreamingSink;
	suggestionSpliceHead: SuggestionSpliceHead | null;
	sessionTurnId: string | undefined;
	existingSession: AISession | null;
	executionPrompt: string;
	shouldTrimLeadingBlankBlockText: boolean;
	generationPrompt: string;
	seedGeneration: GenerationState;
	currentMutationReceipt: AIMutationReceipt | null;
}
