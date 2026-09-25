import {
	announceEditorA11y,
	isCollapsed,
	undoMetadataControllerFacet,
} from "@input/pen-core";
import type {
	CommitEvent,
	Decoration,
	DocumentOp,
	Editor,
	HistoryAppliedEvent,
	ModelAdapter,
	OpOrigin,
	SelectionState,
	TextSelection,
	ToolRuntime,
	UndoHistoryMetadataController,
} from "@input/pen-types";
import { AI_AGENTIC_MAX_STEPS_DEFAULT } from "../tools";
import { defaultAICommands } from "../commands/defaultCommands";
import { resolveCatalogCopy } from "../i18n/resolveCatalogCopy";
import { AICommandRegistry } from "../commands/registry";
import {
	isAIMutationPreference,
	type AIContentFormat,
	type AIMutationPreference,
} from "../runtime/contracts";
import { SuggestedAIOperationRunner } from "../runtime/suggestedOperationRunner";
import { ExternalInlineTurnRegistry } from "../runtime/externalInlineTurnRegistry";
import type { RequestRouterDecision } from "../runtime/router";
import type {
	AICommandBinding,
	AICommandContext,
	AICommandExecutionOptions,
	AIController,
	AIControllerState,
	AIEditStreaming,
	AIExtensionConfig,
	AIExternalInlineTurnResult,
	AIInlineCompletionController,
	AIInlineHistoryDirection,
	AIInlineHistorySnapshot,
	AIMutationReceipt,
	AIRequestedOperation,
	AISession,
	AIStreamEvent,
	AIStreamingReviewPreviewInput,
	AISurface,
	AIWorkingSetEnvelope,
	GenerationState,
	PersistentSuggestion,
} from "../types";
import type { AISelectionWorkingSetScope } from "../types/controller";
import {
	AI_UNDO_HISTORY_METADATA_KEY,
	MAX_STREAM_EVENTS,
	readModelId,
	resolveActiveBlockId,
	resolvePromptTarget,
	resolveSelectionText,
} from "../helpers";
import type {
	AIInlineHistoryRestoreRequest,
	AIInlineShortcutHistoryWaypoint,
	GenerationExecutionContext,
	GenerationTarget,
} from "../helpers";
import { AIControllerSessionState } from "./sessionState";
import { reviewResolutionMethods } from "./reviewResolutionMethods";
import { decorationControllerMethods } from "./decorationControllerMethods";
import { generationRunnerMethods } from "./generationRunnerMethods";
import { suggestionControllerMethods } from "./suggestionControllerMethods";
import { commitSupportMethods } from "./commitSupportMethods";
import { operationCommitMethods } from "./operationCommitMethods";
import { bufferedBlockGenerationMethods } from "./bufferedBlockGenerationMethods";
import { markdownCommitMethods } from "./markdownCommitMethods";
import { workingSetMethods } from "./workingSetMethods";
import { workingSetValidationMethods } from "./workingSetValidationMethods";
import { inlineHistoryRecording } from "./inlineHistoryRecording";
import { inlineHistoryNavigation } from "./inlineHistoryNavigation";
import { inlineHistoryRestore } from "./inlineHistoryRestore";

export type StreamingPreviewStatePatch = {
	activeGeneration?: AIControllerState["activeGeneration"];
};

