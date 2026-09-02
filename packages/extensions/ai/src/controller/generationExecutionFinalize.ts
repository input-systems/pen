import type { GenerationState } from "../types";
import type { AIControllerImpl } from "./aiController";
import {
	createAIStreamEvent,
	createDefaultSessionCommitMetrics,
	resolveLiveInlineSelectionTarget,
	resolvePendingInlineSelectionTarget,
	resolveScopedSelectionRewriteContentFormat,
	resolveSessionAnchor,
	resolveSessionSelectionSnapshot,
} from "../helpers";
import type { GenerationExecutionState } from "./generationExecutionState";
import type { GenerationStreamingSink } from "./streamingSink";
import {
	calledEditTool,
	editToolAccountedForEdit,
	EDIT_NOT_APPLIED_REASON,
	isUnappliedEdit,
} from "./unappliedEdit";

function commitBufferedText(
	controller: AIControllerImpl,
	state: GenerationExecutionState,
	sink: Extract<
		GenerationStreamingSink,
		{ kind: "review-preview" } | { kind: "buffered-commit" }
	>,
): void {
	const {
		target,
		route,
		context,
		seedGeneration,
		contentFormat,
		workingSet,
		shouldReplaceMarkdownTarget,
	} = state;
	if (state.currentText.length === 0) {
		return;
	}
	if (sink.kind === "review-preview") {
		controller.clearStreamingReviewPreview(
			context?.sessionId ?? seedGeneration.id,
		);
		if (sink.source === "selection" && target.type === "selection") {
			// a block-scoped rewrite replaces the selected blocks with the
			// markdown the model returned; a text splice would fold every
			// paragraph of the reply into the first block
			state.currentMutationReceipt =
				state.requestedOperation &&
				resolveScopedSelectionRewriteContentFormat(
					state.requestedOperation,
				) === "markdown"
					? controller._commitRequestedOperationResult(
							state.requestedOperation,
							state.currentText,
							context?.sessionId,
							{ contentFormat },
						)
					: controller._commitSelectionRewrite(
							target.selection,
							state.currentText,
							route.mutationMode,
							context?.sessionId,
						);
			return;
		}
	}
	if (target.type !== "block") {
		return;
	}
	state.currentMutationReceipt = controller._commitBufferedBlockGeneration(
		target.blockId,
		state.currentText,
		route.mutationMode,
		contentFormat,
		context?.sessionId,
		{
			insertionOffset: target.offset,
			workingSet,
			replaceTargetBlock: shouldReplaceMarkdownTarget,
			replaceBlockIds: context?.replaceBlockIds,
		},
	);
	controller._inlineCompletion.dismissSuggestion();
}

function closeStreamingSink(
	controller: AIControllerImpl,
	state: GenerationExecutionState,
): void {
	const { streamingSink, selectionSourceText } = state;
	switch (streamingSink.kind) {
		case "direct-write":
			return;
		case "suggestion-splice":
			if (state.currentText.length > 0) {
				controller._recordCommitDebug({
					attempted: true,
					succeeded: true,
					executionPath: "selection-replacement",
					contextChars: selectionSourceText.length,
					diffChars: state.currentText.length,
				});
			}
			return;
		case "review-preview":
		case "buffered-commit":
			commitBufferedText(controller, state, streamingSink);
			return;
		case "none":
			return;
		default: {
			const exhaustive: never = streamingSink;
			return exhaustive;
		}
	}
}

