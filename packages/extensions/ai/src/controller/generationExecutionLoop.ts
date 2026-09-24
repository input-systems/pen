import { runAgenticLoop } from "../agentic/loop";
import type { GenerationState } from "../types";
import type { AIControllerImpl } from "./aiController";
import {
	applyEditDocumentPreview,
	applyGenerationStreamingDelta,
} from "./streamingSink";
import {
	createAIStreamEvent,
	EMPTY_TOOL_RUNTIME,
	resolveGenerationRequestMode,
	trimLeadingBlankBlockGenerationText,
} from "../helpers";
import { bindAIToolMutationMode } from "../tools/execution";
import type { GenerationExecutionState } from "./generationExecutionState";

export async function runGenerationLoop(
	controller: AIControllerImpl,
	state: GenerationExecutionState,
): Promise<GenerationState> {
	const {
		route,
		toolRuntime,
		generationPrompt,
		blockId,
		seedGeneration,
		maxSteps,
		target,
		streamingTarget,
		context,
		abortController,
		workingSet,
		selectionScope,
		sessionTurnId,
	} = state;
	if (!controller._model) {
		throw new Error("No AI model configured");
	}
	const restoreToolMutationMode = bindAIToolMutationMode(
		controller._editor,
		route.mutationMode,
	);
	try {
		return await runAgenticLoop({
			model: controller._model,
			editor: controller._editor,
			feature: "generation",
			toolRuntime: route.allowToolUse ? toolRuntime : EMPTY_TOOL_RUNTIME,
			prompt: generationPrompt,
			blockId,
			generationId: seedGeneration.id,
			zoneId: seedGeneration.zoneId,
			maxSteps: route.allowToolUse
				? (maxSteps ?? controller._maxAgenticSteps)
				: 1,
			allowedMutatingTools: controller._allowedMutatingTools,
			confirm: controller._confirmAITool,
			signal: abortController.signal,
			requestMode: resolveGenerationRequestMode({
				...context,
				targetType: target.type,
			}),
			operation: context?.operation,
			sessionId: context?.sessionId,
			turnId: sessionTurnId,
			workingSet,
			validateWorkingSet: (activeWorkingSet) =>
				controller._validateWorkingSet(route, target, activeWorkingSet),
			refreshWorkingSet: async () =>
				controller._buildWorkingSet(
					toolRuntime,
					route,
					target,
					blockId,
					state.prompt,
					context?.scope,
					selectionScope,
				),
			onStatusChange: (status) => {
				controller._setState({ status });
				controller._appendStreamEvent(
					createAIStreamEvent(seedGeneration, {
						type: "status",
						status,
					}),
				);
			},
			onStep: (step) => {
				const active = controller._state.activeGeneration;
				if (!active) return;
				controller._setState({
					activeGeneration: {
						...active,
						steps: [...active.steps, step],
					},
				});
			},
			onTextDelta: (delta) => {
				const nextDelta =
					target.type === "block" &&
					state.shouldTrimLeadingBlankBlockText
						? trimLeadingBlankBlockGenerationText(delta)
						: delta;
				if (
					state.shouldTrimLeadingBlankBlockText &&
					nextDelta.length > 0
				) {
					state.shouldTrimLeadingBlankBlockText = false;
				}
				if (nextDelta.length === 0) {
					return;
				}
				state.currentText += nextDelta;
				applyGenerationStreamingDelta(controller, state, nextDelta);
				const active = controller._state.activeGeneration;
				if (!active) return;
				controller._setState({
					activeGeneration: {
						...active,
						text: state.currentText,
						status: "streaming",
					},
				});
				controller._appendStreamEvent(
					createAIStreamEvent(seedGeneration, {
						type: "text-delta",
						delta: nextDelta,
						text: state.currentText,
					}),
				);
			},
			onToolCall: (event) => {
				controller._appendStreamEvent(
					createAIStreamEvent(seedGeneration, {
						type: "tool-call",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						input: event.input,
					}),
				);
			},
			onToolOutput: (event) => {
				controller._appendStreamEvent(
					createAIStreamEvent(seedGeneration, {
						type: "tool-output",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						part: event.part,
						output: event.output,
					}),
				);
			},
			onToolResult: (event) => {
				controller._appendStreamEvent(
					createAIStreamEvent(seedGeneration, {
						type: "tool-result",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						output: event.output,
						state: event.state,
					}),
				);
			},
			editsArriveAsToolCalls: route.editsArriveAsToolCalls,
			editIntent: route.intent !== "question",
			editStreaming: controller._editStreaming,
			mutationPreference: controller._mutationPreference,
			onEditPreview: (preview) => {
				const active = controller._state.activeGeneration;
				if (!active) {
					return;
				}
				const nextGeneration = {
					...active,
					editPreview: preview,
					text: preview?.text ?? active.text,
				};
				if (preview == null) {
					controller.clearStreamingReviewPreview(undefined, {
						activeGeneration: nextGeneration,
					});
					controller.dismissEphemeralSuggestion();
					return;
				}
				const previewBlockId = preview.blockId;
				if (previewBlockId == null) {
					controller._setState({
						activeGeneration: nextGeneration,
					});
					return;
				}
				applyEditDocumentPreview(
					controller,
					{
						operationIndex: preview.operationIndex,
						blockId: previewBlockId,
						operation: preview.operation,
						text: preview.text,
					},
					nextGeneration,
				);
			},
			onDebug: (debug) => {
				const active = controller._state.activeGeneration;
				if (!active) return;
				controller._setState({
					activeGeneration: {
						...active,
						debug,
					},
				});
			},
			onStreamingStart: (zoneId, targetBlockId) => {
				if (
					state.streamingSink.kind !== "direct-write" ||
					state.blockStreamingStarted
				)
					return;
				streamingTarget?.beginStreaming(zoneId, targetBlockId, {
					type: "ai",
					groupId: seedGeneration.undoGroupId,
				});
				state.blockStreamingStarted = true;
			},
			onStreamingEnd: (status) => {
				if (
					state.streamingSink.kind !== "direct-write" ||
					!state.blockStreamingStarted
				)
					return;
				streamingTarget?.endStreaming(status);
				state.blockStreamingStarted = false;
			},
		});
	} finally {
		restoreToolMutationMode();
	}
}
