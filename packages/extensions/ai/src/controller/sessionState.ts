import {
	generateId,
	type Editor,
	type TextSelection,
	type UndoHistoryMetadataController,
} from "@input/pen-types";
import {
	acceptSuggestions,
	rejectSuggestions,
} from "../suggestions/acceptReject";
import { AI_SESSION_SUGGESTION_ORIGIN } from "../suggestions/suggestMode";
import type {
	AICommandExecutionOptions,
	AIControllerState,
	AIContextualPromptRect,
	AIInlineHistoryDirection,
	AIInlineHistorySnapshot,
	AISession,
	AISessionResolution,
	AISurface,
	CommitDebugState,
	GenerationState,
	PersistentSuggestion,
} from "../types";
import { SuggestionListIndex } from "../suggestions/suggestionListIndex";
import type {
	AIInlineHistoryRestoreRequest,
	GenerationExecutionContext,
} from "../helpers";
import {
	AI_UNDO_HISTORY_METADATA_KEY,
	accumulateSessionCommitMetrics,
	areAIControllerStatesEqual,
	areSessionsEqual,
	areStructuredValuesEqual,
	canReuseBottomChatSessionOperation,
	closeInlineSessionPrompt,
	createDefaultSessionCommitMetrics,
	createInlineHistorySnapshot,
	resolveAcceptedInlineSelectionTarget,
	resolveBlockIdForRequestedOperation,
	resolveContextualPromptAnchor,
	resolveContextualPromptState,
	resolveLiveInlineSelectionTarget,
	resolvePreviousGeneratedBlockIds,
	resolveRequestedOperationForSession,
	resolveSelectionForRequestedOperation,
	resolveSessionAnchor,
	resolveSessionSelectionSnapshot,
	resolveSessionTarget,
	sessionTargetMatches,
	shouldReplacePreviousGeneratedBlocks,
} from "../helpers";