export function finalizeGenerationExecution(
	controller: AIControllerImpl,
	state: GenerationExecutionState,
	result: GenerationState,
): GenerationState {
	const {
		target,
		streamingSink,
		route,
		context,
		seedGeneration,
		contentFormat,
		blockId,
		requestedOperation,
		sessionTurnId,
		commandId,
		baselineSuggestionIds,
	} = state;
	closeStreamingSink(controller, state);

	const suggestionIds = controller
		.getSuggestions()
		.map((item) => item.id)
		.filter((id) => !baselineSuggestionIds.has(id));
	if (!state.currentMutationReceipt) {
		state.currentMutationReceipt = controller._buildFallbackMutationReceipt(
			{
				committedText:
					streamingSink.kind !== "none" &&
					state.currentText.trim().length > 0,
				suggestionIds,
			},
		);
	}
	const resolvedDebug =
		controller._state.activeGeneration?.id === seedGeneration.id
			? (controller._state.activeGeneration.debug ??
				result.debug ??
				seedGeneration.debug!)
			: (result.debug ?? seedGeneration.debug!);
	const unappliedEdit =
		result.status === "complete" &&
		isUnappliedEdit({
			editAttempted: calledEditTool(result.steps),
			editAccountedFor: editToolAccountedForEdit(result.steps),
			receiptStatus: state.currentMutationReceipt?.status,
			suggestionCount: suggestionIds.length,
		});

	const finalGeneration: GenerationState = {
		...result,
		status: unappliedEdit ? "error" : result.status,
		turnReason: unappliedEdit ? EDIT_NOT_APPLIED_REASON : result.turnReason,
		blockId,
		target: target.type,
		sessionId: context?.sessionId,
		turnId: sessionTurnId,
		surface: context?.surface,
		commandId,
		text: state.currentText,
		suggestionIds,
		route: route.lane,
		mutationMode: route.mutationMode,
		contentFormat,
		editsArriveAsToolCalls: route.editsArriveAsToolCalls,
		targetKind: route.targetKind,
		mutationReceipt: state.currentMutationReceipt,
		debug: resolvedDebug,
	};
	controller._abortController = null;
	controller._appendStreamEvent(
		createAIStreamEvent(seedGeneration, {
			type: "generation-finish",
			status: finalGeneration.status,
			text: state.currentText,
		}),
	);
	controller._setState({
		status: "idle",
		activeGeneration: finalGeneration,
	});
	if (context?.sessionId) {
		const refreshedInlineReviewSelectionTarget =
			context?.surface === "inline-edit" && suggestionIds.length > 0
				? (resolvePendingInlineSelectionTarget(
						controller._editor,
						requestedOperation ?? undefined,
						suggestionIds,
					) ?? resolveLiveInlineSelectionTarget(controller._editor))
				: null;
		if (sessionTurnId) {
			const receiptEvidence = state.currentMutationReceipt?.evidence;
			const generatedBlockIds = receiptEvidence
				? [
						...new Set([
							...receiptEvidence.affectedBlockIds,
							...receiptEvidence.createdBlockIds,
						]),
					]
				: [];
			controller._updateSessionTurn(context.sessionId, sessionTurnId, {
				status:
					suggestionIds.length > 0
						? "review"
						: finalGeneration.status === "complete"
							? "complete"
							: finalGeneration.status,
				suggestionIds,
				generatedBlockIds,
				anchor: refreshedInlineReviewSelectionTarget
					? resolveSessionAnchor(
							controller._editor,
							refreshedInlineReviewSelectionTarget.selection,
						)
					: undefined,
				selection: refreshedInlineReviewSelectionTarget
					? resolveSessionSelectionSnapshot(
							controller._editor,
							refreshedInlineReviewSelectionTarget.selection,
						)
					: undefined,
			});
		}
		const resolvedGenerationDebug =
			controller._state.activeGeneration?.id === finalGeneration.id
				? controller._state.activeGeneration.debug
				: finalGeneration.debug;
		controller._recordSessionCommitMetrics(
			context.sessionId,
			resolvedGenerationDebug?.commit,
		);
		controller._updateSession(context.sessionId, {
			status:
				finalGeneration.status === "complete"
					? "complete"
					: finalGeneration.status,
			pendingSuggestionIds: suggestionIds,
			metrics: {
				...(controller._state.sessions.find(
					(session) => session.id === context.sessionId,
				)?.metrics ?? {
					streamEventCount: 0,
					patchCount: 0,
					commit: createDefaultSessionCommitMetrics(),
				}),
				firstTokenMs:
					resolvedGenerationDebug?.firstVisibleTextMs ?? undefined,
				totalMs:
					resolvedGenerationDebug?.messageAssemblyLatencyMs != null
						? resolvedGenerationDebug.messageAssemblyLatencyMs +
							(resolvedGenerationDebug.toolExecutionMs ?? 0)
						: undefined,
				toolMs: resolvedGenerationDebug?.toolExecutionMs ?? undefined,
				streamEventCount: controller._streamEvents.filter(
					(event) => event.sessionId === context.sessionId,
				).length,
			},
		});
	}

	if (finalGeneration.status === "complete") {
		controller._editor.internals.emit("diagnostic", {
			level: "info",
			source: "ai",
			code: "GENERATION_COMPLETE",
			message: "AI generation completed",
			blockId,
			generationId: finalGeneration.id,
		});
	} else if (unappliedEdit) {
		controller._editor.internals.emit("diagnostic", {
			level: "warn",
			source: "ai",
			code: "GENERATION_EDIT_NOT_APPLIED",
			message: EDIT_NOT_APPLIED_REASON,
			blockId,
			generationId: finalGeneration.id,
		});
	}

	return finalGeneration;
}

export function handleGenerationExecutionError(
	controller: AIControllerImpl,
	state: GenerationExecutionState,
	error: unknown,
): GenerationState {
	const {
		seedGeneration,
		blockId,
		context,
		sessionTurnId,
		commandId,
		target,
		abortController,
		route,
		streamingTarget,
		prompt,
	} = state;
	const isStaleWorkingSet =
		error instanceof Error && error.name === "StaleWorkingSetError";
	const failedGeneration: GenerationState = {
		...(controller._state.activeGeneration ?? seedGeneration),
		blockId,
		sessionId: context?.sessionId,
		turnId: sessionTurnId,
		surface: context?.surface,
		prompt,
		commandId,
		text: state.currentText,
		status:
			abortController.signal.aborted || isStaleWorkingSet
				? "cancelled"
				: "error",
		targetKind: route.targetKind,
	};
	controller._abortController = null;
	controller._inlineCompletion.dismissSuggestion();
	if (target.type === "block" && state.blockStreamingStarted) {
		streamingTarget?.endStreaming(
			abortController.signal.aborted ? "cancelled" : "error",
		);
		state.blockStreamingStarted = false;
	}
	controller._appendStreamEvent(
		createAIStreamEvent(seedGeneration, {
			type: "generation-finish",
			status: failedGeneration.status,
			text: state.currentText,
		}),
	);
	controller._setState({
		status: "idle",
		activeGeneration: failedGeneration,
	});
	if (context?.sessionId) {
		if (sessionTurnId) {
			controller._updateSessionTurn(context.sessionId, sessionTurnId, {
				status: failedGeneration.status,
			});
		}
		controller._updateSession(context.sessionId, {
			status: failedGeneration.status,
		});
	}
	if (abortController.signal.aborted || isStaleWorkingSet) {
		return failedGeneration;
	}
	throw error;
}