export class AIControllerImpl
	extends AIControllerSessionState
	implements AIController
{
	private readonly _registry = new AICommandRegistry();

	readonly _inlineCompletion: AIInlineCompletionController;

	private readonly _streamEventListeners = new Set<() => void>();

	readonly _model: ModelAdapter | undefined;

	private readonly _author: string;

	readonly _suggestedOperationRunner: SuggestedAIOperationRunner;

	readonly _maxAgenticSteps: number;

	readonly _allowedMutatingTools: readonly string[];

	readonly _confirmAITool: AIExtensionConfig["confirm"];

	readonly _suggestionPresentation: NonNullable<
		AIExtensionConfig["suggestionPresentation"]
	>;

	readonly _contentFormat: {
		blockGeneration: AIContentFormat;
		selectionRewrite: AIContentFormat;
	};

	_mutationPreference: AIMutationPreference;

	readonly _editStreaming: AIEditStreaming | undefined;

	_streamEvents: readonly AIStreamEvent[] = [];

	_abortController: AbortController | null = null;

	private _lastPrompt: string | null = null;

	private _lastCommandId: string | null = null;

	_inlineHistory: AIInlineHistorySnapshot[] = [];

	_inlineHistoryIndex = -1;

	_externalInlineTurnRegistry = new ExternalInlineTurnRegistry();

	_queuedInlineHistoryShortcutDirections: AIInlineHistoryDirection[] = [];

	_streamingPreviewRaf: number | null = null;

	_queuedStreamingPreview: {
		inputs: readonly AIStreamingReviewPreviewInput[];
		extra?: StreamingPreviewStatePatch;
	} | null = null;

	_queuedInlineHistoryShortcutFlushScheduled = false;

	_handledUndoHistoryRequestId: number | null = null;

	constructor(
		editor: Editor,
		config: AIExtensionConfig,
		services: {
			inlineCompletion: AIInlineCompletionController;
		},
	) {
		super(editor, {
			status: "idle",
			activeGeneration: null,
			sessions: [],
			activeSessionId: null,
			suggestMode: config.suggestMode ?? false,
			mutationPreference: isAIMutationPreference(
				config.mutationPreference,
			)
				? config.mutationPreference
				: "suggestions",
			ephemeralSuggestion: null,
			streamingReviewPreviews: [],
			commandMenuOpen: false,
		});
		this._inlineCompletion = services.inlineCompletion;
		this._model = config.model;
		this._author = config.author ?? "assistant";
		this._suggestedOperationRunner = new SuggestedAIOperationRunner({
			editor: this._editor,
			author: this._author,
			model: readModelId(this._model),
			getSession: (sessionId) =>
				this._state.sessions.find(
					(session) => session.id === sessionId,
				) ?? null,
			getActiveGeneration: () => this._state.activeGeneration,
		});
		this._maxAgenticSteps =
			config.maxAgenticSteps ?? AI_AGENTIC_MAX_STEPS_DEFAULT;
		this._allowedMutatingTools = config.allowedMutatingTools ?? [];
		this._confirmAITool = config.confirm;
		this._suggestionPresentation =
			config.suggestionPresentation ?? "track-changes";
		this._contentFormat = {
			blockGeneration: config.contentFormat?.blockGeneration ?? "text",
			selectionRewrite: config.contentFormat?.selectionRewrite ?? "text",
		};
		this._mutationPreference = isAIMutationPreference(
			config.mutationPreference,
		)
			? config.mutationPreference
			: "suggestions";
		this._editStreaming = config.editStreaming;
		this._undoHistoryMetadata =
			(this._editor.facet(
				undoMetadataControllerFacet,
			) as UndoHistoryMetadataController | null) ?? null;

		for (const command of defaultAICommands) {
			this._registry.register(command);
		}
		for (const command of config.commands ?? []) {
			this._registry.register(command);
		}

		this._syncSuggestionsFromDocument();

		this._unsubscribeInlineCompletion = this._inlineCompletion.subscribe(
			() => {
				this._setState({
					ephemeralSuggestion:
						this._inlineCompletion.getState().visibleSuggestion,
				});
			},
		);
		this._unsubscribeHistoryApplied = this._editor.onHistoryApplied(
			(event) => {
				this._handleHistoryApplied(event);
			},
		);
		this._unsubscribeUndoHistoryMetadata =
			this._undoHistoryMetadata?.registerMetadataRestorer<AIInlineHistorySnapshot>(
				AI_UNDO_HISTORY_METADATA_KEY,
				(snapshot, context) => {
					if (!snapshot) {
						return;
					}
					this._handledUndoHistoryRequestId = context.requestId;
					this._restoreInlineHistorySnapshotFromUndo(snapshot);
				},
			) ?? null;
	}

	getStreamEvents(): readonly AIStreamEvent[] {
		return this._streamEvents;
	}

	subscribeStreamEvents(listener: () => void): () => void {
		this._streamEventListeners.add(listener);
		return () => {
			this._streamEventListeners.delete(listener);
		};
	}

	getCommands(): readonly AICommandBinding[] {
		return this._registry.list(this.getCommandContext()).map((command) => ({
			...command,
			label: resolveCatalogCopy(this._editor, command.label),
			description: command.description
				? resolveCatalogCopy(this._editor, command.description)
				: command.description,
		}));
	}

	getCommandContext(): AICommandContext {
		const selection = this._editor.selection;
		const blockId = resolveActiveBlockId(selection);
		return {
			editor: this._editor,
			selection,
			selectedText:
				selection?.type === "text"
					? resolveSelectionText(this._editor, selection)
					: "",
			blockType: blockId
				? (this._editor.getBlock(blockId)?.type ?? null)
				: null,
			blockId,
		};
	}

	_setStreamEvents(nextEvents: readonly AIStreamEvent[]): void {
		this._streamEvents = nextEvents;
		this._emitStreamEvents();
	}

	_appendStreamEvent(event: AIStreamEvent): void {
		const lastEvent = this._streamEvents[this._streamEvents.length - 1];
		if (
			lastEvent?.type === "status" &&
			event.type === "status" &&
			lastEvent.generationId === event.generationId &&
			lastEvent.status === event.status
		) {
			return;
		}
		const nextEvents =
			this._streamEvents.length >= MAX_STREAM_EVENTS
				? [...this._streamEvents.slice(-(MAX_STREAM_EVENTS - 1)), event]
				: [...this._streamEvents, event];
		this._setStreamEvents(nextEvents);
		if (event.type === "generation-start") {
			announceEditorA11y(this._editor, "streamingStarted");
		} else if (event.type === "generation-finish") {
			announceEditorA11y(this._editor, "streamingFinished");
		}
	}

	_emitStreamEvents(): void {
		for (const listener of this._streamEventListeners) {
			listener();
		}
	}

	canUndoInlineHistory(): boolean {
		return this._inlineHistoryIndex > 0;
	}

	canRedoInlineHistory(): boolean {
		return (
			this._inlineHistoryIndex >= 0 &&
			this._inlineHistoryIndex < this._inlineHistory.length - 1
		);
	}

	undoInlineHistory(): boolean {
		return this._navigateInlineHistory("undo");
	}

	redoInlineHistory(): boolean {
		return this._navigateInlineHistory("redo");
	}

	canHandleInlineHistoryShortcut(
		direction: AIInlineHistoryDirection,
	): boolean {
		if (this._pendingInlineHistoryRestore) {
			return true;
		}
		return this._canHandleInlineHistoryShortcut(direction, {
			shortcutOnly: true,
		});
	}

	handleInlineHistoryShortcut(direction: AIInlineHistoryDirection): boolean {
		if (this._pendingInlineHistoryRestore) {
			this._queuedInlineHistoryShortcutDirections.push(direction);
			return true;
		}
		return this._navigateInlineHistory(direction, {
			shortcutOnly: true,
		});
	}

	async runCommand(
		commandId: string,
		options?: AICommandExecutionOptions,
	): Promise<GenerationState> {
		const ctx = this.getCommandContext();
		const command = this._registry.resolve(commandId);
		if (!command) {
			throw new Error(`Unknown AI command "${commandId}"`);
		}
		if (command.guard && !command.guard(ctx)) {
			throw new Error(
				`AI command "${resolveCatalogCopy(this._editor, command.label)}" is not available in this context`,
			);
		}

		const prompt = this._registry.resolvePrompt(command, ctx);
		this._lastPrompt = prompt;
		this._lastCommandId = command.id;

		if (
			command.target === "selection" &&
			ctx.selection?.type === "text" &&
			!isCollapsed(ctx.selection)
		) {
			return this._runSelectionGeneration(
				prompt,
				ctx.selection,
				command.id,
				options?.maxSteps,
			);
		}

		const targetBlockId =
			options?.blockId ??
			ctx.blockId ??
			this._editor.lastBlock()?.id ??
			this._editor.firstBlock()?.id;
		if (!targetBlockId) {
			throw new Error("Cannot run AI command without a target block");
		}
		return this._runBlockGeneration(
			prompt,
			targetBlockId,
			command.id,
			options?.maxSteps,
		);
	}

	async runPrompt(
		prompt: string,
		options?: AICommandExecutionOptions,
	): Promise<GenerationState> {
		this._lastPrompt = prompt;
		this._lastCommandId = null;
		const promptTarget = resolvePromptTarget(
			this._editor.selection,
			options?.target,
		);
		if (promptTarget === "selection") {
			const selection = this._editor.selection;
			if (selection?.type !== "text" || isCollapsed(selection)) {
				throw new Error(
					"Cannot run a selection prompt without selected text",
				);
			}
			return this._runSelectionGeneration(
				prompt,
				selection,
				undefined,
				options?.maxSteps,
			);
		}
		if (promptTarget === "document") {
			return this._runDocumentGeneration(
				prompt,
				options?.blockId,
				undefined,
				options?.maxSteps,
			);
		}
		const blockId =
			options?.blockId ??
			resolveActiveBlockId(this._editor.selection) ??
			this._editor.lastBlock()?.id ??
			this._editor.firstBlock()?.id;
		if (!blockId) {
			throw new Error("Cannot run AI prompt without a target block");
		}
		return this._runBlockGeneration(
			prompt,
			blockId,
			undefined,
			options?.maxSteps,
		);
	}

	async retryActiveGeneration(): Promise<GenerationState | null> {
		const prompt = this._lastPrompt;
		if (!prompt) return null;
		this.rejectActiveGeneration();
		const active = this._state.activeGeneration;
		const blockId =
			active?.blockId ??
			resolveActiveBlockId(this._editor.selection) ??
			this._editor.lastBlock()?.id ??
			this._editor.firstBlock()?.id;
		if (!blockId) return null;
		if (active?.sessionId) {
			const activeSession = this._state.sessions.find(
				(session) => session.id === active.sessionId,
			);
			const retryTarget =
				activeSession?.target.kind === "document"
					? "document"
					: (active?.target ?? "block");
			return this.runSessionPrompt(active.sessionId, prompt, {
				blockId: retryTarget === "document" ? null : blockId,
				target: retryTarget,
			});
		}
		if (this._lastCommandId) {
			return this.runCommand(this._lastCommandId, { blockId });
		}
		return this.runPrompt(prompt, {
			blockId,
			target: active?.target ?? "block",
		});
	}
	// reviewResolutionMethods
	acceptActiveGeneration(): boolean {
		return reviewResolutionMethods.acceptActiveGeneration.call(this);
	}

	rejectActiveGeneration(): boolean {
		return reviewResolutionMethods.rejectActiveGeneration.call(this);
	}

	// generationRunnerMethods
	cancelActiveGeneration(): void {
		return generationRunnerMethods.cancelActiveGeneration.call(this);
	}

	openCommandMenu(): void {
		return generationRunnerMethods.openCommandMenu.call(this);
	}

	closeCommandMenu(): void {
		return generationRunnerMethods.closeCommandMenu.call(this);
	}

	setSuggestMode(enabled: boolean): void {
		return generationRunnerMethods.setSuggestMode.call(this, enabled);
	}

	setMutationPreference(preference: AIMutationPreference): void {
		return generationRunnerMethods.setMutationPreference.call(
			this,
			preference,
		);
	}

	handleExternalCommit(events: readonly CommitEvent[]): void {
		return generationRunnerMethods.handleExternalCommit.call(this, events);
	}

	_runBlockGeneration(
		prompt: string,
		blockId: string,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState> {
		return generationRunnerMethods._runBlockGeneration.call(
			this,
			prompt,
			blockId,
			commandId,
			maxSteps,
			context,
		);
	}

	_runDocumentGeneration(
		prompt: string,
		preferredBlockId?: string | null,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState> {
		return generationRunnerMethods._runDocumentGeneration.call(
			this,
			prompt,
			preferredBlockId,
			commandId,
			maxSteps,
			context,
		);
	}

	_runSelectionGeneration(
		prompt: string,
		selection: TextSelection,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState> {
		return generationRunnerMethods._runSelectionGeneration.call(
			this,
			prompt,
			selection,
			commandId,
			maxSteps,
			context,
		);
	}

	_executeGeneration(
		prompt: string,
		target: GenerationTarget,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState> {
		return generationRunnerMethods._executeGeneration.call(
			this,
			prompt,
			target,
			commandId,
			maxSteps,
			context,
		);
	}

	_executeLocalOperation(input: {
		prompt: string;
		target: GenerationTarget;
		blockId: string;
		commandId?: string;
		context?: GenerationExecutionContext;
		abortController: AbortController;
		baselineSuggestionIds: Set<string>;
		operation: AIRequestedOperation;
	}): Promise<GenerationState> {
		return generationRunnerMethods._executeLocalOperation.call(this, input);
	}

	// decorationControllerMethods
	setStreamingReviewPreview(
		input: AIStreamingReviewPreviewInput,
		extra?: StreamingPreviewStatePatch,
	): void {
		return decorationControllerMethods.setStreamingReviewPreview.call(
			this,
			input,
			extra,
		);
	}

	clearStreamingReviewPreview(
		sessionId?: string,
		extra?: StreamingPreviewStatePatch,
	): void {
		return decorationControllerMethods.clearStreamingReviewPreview.call(
			this,
			sessionId,
			extra,
		);
	}

	buildDecorations(): Decoration[] {
		return decorationControllerMethods.buildDecorations.call(this);
	}

	// suggestionControllerMethods
	showEphemeralSuggestion(
		suggestion: Parameters<
			AIInlineCompletionController["showSuggestion"]
		>[0],
	): void {
		return suggestionControllerMethods.showEphemeralSuggestion.call(
			this,
			suggestion,
		);
	}

	dismissEphemeralSuggestion(): void {
		return suggestionControllerMethods.dismissEphemeralSuggestion.call(
			this,
		);
	}

	acceptEphemeralSuggestion(): void {
		return suggestionControllerMethods.acceptEphemeralSuggestion.call(this);
	}

	getSuggestions(): readonly PersistentSuggestion[] {
		return suggestionControllerMethods.getSuggestions.call(this);
	}

	handleDocumentChange(events: readonly CommitEvent[]): void {
		return suggestionControllerMethods.handleDocumentChange.call(
			this,
			events,
		);
	}

	_syncSuggestionResolutionState(): void {
		return suggestionControllerMethods._syncSuggestionResolutionState.call(
			this,
		);
	}

	acceptSuggestion(id: string): boolean {
		return suggestionControllerMethods.acceptSuggestion.call(this, id);
	}

	rejectSuggestion(id: string): boolean {
		return suggestionControllerMethods.rejectSuggestion.call(this, id);
	}

	_rejectPreviewSuggestions(suggestionIds: readonly string[]): void {
		return suggestionControllerMethods._rejectPreviewSuggestions.call(
			this,
			suggestionIds,
		);
	}

	acceptAllSuggestions(): void {
		return suggestionControllerMethods.acceptAllSuggestions.call(this);
	}

	rejectAllSuggestions(): void {
		return suggestionControllerMethods.rejectAllSuggestions.call(this);
	}

	_syncSuggestionsFromDocument(): boolean {
		return suggestionControllerMethods._syncSuggestionsFromDocument.call(
			this,
		);
	}

	// commitSupportMethods
	_applySuggestedAIOps(
		ops: readonly DocumentOp[],
		sessionId?: string,
		options?: {
			generationId?: string;
			origin?: OpOrigin;
			requestId?: string;
			suggestionIds?: readonly string[];
			turnId?: string;
			undoGroupId?: string;
		},
	): void {
		return commitSupportMethods._applySuggestedAIOps.call(
			this,
			ops,
			sessionId,
			options,
		);
	}

	_createSelectionSignature(selection: SelectionState): string | null {
		return commitSupportMethods._createSelectionSignature.call(
			this,
			selection,
		);
	}

	_resolveActiveGeneration(overrides: Partial<GenerationState>): void {
		return commitSupportMethods._resolveActiveGeneration.call(
			this,
			overrides,
		);
	}

	// operationCommitMethods
	_commitRequestedOperationResult(
		operation: AIRequestedOperation,
		text: string,
		sessionId: string | undefined,
		options: { contentFormat: AIContentFormat },
	): AIMutationReceipt {
		return operationCommitMethods._commitRequestedOperationResult.call(
			this,
			operation,
			text,
			sessionId,
			options,
		);
	}

	_commitSelectionRewrite(
		selection: TextSelection,
		text: string,
		mutationMode: NonNullable<GenerationState["mutationMode"]>,
		sessionId?: string,
	): AIMutationReceipt {
		return operationCommitMethods._commitSelectionRewrite.call(
			this,
			selection,
			text,
			mutationMode,
			sessionId,
		);
	}

	// bufferedBlockGenerationMethods
	_commitBufferedBlockGeneration(
		blockId: string,
		text: string,
		mutationMode: NonNullable<GenerationState["mutationMode"]>,
		contentFormat: AIContentFormat,
		sessionId?: string,
		options?: {
			insertionOffset?: number;
			workingSet?: AIWorkingSetEnvelope | null;
			replaceTargetBlock?: boolean;
			replaceBlockIds?: readonly string[];
		},
	): AIMutationReceipt {
		return bufferedBlockGenerationMethods._commitBufferedBlockGeneration.call(
			this,
			blockId,
			text,
			mutationMode,
			contentFormat,
			sessionId,
			options,
		);
	}

	// markdownCommitMethods
	_verifyMarkdownCommitResult(
		blockIds: readonly string[],
		markdown: string,
	): { valid: boolean; reason?: string } {
		return markdownCommitMethods._verifyMarkdownCommitResult.call(
			this,
			blockIds,
			markdown,
		);
	}

	_buildMarkdownScopedReplacementOps(
		blockIds: readonly string[],
		text: string,
	): DocumentOp[] {
		return markdownCommitMethods._buildMarkdownScopedReplacementOps.call(
			this,
			blockIds,
			text,
		);
	}

	_summarizeCommitFallbackOps(
		kind: "scoped-replacement" | "plain-markdown",
		ops: readonly DocumentOp[],
		targetBlockCount?: number,
	): {
		kind: "scoped-replacement" | "plain-markdown";
		opsCount: number;
		insertedBlockCount: number;
		deletedBlockCount: number;
		targetBlockCount?: number;
	} {
		return markdownCommitMethods._summarizeCommitFallbackOps.call(
			this,
			kind,
			ops,
			targetBlockCount,
		);
	}

	_recordCommitDebug(
		overrides: Partial<
			NonNullable<NonNullable<GenerationState["debug"]>["commit"]>
		>,
	): void {
		return markdownCommitMethods._recordCommitDebug.call(this, overrides);
	}

	_applySuggestedMarkdownPlaceholderReplacement(
		blockId: string,
		text: string,
		sessionId?: string,
		replaceTargetBlock?: boolean,
		replaceBlockIds?: readonly string[],
	): DocumentOp[] | null {
		return markdownCommitMethods._applySuggestedMarkdownPlaceholderReplacement.call(
			this,
			blockId,
			text,
			sessionId,
			replaceTargetBlock,
			replaceBlockIds,
		);
	}

	// workingSetMethods
	_buildFallbackMutationReceipt(input: {
		committedText: boolean;
		suggestionIds: readonly string[];
	}): AIMutationReceipt {
		return workingSetMethods._buildFallbackMutationReceipt.call(
			this,
			input,
		);
	}

	_buildWorkingSet(
		toolRuntime: ToolRuntime,
		route: RequestRouterDecision,
		target: GenerationTarget,
		blockId: string,
		prompt: string,
		scope?: "document" | "block",
		selectionScope?: AISelectionWorkingSetScope,
	): Promise<AIWorkingSetEnvelope | null> {
		return workingSetMethods._buildWorkingSet.call(
			this,
			toolRuntime,
			route,
			target,
			blockId,
			prompt,
			scope,
			selectionScope,
		);
	}

	_refineRouteWithWorkingSet(
		route: RequestRouterDecision,
		workingSet: AIWorkingSetEnvelope | null,
	): RequestRouterDecision {
		return workingSetMethods._refineRouteWithWorkingSet.call(
			this,
			route,
			workingSet,
		);
	}

	// workingSetValidationMethods
	_validateWorkingSet(
		route: RequestRouterDecision,
		target: GenerationTarget,
		workingSet: AIWorkingSetEnvelope | null,
	): { valid: boolean; canRefresh: boolean; reason?: string } {
		return workingSetValidationMethods._validateWorkingSet.call(
			this,
			route,
			target,
			workingSet,
		);
	}

	_captureBlockViewHashes(
		blockIds: readonly string[],
	): Record<string, string> {
		return workingSetValidationMethods._captureBlockViewHashes.call(
			this,
			blockIds,
		);
	}

	_resolveContentFormat(
		target: GenerationState["target"],
		surface?: AISurface,
	): AIContentFormat {
		return workingSetValidationMethods._resolveContentFormat.call(
			this,
			target,
			surface,
		);
	}

	_buildTextBlockGenerationOps(
		blockId: string,
		text: string,
		insertionOffset?: number,
	): DocumentOp[] {
		return workingSetValidationMethods._buildTextBlockGenerationOps.call(
			this,
			blockId,
			text,
			insertionOffset,
		);
	}

	_buildMarkdownBlockGenerationOps(
		blockId: string,
		text: string,
		replaceTargetBlock?: boolean,
		replaceBlockIds?: readonly string[],
	): DocumentOp[] {
		return workingSetValidationMethods._buildMarkdownBlockGenerationOps.call(
			this,
			blockId,
			text,
			replaceTargetBlock,
			replaceBlockIds,
		);
	}

	// inlineHistoryRecording
	registerExternalInlineTurnResult(
		input: AIExternalInlineTurnResult,
	): boolean {
		return inlineHistoryRecording.registerExternalInlineTurnResult.call(
			this,
			input,
		);
	}

	_createExternalInlineTurnHistorySessions(
		sessionId: string,
		turnId: string,
		includeTurn: boolean,
	): readonly AISession[] {
		return inlineHistoryRecording._createExternalInlineTurnHistorySessions.call(
			this,
			sessionId,
			turnId,
			includeTurn,
		);
	}

	_recordInlineHistorySnapshot(
		previousState: AIControllerState,
		nextState: AIControllerState,
	): void {
		return inlineHistoryRecording._recordInlineHistorySnapshot.call(
			this,
			previousState,
			nextState,
		);
	}

	_recordInlinePromptSubmissionCheckpoint(
		sessionId: string,
		prompt: string,
	): void {
		return inlineHistoryRecording._recordInlinePromptSubmissionCheckpoint.call(
			this,
			sessionId,
			prompt,
		);
	}

	// inlineHistoryNavigation
	_resolveInlineHistoryTargetIndex(
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): number {
		return inlineHistoryNavigation._resolveInlineHistoryTargetIndex.call(
			this,
			direction,
			options,
		);
	}

	_resolveShortcutInlineHistorySessionId(
		currentSnapshot: AIInlineHistorySnapshot | null,
		direction: AIInlineHistoryDirection,
	): string | null {
		return inlineHistoryNavigation._resolveShortcutInlineHistorySessionId.call(
			this,
			currentSnapshot,
			direction,
		);
	}

	_buildInlineShortcutHistoryWaypoints(
		sessionId: string | null,
	): AIInlineShortcutHistoryWaypoint[] {
		return inlineHistoryNavigation._buildInlineShortcutHistoryWaypoints.call(
			this,
			sessionId,
		);
	}

	_resolveCurrentInlineShortcutWaypointIndex(
		waypoints: readonly AIInlineShortcutHistoryWaypoint[],
		sessionId: string | null,
	): number {
		return inlineHistoryNavigation._resolveCurrentInlineShortcutWaypointIndex.call(
			this,
			waypoints,
			sessionId,
		);
	}

	_canHandleInlineHistoryShortcut(
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): boolean {
		return inlineHistoryNavigation._canHandleInlineHistoryShortcut.call(
			this,
			direction,
			options,
		);
	}

	_resolveExternalInlineTurnTransition(
		currentSnapshot: AIInlineHistorySnapshot | null,
		targetSnapshot: AIInlineHistorySnapshot,
		direction: AIInlineHistoryDirection,
	):
		| (AIExternalInlineTurnResult & {
				beforeSnapshotId?: string;
				afterSnapshotId?: string;
		  })
		| null {
		return inlineHistoryNavigation._resolveExternalInlineTurnTransition.call(
			this,
			currentSnapshot,
			targetSnapshot,
			direction,
		);
	}

	_inlineHistorySnapshotHasTurn(
		snapshot: AIInlineHistorySnapshot,
		sessionId: string,
		turnId: string,
	): boolean {
		return inlineHistoryNavigation._inlineHistorySnapshotHasTurn.call(
			this,
			snapshot,
			sessionId,
			turnId,
		);
	}

	_applyExternalInlineTurnTransition(
		result: AIExternalInlineTurnResult,
		direction: AIInlineHistoryDirection,
		targetSnapshot: AIInlineHistorySnapshot,
		targetIndex: number,
		options?: { shortcutOnly?: boolean },
	): boolean {
		return inlineHistoryNavigation._applyExternalInlineTurnTransition.call(
			this,
			result,
			direction,
			targetSnapshot,
			targetIndex,
			options,
		);
	}

	_navigateInlineHistory(
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): boolean {
		return inlineHistoryNavigation._navigateInlineHistory.call(
			this,
			direction,
			options,
		);
	}

	_applyInlineHistorySnapshot(
		snapshot: AIInlineHistorySnapshot,
		options?: { historyTraversal?: boolean },
	): void {
		return inlineHistoryNavigation._applyInlineHistorySnapshot.call(
			this,
			snapshot,
			options,
		);
	}

	_restoreInlineHistorySnapshotFromUndo(
		snapshot: AIInlineHistorySnapshot,
	): void {
		return inlineHistoryNavigation._restoreInlineHistorySnapshotFromUndo.call(
			this,
			snapshot,
		);
	}

	// inlineHistoryRestore
	_findInlineHistorySnapshotForResolvedTurn(
		session: AISession,
		direction: AIInlineHistoryDirection,
	): AIInlineHistorySnapshot | null {
		return inlineHistoryRestore._findInlineHistorySnapshotForResolvedTurn.call(
			this,
			session,
			direction,
		);
	}

	_resolveInlineHistoryTraversalSnapshot(
		targetSnapshot: AIInlineHistorySnapshot,
	): AIInlineHistorySnapshot {
		return inlineHistoryRestore._resolveInlineHistoryTraversalSnapshot.call(
			this,
			targetSnapshot,
		);
	}

	_resolveShortcutInlineHistoryTraversalSnapshot(
		targetSnapshot: AIInlineHistorySnapshot,
		sessionId?: string | null,
	): AIInlineHistorySnapshot {
		return inlineHistoryRestore._resolveShortcutInlineHistoryTraversalSnapshot.call(
			this,
			targetSnapshot,
			sessionId,
		);
	}

	_scheduleQueuedInlineHistoryShortcutFlush(): void {
		return inlineHistoryRestore._scheduleQueuedInlineHistoryShortcutFlush.call(
			this,
		);
	}

	_resolvePendingInlineHistoryRestoreTargetIndex(
		request: AIInlineHistoryRestoreRequest,
	): number {
		return inlineHistoryRestore._resolvePendingInlineHistoryRestoreTargetIndex.call(
			this,
			request,
		);
	}

	_handleHistoryApplied(event: HistoryAppliedEvent): void {
		return inlineHistoryRestore._handleHistoryApplied.call(this, event);
	}

	_createInlineTurnUndoBeforeSnapshot(
		sessionId: string,
		turnId: string,
	): AIInlineHistorySnapshot {
		return inlineHistoryRestore._createInlineTurnUndoBeforeSnapshot.call(
			this,
			sessionId,
			turnId,
		);
	}
}
