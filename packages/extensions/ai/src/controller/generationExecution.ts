import { selectionToRange, streamingTargetFacet } from "@input/pen-core";
import { getDocumentToolRuntime } from "@input/pen-tools";
import { generateId, type StreamingTarget } from "@input/pen-types";
import { buildFlowMarkdownRequestPrompt } from "../runtime/flowMarkdown";
import { routeAIRequest } from "../runtime/router";
import type { GenerationState } from "../types";
import type { AIControllerImpl } from "./aiController";
import {
	beginGenerationSession,
	buildSessionExecutionPrompt,
	createAIStreamEvent,
	EMPTY_TOOL_RUNTIME,
	isLocalRequestedOperation,
	resolveScopedSelectionRewriteContentFormat,
	resolveSelectionText,
	shouldReplaceEmptyMarkdownTarget,
	shouldTrimLeadingBlankBlockGenerationText,
} from "../helpers";
import {
	finalizeGenerationExecution,
	handleGenerationExecutionError,
} from "./generationExecutionFinalize";
import { runGenerationLoop } from "./generationExecutionLoop";
import {
	createSuggestionSpliceHead,
	resolveGenerationStreamingSink,
} from "./streamingSink";
import type {
	ExecuteGenerationInput,
	GenerationExecutionState,
} from "./generationExecutionState";