export interface AIControllerSessionState {
	_recordInlinePromptSubmissionCheckpoint(
		sessionId: string,
		prompt: string,
	): void;
	_runSelectionGeneration(
		prompt: string,
		selection: TextSelection,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState>;
	_runDocumentGeneration(
		prompt: string,
		preferredBlockId?: string | null,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState>;
	_runBlockGeneration(
		prompt: string,
		blockId: string,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState>;
	cancelActiveGeneration(): void;
	_recordInlineHistorySnapshot(
		previousState: AIControllerState,
		nextState: AIControllerState,
	): void;
	_createInlineTurnUndoBeforeSnapshot(
		sessionId: string,
		turnId: string,
	): AIInlineHistorySnapshot;
	clearStreamingReviewPreview(sessionId?: string): void;
	_navigateInlineHistory(
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): boolean;
	_canHandleInlineHistoryShortcut(
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): boolean;
}

export class AIControllerSessionState {
	readonly _editor: Editor;

	readonly _listeners = new Set<() => void>();

	readonly _sessionListeners = new Set<() => void>();

	_state: AIControllerState;

	_suggestions: PersistentSuggestion[] = [];

	/** Per-block suggestions; a commit re-reads only the blocks it touched (SCALE2). */
	// Read through `this: AIControllerImpl` method objects, which fallow cannot follow.
	// fallow-ignore-next-line unused-class-member
	readonly _suggestionList = new SuggestionListIndex();

	_documentVersion = 0;

	_undoHistoryMetadata: UndoHistoryMetadataController | null = null;

	_pendingInlineHistoryRestore: AIInlineHistoryRestoreRequest | null = null;

	_isRestoringInlineHistory = false;

	_unsubscribeInlineCompletion: (() => void) | null = null;

	_unsubscribeHistoryApplied: (() => void) | null = null;

	_unsubscribeUndoHistoryMetadata: (() => void) | null = null;

	constructor(editor: Editor, initialState: AIControllerState) {
		this._editor = editor;
		this._state = initialState;
	}

	destroy(): void {
		this._unsubscribeInlineCompletion?.();
		this._unsubscribeInlineCompletion = null;
		this._unsubscribeHistoryApplied?.();
		this._unsubscribeHistoryApplied = null;
		this._unsubscribeUndoHistoryMetadata?.();
		this._unsubscribeUndoHistoryMetadata = null;
	}

	getState(): AIControllerState {
		return this._state;
	}

	subscribe(listener: () => void): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	getSessions(): readonly AISession[] {
		return this._state.sessions;
	}

	getActiveSession(): AISession | null {
		const activeSessionId = this._state.activeSessionId;
		if (!activeSessionId) {
			return null;
		}
		return (
			this._state.sessions.find(
				(session) => session.id === activeSessionId,
			) ?? null
		);
	}

	subscribeSessions(listener: () => void): () => void {
		this._sessionListeners.add(listener);
		return () => this._sessionListeners.delete(listener);
	}

	startSession(input: {
		surface: AISurface;
		target?: "auto" | "selection" | "block" | "document";
	}): AISession {
		const now = Date.now();
		const target = resolveSessionTarget(this._editor, input.target);
		const session: AISession = {
			id: generateId(),
			surface: input.surface,
			status: "idle",
			target,
			contextualPrompt:
				input.surface === "inline-edit"
					? resolveContextualPromptState(this._editor, target)
					: undefined,
			turns: [],
			activeTurnId: undefined,
			promptHistory: [],
			generationIds: [],
			pendingSuggestionIds: [],
			createdAt: now,
			updatedAt: now,
			metrics: {
				streamEventCount: 0,
				patchCount: 0,
				commit: createDefaultSessionCommitMetrics(),
			},
			anchor: resolveSessionAnchor(this._editor, this._editor.selection),
		};
		this._setState({
			sessions: [...this._state.sessions, session],
			activeSessionId: session.id,
		});
		return session;
	}

	openContextualPrompt(input?: {
		surface?: Extract<AISurface, "inline-edit">;
		target?: "auto" | "selection" | "block" | "document";
	}): AISession | null {
		const surface = input?.surface ?? "inline-edit";
		const target = resolveSessionTarget(
			this._editor,
			input?.target ?? "selection",
		);
		if (surface === "inline-edit" && target.kind === "document") {
			return null;
		}
		const activeSession = this._state.sessions.find(
			(session) =>
				session.id === this._state.activeSessionId &&
				session.surface === surface &&
				session.status !== "cancelled",
		);
		if (
			activeSession &&
			activeSession.status !== "complete" &&
			sessionTargetMatches(this._editor, activeSession, target)
		) {
			this._updateSession(activeSession.id, {
				target,
				anchor: resolveSessionAnchor(
					this._editor,
					this._editor.selection,
				),
				contextualPrompt: {
					...(activeSession.contextualPrompt ??
						resolveContextualPromptState(this._editor, target)),
					anchor: resolveContextualPromptAnchor(this._editor, target),
					composer: {
						...(activeSession.contextualPrompt?.composer ?? {
							draftPrompt: "",
							isSubmitting: false,
							canSubmitFollowUp: true,
							openReason: "user",
						}),
						isOpen: true,
						openReason: "user",
					},
				},
			});
			return this.getActiveSession();
		}
		if (activeSession?.surface === "inline-edit") {
			this._setInlineSessionComposerOpen(activeSession.id, false);
		}
		const nextSession = this.startSession({
			surface,
			target: input?.target ?? "selection",
		});
		const anchorKind = nextSession.contextualPrompt?.anchor.kind;
		return anchorKind === "text-range" || anchorKind === "block"
			? nextSession
			: null;
	}

	updateContextualPromptDraft(sessionId: string, draftPrompt: string): void {
		const session = this._state.sessions.find(
			(item) => item.id === sessionId,
		);
		if (!session?.contextualPrompt) {
			return;
		}
		this._updateSession(sessionId, {
			contextualPrompt: {
				...session.contextualPrompt,
				composer: {
					...session.contextualPrompt.composer,
					draftPrompt,
				},
			},
		});
	}

	setContextualPromptAnchorRect(
		sessionId: string,
		rect: AIContextualPromptRect | null,
	): void {
		const session = this._state.sessions.find(
			(item) => item.id === sessionId,
		);
		if (!session?.contextualPrompt) {
			return;
		}
		this._updateSession(sessionId, {
			contextualPrompt: {
				...session.contextualPrompt,
				anchor: {
					...session.contextualPrompt.anchor,
					lastResolvedRect: rect,
				},
			},
		});
	}

	resolveSessionTurn(
		sessionId: string,
		turnId: string,
		resolution: AISessionResolution,
	): boolean {
		return this._resolveSessionTurn(sessionId, turnId, resolution);
	}

	acceptSessionTurn(sessionId: string, turnId: string): boolean {
		return this.resolveSessionTurn(sessionId, turnId, "accept");
	}

	rejectSessionTurn(sessionId: string, turnId: string): boolean {
		return this.resolveSessionTurn(sessionId, turnId, "reject");
	}

	runSessionPrompt(
		sessionId: string,
		prompt: string,
		options?: AICommandExecutionOptions,
	): Promise<GenerationState> {
		const session = this._state.sessions.find(
			(item) => item.id === sessionId,
		);
		if (!session) {
			return Promise.reject(
				new Error(`Unknown AI session "${sessionId}"`),
			);
		}
		this._recordInlinePromptSubmissionCheckpoint(sessionId, prompt);

		const operation =
			options?.operation ??
			resolveRequestedOperationForSession(
				this._editor,
				session,
				prompt,
				options,
				this._documentVersion,
			);
		if (operation.kind === "rewrite-selection") {
			const selection = resolveSelectionForRequestedOperation(
				this._editor,
				operation,
			);
			if (!selection) {
				return Promise.reject(
					new Error(
						"Cannot run a session prompt without a valid text selection",
					),
				);
			}
			return this._runSelectionGeneration(
				prompt,
				selection,
				undefined,
				options?.maxSteps,
				{
					sessionId,
					surface: session.surface,
					operation,
				},
			);
		}
		if (operation.kind === "document-transform") {
			const targetBlockIds =
				operation.target.kind === "document" &&
				(operation.target.blockIds?.length ?? 0) > 0
					? [...(operation.target.blockIds ?? [])]
					: undefined;
			const replacePreviousGeneratedBlocks =
				shouldReplacePreviousGeneratedBlocks(session, prompt);
			return this._runDocumentGeneration(
				prompt,
				options?.blockId ??
					(operation.target.kind === "document"
						? operation.target.activeBlockId
						: null),
				undefined,
				options?.maxSteps,
				{
					sessionId,
					surface: session.surface,
					operation,
					replaceBlockIds:
						targetBlockIds ??
						(replacePreviousGeneratedBlocks
							? resolvePreviousGeneratedBlockIds(session)
							: undefined),
				},
			);
		}
		const blockId =
			options?.blockId ??
			resolveBlockIdForRequestedOperation(operation) ??
			this._editor.lastBlock()?.id ??
			this._editor.firstBlock()?.id;
		if (!blockId) {
			return Promise.reject(
				new Error(
					"Cannot run an AI session prompt without a target block",
				),
			);
		}
		return this._runBlockGeneration(
			prompt,
			blockId,
			undefined,
			options?.maxSteps,
			{
				sessionId,
				surface: session.surface,
				operation,
			},
		);
	}

	canReuseSessionPrompt(
		sessionId: string,
		prompt: string,
		options?: AICommandExecutionOptions,
	): boolean {
		const session = this._state.sessions.find(
			(item) => item.id === sessionId,
		);
		if (!session) {
			return false;
		}
		if (session.surface !== "bottom-chat" || !session.operation) {
			return true;
		}
		const nextOperation =
			options?.operation ??
			resolveRequestedOperationForSession(
				this._editor,
				session,
				prompt,
				options,
				this._documentVersion,
			);
		return canReuseBottomChatSessionOperation(
			session.operation,
			nextOperation,
		);
	}

	resolveSession(
		sessionId: string,
		resolution: AISessionResolution,
	): boolean {
		const session = this._state.sessions.find(
			(item) => item.id === sessionId,
		);
		if (!session) {
			return false;
		}
		let resolved = false;
		for (const turn of session.turns) {
			resolved =
				this._resolveSessionTurn(sessionId, turn.id, resolution, {
					finalizeSession: false,
				}) || resolved;
		}
		if (resolved) {
			const nextSession =
				this._state.sessions.find((item) => item.id === sessionId) ??
				session;
			this._updateSession(sessionId, {
				status: "complete",
				pendingSuggestionIds: [],
				contextualPrompt: closeInlineSessionPrompt(nextSession),
			});
		}
		return resolved;
	}

	acceptSession(sessionId: string): boolean {
		return this.resolveSession(sessionId, "accept");
	}

	rejectSession(sessionId: string): boolean {
		return this.resolveSession(sessionId, "reject");
	}

	cancelSession(sessionId: string): void {
		if (this._state.activeGeneration?.sessionId === sessionId) {
			this.cancelActiveGeneration();
		}
		const session = this._state.sessions.find(
			(item) => item.id === sessionId,
		);
		this._updateSession(sessionId, {
			status: "cancelled",
			contextualPrompt: session?.contextualPrompt
				? {
						...session.contextualPrompt,
						composer: {
							...session.contextualPrompt.composer,
							isOpen: false,
							isSubmitting: false,
						},
					}
				: undefined,
		});
	}

	suspendInlineSession(sessionId: string): void {
		this._setInlineSessionComposerOpen(sessionId, false);
	}

	resumeInlineSession(sessionId: string): void {
		this._setInlineSessionComposerOpen(sessionId, true, {
			openReason: "user",
		});
	}

	_setState(partial: Partial<AIControllerState>): void {
		const previousState = this._state;
		const nextState = { ...this._state, ...partial };
		if (areAIControllerStatesEqual(previousState, nextState)) {
			return;
		}
		this._state = nextState;
		if (
			!this._isRestoringInlineHistory &&
			!this._pendingInlineHistoryRestore
		) {
			this._recordInlineHistorySnapshot(previousState, nextState);
		}
		this._editor.requestDecorationUpdate();
		this._emit();
	}

	_emit(): void {
		for (const listener of this._listeners) {
			listener();
		}
		for (const listener of this._sessionListeners) {
			listener();
		}
	}

	_updateSessionTurn(
		sessionId: string,
		turnId: string,
		overrides: Partial<AISession["turns"][number]>,
	): void {
		const session = this._state.sessions.find(
			(item) => item.id === sessionId,
		);
		if (!session) {
			return;
		}
		const nextTurns = session.turns.map((turn) =>
			turn.id !== turnId
				? turn
				: {
						...turn,
						...overrides,
					},
		);
		if (areStructuredValuesEqual(session.turns, nextTurns)) {
			return;
		}
		const pendingSuggestionIds = [
			...new Set(nextTurns.flatMap((turn) => turn.suggestionIds)),
		];
		this._updateSession(sessionId, {
			turns: nextTurns,
			pendingSuggestionIds,
		});
	}

	_syncSessionsFromDocument(): boolean {
		if (this._state.sessions.length === 0) {
			return false;
		}
		const nextSessions = this._state.sessions.map((session) => {
			const nextTurns = session.turns.map((turn) => {
				const suggestionIds = turn.suggestionIds.filter(
					(sessionSuggestionId) =>
						this._suggestions.some(
							(suggestion) =>
								suggestion.id === sessionSuggestionId,
						),
				);
				return {
					...turn,
					suggestionIds,
				};
			});
			const pendingSuggestionIds = [
				...new Set(nextTurns.flatMap((turn) => turn.suggestionIds)),
			];
			const nextStatus =
				pendingSuggestionIds.length === 0 &&
				session.status === "streaming"
					? "complete"
					: session.status;
			return {
				...session,
				status: nextStatus,
				turns: nextTurns,
				pendingSuggestionIds,
			};
		});
		if (areSessionsEqual(this._state.sessions, nextSessions)) {
			return false;
		}
		this._setState({
			sessions: nextSessions,
		});
		return true;
	}

	_resolveSessionTurn(
		sessionId: string,
		turnId: string,
		resolution: AISessionResolution,
		options?: { finalizeSession?: boolean },
	): boolean {
		const session = this._state.sessions.find(
			(item) => item.id === sessionId,
		);
		const turn = session?.turns.find((item) => item.id === turnId);
		if (!session || !turn) {
			return false;
		}
		const isBottomChatDocumentTurn =
			session.surface === "bottom-chat" &&
			(turn.target === "document" ||
				turn.operation?.kind === "document-transform" ||
				(turn.operation?.kind === "rewrite-selection" &&
					turn.operation.target.kind === "scoped-range" &&
					(turn.operation.target.scope === "document" ||
						turn.operation.target.contentFormat === "markdown")));
		const turnUndoGroupId = isBottomChatDocumentTurn
			? turn.undoGroupId
			: undefined;
		const turnSuggestionResolutionOrigin =
			turnUndoGroupId != null ? AI_SESSION_SUGGESTION_ORIGIN : undefined;
		const undoHistoryBeforeSnapshot = this._undoHistoryMetadata
			? this._createInlineTurnUndoBeforeSnapshot(sessionId, turnId)
			: null;
		const refreshedInlineSelectionTarget =
			session.surface === "inline-edit" && resolution === "accept"
				? (resolveAcceptedInlineSelectionTarget(
						this._editor,
						turn.operation,
						turn.suggestionIds,
					) ?? resolveLiveInlineSelectionTarget(this._editor))
				: null;
		const resolveSuggestionsForTurn =
			resolution === "accept"
				? (suggestionIds: readonly string[]) =>
						acceptSuggestions(this._editor, suggestionIds, {
							origin: turnSuggestionResolutionOrigin,
							undoGroupId: turnUndoGroupId,
						})
				: (suggestionIds: readonly string[]) =>
						rejectSuggestions(this._editor, suggestionIds, {
							origin: turnSuggestionResolutionOrigin,
							undoGroupId: turnUndoGroupId,
						});
		let resolved = false;
		resolved = resolveSuggestionsForTurn(turn.suggestionIds) || resolved;
		if (!resolved) {
			return false;
		}
		this.clearStreamingReviewPreview(sessionId);
		this._updateSessionTurn(sessionId, turnId, {
			status: resolution === "accept" ? "accepted" : "rejected",
			suggestionIds: [],
			anchor: refreshedInlineSelectionTarget
				? resolveSessionAnchor(
						this._editor,
						refreshedInlineSelectionTarget.selection,
					)
				: undefined,
			selection: refreshedInlineSelectionTarget
				? resolveSessionSelectionSnapshot(
						this._editor,
						refreshedInlineSelectionTarget.selection,
					)
				: undefined,
		});
		if (refreshedInlineSelectionTarget) {
			this._updateSession(sessionId, {
				target: refreshedInlineSelectionTarget,
				anchor: resolveSessionAnchor(
					this._editor,
					refreshedInlineSelectionTarget.selection,
				),
				contextualPrompt: session.contextualPrompt
					? {
							...session.contextualPrompt,
							anchor: resolveContextualPromptAnchor(
								this._editor,
								refreshedInlineSelectionTarget,
							),
						}
					: undefined,
			});
		}
		if (options?.finalizeSession === false) {
			if (undoHistoryBeforeSnapshot) {
				this._undoHistoryMetadata?.setCurrentEntryMetadata(
					AI_UNDO_HISTORY_METADATA_KEY,
					{
						before: undoHistoryBeforeSnapshot,
						after: createInlineHistorySnapshot(
							this._editor,
							this._state.sessions,
							this._state.activeSessionId ?? null,
							this._documentVersion,
							{ kind: "document-coupled" },
						),
					},
				);
			}
			return true;
		}
		const nextSession =
			this._state.sessions.find((item) => item.id === sessionId) ??
			session;
		this._updateSession(sessionId, {
			status: "complete",
			contextualPrompt: closeInlineSessionPrompt(nextSession),
		});
		if (undoHistoryBeforeSnapshot) {
			this._undoHistoryMetadata?.setCurrentEntryMetadata(
				AI_UNDO_HISTORY_METADATA_KEY,
				{
					before: undoHistoryBeforeSnapshot,
					after: createInlineHistorySnapshot(
						this._editor,
						this._state.sessions,
						this._state.activeSessionId ?? null,
						this._documentVersion,
						{ kind: "document-coupled" },
					),
				},
			);
		}
		return true;
	}

	_updateSession(sessionId: string, overrides: Partial<AISession>): void {
		const nextSessions = this._state.sessions.map((session) =>
			session.id !== sessionId
				? session
				: {
						...session,
						...overrides,
						contextualPrompt:
							(overrides.contextualPrompt ??
							session.contextualPrompt)
								? {
										...(session.contextualPrompt ??
											resolveContextualPromptState(
												this._editor,
												overrides.target ??
													session.target,
											)),
										...(overrides.contextualPrompt ?? {}),
										anchor: {
											...(
												session.contextualPrompt ??
												resolveContextualPromptState(
													this._editor,
													overrides.target ??
														session.target,
												)
											).anchor,
											...(overrides.contextualPrompt
												?.anchor ?? {}),
										},
										composer: {
											...(
												session.contextualPrompt ??
												resolveContextualPromptState(
													this._editor,
													overrides.target ??
														session.target,
												)
											).composer,
											...(overrides.contextualPrompt
												?.composer ?? {}),
											isSubmitting:
												overrides.contextualPrompt
													?.composer?.isSubmitting ??
												(overrides.status ===
												"streaming"
													? true
													: overrides.status
														? false
														: (
																session.contextualPrompt ??
																resolveContextualPromptState(
																	this
																		._editor,
																	overrides.target ??
																		session.target,
																)
															).composer
																.isSubmitting),
										},
									}
								: undefined,
						updatedAt: Date.now(),
						metrics: {
							...session.metrics,
							...(overrides.metrics ?? {}),
						},
					},
		);
		if (nextSessions === this._state.sessions) {
			return;
		}
		this._setState({
			sessions: nextSessions,
			activeSessionId:
				this._state.activeSessionId === sessionId ||
				this._state.activeSessionId == null
					? sessionId
					: this._state.activeSessionId,
		});
	}

	_recordSessionCommitMetrics(
		sessionId: string,
		commit: CommitDebugState | undefined,
	): void {
		const session = this._state.sessions.find(
			(item) => item.id === sessionId,
		);
		if (!session) {
			return;
		}
		this._updateSession(sessionId, {
			metrics: {
				...session.metrics,
				commit: accumulateSessionCommitMetrics(
					session.metrics.commit,
					commit,
				),
			},
		});
	}

	_setInlineSessionComposerOpen(
		sessionId: string,
		isOpen: boolean,
		options?: { openReason?: "user" | "history" },
	): void {
		const session = this._state.sessions.find(
			(item) => item.id === sessionId,
		);
		if (
			!session ||
			session.surface !== "inline-edit" ||
			!session.contextualPrompt
		) {
			return;
		}
		const nextActiveSessionId = isOpen
			? sessionId
			: this._state.activeSessionId === sessionId
				? null
				: this._state.activeSessionId;
		if (
			session.contextualPrompt.composer.isOpen === isOpen &&
			nextActiveSessionId === this._state.activeSessionId
		) {
			return;
		}
		const nextSessions = this._state.sessions.map((item) =>
			item.id !== sessionId
				? item
				: {
						...item,
						contextualPrompt: {
							...item.contextualPrompt!,
							composer: {
								...item.contextualPrompt!.composer,
								isOpen,
								openReason: isOpen
									? (options?.openReason ?? "user")
									: item.contextualPrompt!.composer
											.openReason,
							},
						},
						updatedAt: Date.now(),
					},
		);
		this._setState({
			sessions: nextSessions,
			activeSessionId: nextActiveSessionId,
		});
	}
}
