import { generateId } from "@input/pen-types";
import type { AIMutationReceipt, GenerationState } from "../types";
import type { AIControllerImpl } from "./aiController";
import { findRequestSession, startSeededGeneration } from "./generationStart";
import {
	buildSessionExecutionPrompt,
	createAIStreamEvent,
	resolveGenerationRequestMode,
	resolveLocalOperationContentFormat,
} from "../helpers";
import { excerptsFromOperation, streamThroughEgress } from "../egress";
import { finalizeLocalOperationExecution } from "./localOperationExecutionFinalize";
import type { ExecuteLocalOperationInput } from "./generationExecutionState";
import type { GenerationStreamingSink } from "./streamingSink";
import { markdownReviewPreviewInput } from "./streamingPreviewInput";

export async function executeLocalOperation(
	controller: AIControllerImpl,
	input: ExecuteLocalOperationInput,
): Promise<GenerationState> {
	const {
		prompt,
		target,
		blockId,
		commandId,
		context,
		abortController,
		baselineSuggestionIds,
		operation,
	} = input;
	const sessionTurnId = context?.sessionId ? generateId() : undefined;
	const mutationMode: NonNullable<GenerationState["mutationMode"]> =
		"persistent-suggestions";
	const contentFormat = resolveLocalOperationContentFormat(
		controller._editor,
		operation,
		controller._resolveContentFormat("block", context?.surface),
	);
	const streamingSink: GenerationStreamingSink =
		operation.kind === "rewrite-selection" &&
		operation.target.kind === "scoped-range" &&
		contentFormat === "markdown" &&
		operation.target.blockIds.length > 0
			? {
					kind: "review-preview",
					format: "markdown",
					source: "markdown-block",
					blockId:
						operation.target.blockIds[0] ??
						operation.target.anchor.blockId,
					offset: 0,
					replaceTargetBlock: true,
					replaceBlockIds: operation.target.blockIds,
				}
			: { kind: "none" };
	const seedGeneration: GenerationState = {
		id: generateId(),
		zoneId: generateId(),
		blockId,
		target: target.type,
		sessionId: context?.sessionId,
		turnId: sessionTurnId,
		surface: context?.surface,
		prompt,
		operation,
		status: "streaming",
		tokenCount: 0,
		steps: [],
		undoGroupId: generateId(),
		text: "",
		commandId,
		suggestionIds: [],
		route:
			operation.kind === "rewrite-selection"
				? "selection-rewrite"
				: operation.kind === "continue-block"
					? "cursor-context"
					: "tool-loop",
		mutationMode,
		contentFormat,
		// No tool runs on the requested-operation path; text is the edit.
		editsArriveAsToolCalls: false,
		targetKind: undefined,
		mutationReceipt: null,
		debug: {
			messageAssemblyLatencyMs: 0,
			firstToolStartMs: null,
			firstToolResultMs: null,
			firstVisibleTextMs: null,
			toolExecutionMs: 0,
			qualitySignals: {},
		},
	};
	const existingSession = findRequestSession(controller, context?.sessionId);
	const executionPrompt = buildSessionExecutionPrompt(
		existingSession,
		prompt,
	);

	startSeededGeneration(controller, {
		seedGeneration,
		sessionId: context?.sessionId,
		prompt,
		target,
		operation,
		sessionTurnId,
		existingSession,
	});

	let currentText = "";
	let currentMutationReceipt: AIMutationReceipt | null = null;
	let sawStructuredFinalFrame = false;
	const previewSessionId = context?.sessionId ?? seedGeneration.id;
	const showScopedMarkdownPreview = (text: string) => {
		if (streamingSink.kind !== "review-preview") {
			return;
		}
		if (streamingSink.source !== "markdown-block") {
			return;
		}
		controller.setStreamingReviewPreview(
			markdownReviewPreviewInput(controller._editor, {
				sessionId: previewSessionId,
				turnId: sessionTurnId,
				blockId: streamingSink.blockId,
				offset: streamingSink.offset,
				replaceTargetBlock: streamingSink.replaceTargetBlock,
				replaceBlockIds: streamingSink.replaceBlockIds,
				text,
			}),
		);
	};
	const clearScopedMarkdownPreview = () => {
		controller.clearStreamingReviewPreview(previewSessionId);
	};
	const updatePreview = (text: string, phase: "preview" | "final") => {
		currentText = text;
		if (phase === "preview" && text.length > 0) {
			controller._setState({ status: "writing" });
			controller._appendStreamEvent(
				createAIStreamEvent(seedGeneration, {
					type: "status",
					status: "writing",
				}),
			);
		}
		controller._resolveActiveGeneration({
			text,
			status: "streaming",
			operation,
		});
		controller._appendStreamEvent(
			createAIStreamEvent(seedGeneration, {
				type: "operation",
				operation,
				phase,
				text,
			}),
		);
	};

	try {
		const stream = streamThroughEgress(
			controller._editor,
			controller._model!,
			{
				feature: "generation",
				messages: [{ role: "user", content: executionPrompt }],
				documentExcerpts: excerptsFromOperation(operation, blockId),
				tools: [],
			},
			{
				signal: abortController.signal,
				requestMode: resolveGenerationRequestMode({
					...context,
					targetType: target.type,
					operation,
				}),
				operation,
				sessionId: context?.sessionId,
				turnId: sessionTurnId,
				generationId: seedGeneration.id,
			},
		);

		for await (const event of stream) {
			if (abortController.signal.aborted) {
				break;
			}

			if (event.type === "error") {
				throw event.error;
			}

			if (event.type === "conflict") {
				controller._appendStreamEvent(
					createAIStreamEvent(seedGeneration, {
						type: "operation",
						operation,
						phase: "conflict",
						reason: event.reason,
					}),
				);
				throw new Error(event.reason);
			}

			if (event.type === "text-delta") {
				if (
					operation.kind === "document-transform" ||
					streamingSink.kind === "review-preview"
				) {
					currentText += event.delta;
					if (streamingSink.kind === "review-preview") {
						updatePreview(currentText, "preview");
						showScopedMarkdownPreview(currentText);
					}
					continue;
				}
				throw new Error(
					"Local AI operations must stream typed operation payloads, not raw text deltas.",
				);
			}

			if (
				event.type === "replace-preview" ||
				event.type === "insert-preview"
			) {
				updatePreview(event.text, "preview");
				if (streamingSink.kind === "review-preview") {
					showScopedMarkdownPreview(event.text);
				}
				continue;
			}

			if (
				event.type === "replace-final" ||
				event.type === "insert-final"
			) {
				sawStructuredFinalFrame = true;
				updatePreview(event.text, "final");
				if (streamingSink.kind === "review-preview") {
					clearScopedMarkdownPreview();
				}
				currentMutationReceipt =
					controller._commitRequestedOperationResult(
						operation,
						event.text,
						context?.sessionId,
						{
							contentFormat,
						},
					);
				continue;
			}

			if (event.type === "done") {
				break;
			}
		}

		if (
			!sawStructuredFinalFrame &&
			currentText.length > 0 &&
			operation.kind !== "document-transform" &&
			streamingSink.kind !== "review-preview"
		) {
			throw new Error(
				"Local AI operations must return a validated final payload before they can be applied.",
			);
		}
		if (
			!sawStructuredFinalFrame &&
			currentText.length > 0 &&
			operation.kind === "document-transform"
		) {
			currentMutationReceipt = controller._commitRequestedOperationResult(
				operation,
				currentText,
				context?.sessionId,
				{
					contentFormat,
				},
			);
		} else if (
			!sawStructuredFinalFrame &&
			currentText.length > 0 &&
			streamingSink.kind === "review-preview"
		) {
			clearScopedMarkdownPreview();
			currentMutationReceipt = controller._commitRequestedOperationResult(
				operation,
				currentText,
				context?.sessionId,
				{
					contentFormat,
				},
			);
		}
		return finalizeLocalOperationExecution(controller, {
			context,
			sessionTurnId,
			operation,
			currentText,
			currentMutationReceipt,
			seedGeneration,
			abortController,
			baselineSuggestionIds,
		});
	} finally {
		if (controller._abortController === abortController) {
			controller._abortController = null;
		}
	}
}
