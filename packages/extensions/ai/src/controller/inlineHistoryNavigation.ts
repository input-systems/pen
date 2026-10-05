import { isCollapsed } from "@input/pen-core";
import type {
	AIExternalInlineTurnResult,
	AIInlineHistoryDirection,
	AIInlineHistorySnapshot,
} from "../types";
import { rejectSuggestions } from "../suggestions/acceptReject";
import type { AIControllerImpl } from "./aiController";
import type { AIInlineShortcutHistoryWaypoint } from "../helpers";
import {
	areInlineShortcutHistoryStatesEqual,
	cloneInlineHistorySessions,
	resolveInlineShortcutHistoryState,
	sessionSelectionMatches,
	shouldReplaceInlineShortcutWaypointRepresentative,
} from "../helpers";

export const inlineHistoryNavigation = {
	_resolveInlineHistoryTargetIndex(
		this: AIControllerImpl,
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): number {
		const step = direction === "undo" ? -1 : 1;
		if (!options?.shortcutOnly) {
			return this._inlineHistoryIndex + step;
		}
		const currentSnapshot =
			this._inlineHistory[this._inlineHistoryIndex] ?? null;
		const scopedSessionId = this._resolveShortcutInlineHistorySessionId(
			currentSnapshot,
			direction,
		);
		const waypoints =
			this._buildInlineShortcutHistoryWaypoints(scopedSessionId);
		if (waypoints.length === 0) {
			return -1;
		}
		const currentWaypointIndex =
			this._resolveCurrentInlineShortcutWaypointIndex(
				waypoints,
				scopedSessionId,
			);
		if (currentWaypointIndex < 0) {
			return -1;
		}
		const targetWaypoint = waypoints[currentWaypointIndex + step];
		return targetWaypoint?.representativeIndex ?? -1;
	},

	_resolveShortcutInlineHistorySessionId(
		this: AIControllerImpl,
		currentSnapshot: AIInlineHistorySnapshot | null,
		direction: AIInlineHistoryDirection,
	): string | null {
		const activeSession = this.getActiveSession();
		if (activeSession?.surface === "inline-edit") {
			return activeSession.id;
		}
		const selection = this._editor.selection;
		if (
			currentSnapshot &&
			selection?.type === "text" &&
			!isCollapsed(selection)
		) {
			const matchingSession = [...currentSnapshot.sessions]
				.reverse()
				.find(
					(session) =>
						session.surface === "inline-edit" &&
						sessionSelectionMatches(
							this._editor,
							session,
							selection,
						),
				);
			if (matchingSession) {
				return matchingSession.id;
			}
		}
		if (
			currentSnapshot?.activeSessionId &&
			currentSnapshot.sessions.some(
				(session) =>
					session.id === currentSnapshot.activeSessionId &&
					session.surface === "inline-edit",
			)
		) {
			return currentSnapshot.activeSessionId;
		}
		const currentInlineSession =
			[...(currentSnapshot?.sessions ?? [])]
				.reverse()
				.find((session) => session.surface === "inline-edit") ?? null;
		if (currentInlineSession) {
			return currentInlineSession.id;
		}
		const step = direction === "undo" ? -1 : 1;
		let searchIndex = this._inlineHistoryIndex + step;
		while (searchIndex >= 0 && searchIndex < this._inlineHistory.length) {
			const searchSnapshot = this._inlineHistory[searchIndex];
			const matchingSelectionSession =
				selection?.type === "text" && !isCollapsed(selection)
					? ([...(searchSnapshot?.sessions ?? [])]
							.reverse()
							.find(
								(session) =>
									session.surface === "inline-edit" &&
									sessionSelectionMatches(
										this._editor,
										session,
										selection,
									),
							) ?? null)
					: null;
			if (matchingSelectionSession) {
				return matchingSelectionSession.id;
			}
			const searchInlineSession =
				[...(searchSnapshot?.sessions ?? [])]
					.reverse()
					.find((session) => session.surface === "inline-edit") ??
				null;
			if (searchInlineSession) {
				return searchInlineSession.id;
			}
			searchIndex += step;
		}
		return null;
	},

	_buildInlineShortcutHistoryWaypoints(
		this: AIControllerImpl,
		sessionId: string | null,
	): AIInlineShortcutHistoryWaypoint[] {
		const waypoints: AIInlineShortcutHistoryWaypoint[] = [];
		for (let index = 0; index < this._inlineHistory.length; index += 1) {
			const snapshot = this._inlineHistory[index];
			if (!snapshot || snapshot.kind === "ui-local") {
				continue;
			}
			const state = resolveInlineShortcutHistoryState(
				snapshot,
				sessionId,
			);
			if (!state) {
				continue;
			}
			const previousWaypoint = waypoints[waypoints.length - 1] ?? null;
			if (
				previousWaypoint &&
				areInlineShortcutHistoryStatesEqual(
					previousWaypoint.state,
					state,
				)
			) {
				previousWaypoint.endIndex = index;
				if (
					shouldReplaceInlineShortcutWaypointRepresentative(
						previousWaypoint.state,
						this._inlineHistory[
							previousWaypoint.representativeIndex
						] ?? null,
						snapshot,
					)
				) {
					previousWaypoint.representativeIndex = index;
				}
				continue;
			}
			waypoints.push({
				startIndex: index,
				endIndex: index,
				representativeIndex: index,
				state,
			});
		}
		return waypoints;
	},

	_resolveCurrentInlineShortcutWaypointIndex(
		this: AIControllerImpl,
		waypoints: readonly AIInlineShortcutHistoryWaypoint[],
		sessionId: string | null,
	): number {
		const currentSnapshot =
			this._inlineHistory[this._inlineHistoryIndex] ?? null;
		const currentState = currentSnapshot
			? resolveInlineShortcutHistoryState(currentSnapshot, sessionId)
			: null;
		if (currentState) {
			const currentIndex = waypoints.findIndex(
				(waypoint) =>
					this._inlineHistoryIndex >= waypoint.startIndex &&
					this._inlineHistoryIndex <= waypoint.endIndex &&
					areInlineShortcutHistoryStatesEqual(
						waypoint.state,
						currentState,
					),
			);
			if (currentIndex >= 0) {
				return currentIndex;
			}
			const matchingIndex = waypoints.findIndex((waypoint) =>
				areInlineShortcutHistoryStatesEqual(
					waypoint.state,
					currentState,
				),
			);
			if (matchingIndex >= 0) {
				return matchingIndex;
			}
		}
		for (let index = waypoints.length - 1; index >= 0; index -= 1) {
			if (
				waypoints[index]!.representativeIndex <=
				this._inlineHistoryIndex
			) {
				return index;
			}
		}
		return waypoints.length > 0 ? 0 : -1;
	},

	_canHandleInlineHistoryShortcut(
		this: AIControllerImpl,
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): boolean {
		const targetIndex = this._resolveInlineHistoryTargetIndex(
			direction,
			options,
		);
		const targetSnapshot = this._inlineHistory[targetIndex];
		if (!targetSnapshot) {
			return false;
		}
		if (targetSnapshot.kind !== "ui-local") {
			return true;
		}
		return direction === "undo"
			? !this._editor.undoManager.canUndo()
			: !this._editor.undoManager.canRedo();
	},

	_resolveExternalInlineTurnTransition(
		this: AIControllerImpl,
		currentSnapshot: AIInlineHistorySnapshot | null,
		targetSnapshot: AIInlineHistorySnapshot,
		direction: AIInlineHistoryDirection,
	):
		| (AIExternalInlineTurnResult & {
				beforeSnapshotId?: string;
				afterSnapshotId?: string;
		  })
		| null {
		if (!currentSnapshot) {
			return null;
		}
		const results = this._externalInlineTurnRegistry.resolveTransition(
			currentSnapshot,
			targetSnapshot,
			direction,
			(snapshot, sessionId, turnId) =>
				this._inlineHistorySnapshotHasTurn(snapshot, sessionId, turnId),
		);
		return results;
	},

	_inlineHistorySnapshotHasTurn(
		this: AIControllerImpl,
		snapshot: AIInlineHistorySnapshot,
		sessionId: string,
		turnId: string,
	): boolean {
		const session =
			snapshot.sessions.find(
				(item) =>
					item.id === sessionId && item.surface === "inline-edit",
			) ?? null;
		return session?.turns.some((turn) => turn.id === turnId) === true;
	},

	_applyExternalInlineTurnTransition(
		this: AIControllerImpl,
		result: AIExternalInlineTurnResult,
		direction: AIInlineHistoryDirection,
		targetSnapshot: AIInlineHistorySnapshot,
		targetIndex: number,
		_options?: { shortcutOnly?: boolean },
	): boolean {
		if (direction === "undo") {
			const didReject = rejectSuggestions(
				this._editor,
				result.suggestionIds,
				{
					origin: "system",
				},
			);
			if (!didReject) {
				return false;
			}
		} else {
			this._applySuggestedAIOps(
				[...result.operations],
				result.sessionId,
				{
					generationId: result.historyId,
					origin: "system",
					suggestionIds: result.suggestionIds,
					turnId: result.turnId,
				},
			);
		}
		this._syncSuggestionsFromDocument();
		this._applyInlineHistorySnapshot(targetSnapshot, {
			historyTraversal: true,
		});
		this._inlineHistoryIndex = targetIndex;
		return true;
	},

	_navigateInlineHistory(
		this: AIControllerImpl,
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): boolean {
		const targetIndex = this._resolveInlineHistoryTargetIndex(
			direction,
			options,
		);
		const targetSnapshot = this._inlineHistory[targetIndex];
		if (!targetSnapshot) {
			return false;
		}
		const currentSnapshot =
			this._inlineHistory[this._inlineHistoryIndex] ?? null;
		const shortcutSessionId = options?.shortcutOnly
			? this._resolveShortcutInlineHistorySessionId(
					currentSnapshot,
					direction,
				)
			: null;
		const externalTransition = this._resolveExternalInlineTurnTransition(
			currentSnapshot,
			targetSnapshot,
			direction,
		);
		if (externalTransition) {
			return this._applyExternalInlineTurnTransition(
				externalTransition,
				direction,
				targetSnapshot,
				targetIndex,
				options,
			);
		}
		if (targetSnapshot.kind === "ui-local") {
			this._applyInlineHistorySnapshot(targetSnapshot, {
				historyTraversal: true,
			});
			this._inlineHistoryIndex = targetIndex;
			return true;
		}
		if (
			currentSnapshot &&
			currentSnapshot.documentVersion !== targetSnapshot.documentVersion
		) {
			const targetState = resolveInlineShortcutHistoryState(
				targetSnapshot,
				shortcutSessionId ??
					targetSnapshot.sessionId ??
					targetSnapshot.activeSessionId ??
					null,
			);
			this._pendingInlineHistoryRestore = {
				direction,
				targetSnapshotId: targetSnapshot.id,
				targetDocumentVersion: targetSnapshot.documentVersion,
				shortcutOnly: options?.shortcutOnly === true,
				sessionId: shortcutSessionId,
				targetState,
			};
			const restored =
				direction === "undo"
					? this._editor.undoManager.undo()
					: this._editor.undoManager.redo();
			if (!restored) {
				this._pendingInlineHistoryRestore = null;
				const externalTransition =
					this._resolveExternalInlineTurnTransition(
						currentSnapshot,
						targetSnapshot,
						direction,
					);
				if (externalTransition) {
					return this._applyExternalInlineTurnTransition(
						externalTransition,
						direction,
						targetSnapshot,
						targetIndex,
						options,
					);
				}
			}
			return restored;
		}
		const resolvedTargetSnapshot = options?.shortcutOnly
			? this._resolveShortcutInlineHistoryTraversalSnapshot(
					targetSnapshot,
					shortcutSessionId,
				)
			: targetSnapshot;
		this._applyInlineHistorySnapshot(resolvedTargetSnapshot, {
			historyTraversal: true,
		});
		this._inlineHistoryIndex = targetIndex;
		return true;
	},

	_applyInlineHistorySnapshot(
		this: AIControllerImpl,
		snapshot: AIInlineHistorySnapshot,
		options?: { historyTraversal?: boolean },
	): void {
		this._isRestoringInlineHistory = true;
		try {
			const restoredSessions = cloneInlineHistorySessions(
				this._editor,
				snapshot.sessions,
			).map((session) => {
				if (
					!options?.historyTraversal ||
					!session.contextualPrompt?.composer.isOpen
				) {
					return session;
				}
				return {
					...session,
					contextualPrompt: {
						...session.contextualPrompt,
						composer: {
							...session.contextualPrompt.composer,
							openReason: "history" as const,
						},
					},
				};
			});
			this._setState({
				status: "idle",
				activeGeneration: null,
				streamingReviewPreviews: [],
				sessions: restoredSessions,
				activeSessionId: snapshot.activeSessionId,
			});
		} finally {
			this._isRestoringInlineHistory = false;
		}
	},

	_restoreInlineHistorySnapshotFromUndo(
		this: AIControllerImpl,
		snapshot: AIInlineHistorySnapshot,
	): void {
		const targetIndex = this._inlineHistory.findIndex(
			(item) => item.id === snapshot.id,
		);
		if (targetIndex >= 0) {
			this._inlineHistoryIndex = targetIndex;
			this._applyInlineHistorySnapshot(
				this._inlineHistory[targetIndex]!,
				{
					historyTraversal: true,
				},
			);
			return;
		}
		this._applyInlineHistorySnapshot(snapshot, { historyTraversal: true });
		const nextHistory = this._inlineHistory.slice(
			0,
			this._inlineHistoryIndex + 1,
		);
		nextHistory.push(snapshot);
		this._inlineHistory = nextHistory;
		this._inlineHistoryIndex = nextHistory.length - 1;
	},
};