export async function executeGeneration(
	controller: AIControllerImpl,
	input: ExecuteGenerationInput,
): Promise<GenerationState> {
	const { prompt, target, commandId, maxSteps, context } = input;
	if (!controller._model) {
		throw new Error("No AI model configured");
	}

	controller.cancelActiveGeneration();
	const toolRuntime =
		getDocumentToolRuntime(controller._editor) ?? EMPTY_TOOL_RUNTIME;
	const abortController = new AbortController();
	controller._abortController = abortController;

	const baselineSuggestionIds = new Set(
		controller.getSuggestions().map((item) => item.id),
	);
	const blockId =
		target.type === "block"
			? target.blockId
			: selectionToRange(
					controller._editor.internals.doc,
					target.selection,
				).start.blockId;
	const requestedOperation = context?.operation ?? null;
	if (
		context?.surface === "bottom-chat" &&
		isLocalRequestedOperation(requestedOperation)
	) {
		return controller._executeLocalOperation({
			prompt,
			target,
			blockId,
			commandId,
			context,
			abortController,
			baselineSuggestionIds,
			operation: requestedOperation,
		});
	}
	const requestedContentFormat =
		(target.type === "selection"
			? resolveScopedSelectionRewriteContentFormat(requestedOperation)
			: null) ??
		controller._resolveContentFormat(target.type, context?.surface);
	let route = routeAIRequest({
		prompt,
		selection: controller._editor.selection,
		blockType: controller._editor.getBlock(blockId)?.type ?? null,
		blockCount: controller._editor.blockCount(),
		suggestMode: controller._state.suggestMode,
		target: target.type,
		contentFormat: requestedContentFormat,
		surface: context?.surface,
		mutationPreference: controller._mutationPreference,
	});
	let workingSet = await controller._buildWorkingSet(
		toolRuntime,
		route,
		target,
		blockId,
		prompt,
		context?.scope,
	);
	const refinedRoute = controller._refineRouteWithWorkingSet(
		route,
		workingSet,
	);
	if (refinedRoute.lane !== route.lane) {
		route = refinedRoute;
		workingSet = await controller._buildWorkingSet(
			toolRuntime,
			route,
			target,
			blockId,
			prompt,
			context?.scope,
		);
	} else {
		route = refinedRoute;
	}
	const contentFormat = route.contentFormat;
	const streamingTarget =
		(controller._editor.facet(
			streamingTargetFacet,
		) as StreamingTarget | null) ?? null;
	const shouldStreamDirectly = route.shouldStreamDirectly;
	const selectionRange =
		target.type === "selection"
			? selectionToRange(
					controller._editor.internals.doc,
					target.selection,
				)
			: null;
	const selectionSourceText =
		target.type === "selection"
			? resolveSelectionText(controller._editor, target.selection)
			: "";
	const shouldReplaceMarkdownTarget =
		context?.replaceTargetBlock === true ||
		(contentFormat === "markdown" &&
			target.type === "block" &&
			(route.targetKind === "table" ||
				(context?.surface === "bottom-chat" &&
					shouldReplaceEmptyMarkdownTarget(
						controller._editor.getBlock(blockId),
					))));
	const streamingSink = resolveGenerationStreamingSink({
		target,
		shouldStreamDirectly,
		contentFormat,
		mutationMode: route.mutationMode,
		editsArriveAsToolCalls: route.editsArriveAsToolCalls,
		surface: context?.surface,
		selectionRange,
		replaceTargetBlock: shouldReplaceMarkdownTarget,
		replaceBlockIds: context?.replaceBlockIds,
	});
	const sessionTurnId = context?.sessionId ? generateId() : undefined;
	const existingSession =
		context?.sessionId != null
			? (controller._state.sessions.find(
					(session) => session.id === context.sessionId,
				) ?? null)
			: null;
	const executionPrompt = buildSessionExecutionPrompt(
		existingSession,
		prompt,
	);
	const generationPrompt =
		contentFormat === "markdown"
			? buildFlowMarkdownRequestPrompt({
					prompt: executionPrompt,
					workingSet,
					editsArriveAsToolCalls: route.editsArriveAsToolCalls,
				})
			: executionPrompt;

	const seedGeneration: GenerationState = {
		id: generateId(),
		zoneId: generateId(),
		blockId,
		target: target.type,
		sessionId: context?.sessionId,
		turnId: sessionTurnId,
		surface: context?.surface,
		prompt,
		operation: requestedOperation,
		status: "streaming",
		tokenCount: 0,
		steps: [],
		undoGroupId: generateId(),
		text: "",
		commandId,
		suggestionIds: [],
		route: route.lane,
		mutationMode: route.mutationMode,
		contentFormat,
		editsArriveAsToolCalls: route.editsArriveAsToolCalls,
		targetKind: route.targetKind,
		mutationReceipt: null,
		debug: {
			messageAssemblyLatencyMs: 0,
			firstToolStartMs: null,
			firstToolResultMs: null,
			firstVisibleTextMs: null,
			toolExecutionMs: 0,
			qualitySignals: {},
			routeConfidence: workingSet?.routeConfidence,
			structured: {
				targetKind: route.targetKind,
				validationIssueCount: 0,
			},
			commit: {
				attempted: false,
				succeeded: false,
			},
		},
	};
	if (context?.sessionId) {
		beginGenerationSession(controller, {
			sessionId: context.sessionId,
			seedGeneration,
			prompt,
			target,
			operation: requestedOperation,
			sessionTurnId,
			existingSession,
		});
	}
	controller._setState({
		status: "thinking",
		activeGeneration: seedGeneration,
		commandMenuOpen: false,
		lastRoute: route.lane,
		activeSessionId:
			context?.sessionId ?? controller._state.activeSessionId,
	});
	controller._setStreamEvents([
		createAIStreamEvent(seedGeneration, {
			type: "generation-start",
			prompt,
			target: target.type,
		}),
		createAIStreamEvent(seedGeneration, {
			type: "status",
			status: "thinking",
		}),
	]);
	const state: GenerationExecutionState = {
		prompt,
		target,
		commandId,
		maxSteps,
		context,
		toolRuntime,
		abortController,
		baselineSuggestionIds,
		blockId,
		requestedOperation,
		route,
		workingSet,
		contentFormat,
		currentText: "",
		streamingTarget,
		blockStreamingStarted: false,
		selectionRange,
		selectionSourceText,
		shouldReplaceMarkdownTarget,
		streamingSink,
		suggestionSpliceHead: createSuggestionSpliceHead(
			controller._editor,
			streamingSink,
		),
		sessionTurnId,
		existingSession,
		executionPrompt,
		shouldTrimLeadingBlankBlockText:
			target.type === "block" &&
			shouldTrimLeadingBlankBlockGenerationText(
				controller._editor.getBlock(blockId),
			),
		generationPrompt,
		seedGeneration,
		currentMutationReceipt: null,
	};
	try {
		const result = await runGenerationLoop(controller, state);
		return finalizeGenerationExecution(controller, state, result);
	} catch (error) {
		return handleGenerationExecutionError(controller, state, error);
	} finally {
		state.suggestionSpliceHead?.release();
	}
}
