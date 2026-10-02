import { streamingTargetFacet } from "@input/pen-core";
import type {
	ModelAdapter,
	ModelToolChoice,
	StreamingTarget,
} from "@input/pen-types";
import { generateId } from "@input/pen-types";
import {
	AI_AGENTIC_MAX_STEPS_DEFAULT,
	createAIToolTurn,
	executeAITool,
	isAIToolCallDenied,
	isMutatingAITool,
	listAITools,
} from "../tools";
// Not from `../tools`: that barrel is the published `@input/pen-ai/tools`
// surface, and these stay in-package.
import {
	AI_EDIT_DOCUMENT_TOOL_NAME,
	AI_TOOL_FAILED_CODE,
} from "../tools/constants";
import { type AIToolTurn, isAIToolResultAskingRetry } from "../tools/authority";
import { advertiseAIToolsForRoute } from "../tools/descriptors";
import {
	excerptsFromAgenticStep,
	requestFeatureForAgenticStep,
	streamThroughEgress,
} from "../egress";
import {
	buildAgentMessages,
	buildAssistantToolCallParts,
	type ToolJournalEntry,
} from "../runtime/stepJournal";
import {
	createEditDocumentPreview,
	isTruncatedEditDocumentInput,
	truncatedEditDocumentRefusal,
} from "../runtime/editDocumentPreview";
import {
	createStreamingBlockCommitter,
	type StreamingBlockCommitter,
} from "../runtime/streamingBlockCommit";
import { rejectSuggestionsForBlocks } from "../suggestions/rejectByBlock";
import { refuseStaleEditDocumentCall } from "../runtime/viewHashes";
import type {
	AgenticLoopOptions,
	AgenticStep,
	GenerationState,
} from "../types";
import { publishAwareness } from "./awareness";
import { buildToolContext } from "./contextBuilder";

export async function runAgenticLoop(
	options: AgenticLoopOptions,
): Promise<GenerationState> {
	const {
		model,
		editor,
		toolRuntime,
		prompt,
		blockId,
		generationId = generateId(),
		zoneId = generateId(),
		maxSteps = AI_AGENTIC_MAX_STEPS_DEFAULT,
		signal,
		workingSet,
		validateWorkingSet,
		refreshWorkingSet,
		onStatusChange,
		onStep,
		onTextDelta,
		onCompleteText,
		onToolCall,
		onToolOutput,
		onToolResult,
		onStructuredData,
		onMessagesChange,
		onStreamingStart,
		onStreamingEnd,
		onDebug,
		onEditPreview,
		editsArriveAsToolCalls: isEditChannel = false,
		editIntent = true,
		editStreaming,
	} = options;
	// One fact, two consequences: EC14's turn exit and EC9's stale policy are
	// both properties of the edit channel, not two independent switches.
	const streamingMode = resolveEditStreaming(editStreaming, model);
	const previewEnabled = isEditChannel && streamingMode !== "atomic";
	const commitEnabled = isEditChannel && streamingMode === "commit";
	// Assigned once the turn exists, because whether anything may be written
	// before the call closes is a property of the turn's grant (EC20).
	let blockCommitter: StreamingBlockCommitter | null = null;
	const editPreview = createEditDocumentPreview((update) => {
		onEditPreview?.(
			blockCommitter ? blockCommitter.absorb(update) : update,
		);
	});

	const steps: AgenticStep[] = [];
	const consecutiveErrors = new Map<string, number>();
	const toolJournal: ToolJournalEntry[] = [];
	let textBuffer = "";
	// maxSteps bounds model passes (round trips); stepIndex only numbers the
	// emitted step entries, which grow twice per tool call (call + result).
	let passIndex = 0;
	let stepIndex = 0;
	let streamingStarted = false;
	let messageAssemblyLatencyMs = 0;
	let firstToolStartMs: number | null = null;
	let firstToolResultMs: number | null = null;
	let firstVisibleTextMs: number | null = null;
	let toolExecutionMs = 0;
	const loopStartedAt = performance.now();
	let staleContextCount = 0;
	let workingSetRefreshCount = 0;
	let routeConfidence = workingSet?.routeConfidence;
	let currentWorkingSet = workingSet ?? null;
	// Locked on the first pass so tools→system→messages stays a stable
	// Anthropic cache prefix across retries of the same turn (EC16).
	let advertisedToolNames: ReadonlySet<string> | null = null;

	const turn =
		options.toolTurn ??
		createAIToolTurn({
			allowedMutatingTools: options.allowedMutatingTools,
			confirm: options.confirm,
			budget: options.toolBudget,
			groupId: generationId,
		});
	// A confirmation resolver decides whether the edit happens at all, so a
	// turn that has one gets the decoration-only preview: writing blocks while
	// the call is still open would put content in the document ahead of the
	// answer that governs it (EC20).
	if (commitEnabled && turn.grant.confirm == null) {
		blockCommitter = createStreamingBlockCommitter({
			editor,
			origin: "ai",
			undoGroupId: turn.groupId,
			chargeOps: (count) => chargeStreamedOps(turn, count),
			rejectBlocks: (blockIds) => {
				rejectSuggestionsForBlocks(editor, blockIds, turn.groupId);
			},
		});
	}
	const streamingTarget =
		(editor.facet(streamingTargetFacet) as StreamingTarget | null) ?? null;
	const toolContext = buildToolContext(
		editor,
		zoneId,
		blockId,
		streamingTarget,
	);

	onStatusChange?.("thinking");
	publishAwareness(editor, {
		status: "thinking",
		activeBlockId: blockId,
		model: getModelName(model),
		generationZoneId: zoneId,
	});

	while (passIndex < maxSteps) {
		passIndex += 1;
		if (signal?.aborted || turn.ended) break;

		const validation = validateWorkingSet?.(currentWorkingSet) ?? {
			valid: true,
			canRefresh: false,
		};
		if (!validation.valid) {
			staleContextCount += 1;
			if (refreshWorkingSet && (validation.canRefresh || isEditChannel)) {
				currentWorkingSet = await refreshWorkingSet();
				workingSetRefreshCount += 1;
				routeConfidence =
					currentWorkingSet?.routeConfidence ?? routeConfidence;
			} else if (!isEditChannel) {
				throw new StaleWorkingSetError(
					validation.reason ?? "working-set-invalid",
				);
			}
		}

		const assemblyStart = performance.now();
		const messages = buildAgentMessages({
			prompt,
			workingSet: currentWorkingSet
				? buildWorkingSetPrompt(currentWorkingSet)
				: null,
			toolResults: toolJournal,
		});
		messageAssemblyLatencyMs += performance.now() - assemblyStart;

		const grantedTools = listAITools(toolRuntime, turn.grant);
		if (advertisedToolNames == null) {
			advertisedToolNames = new Set(
				advertiseAIToolsForRoute(grantedTools, {
					editChannel: isEditChannel,
					hasBlockAnnotations:
						workingSetHasBlockAnnotations(currentWorkingSet),
				}).map((tool) => tool.name),
			);
		}
		const advertised = advertisedToolNames;
		const availableTools = grantedTools
			.filter((tool) => advertised.has(tool.name))
			.filter((tool) => (consecutiveErrors.get(tool.name) ?? 0) < 3)
			.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			}));
		const feature = requestFeatureForAgenticStep(
			toolJournal.length,
			options.feature ?? "generation",
		);
		const toolChoice = resolveEditChannelToolChoice(
			model,
			isEditChannel && editIntent,
			currentWorkingSet,
		);
		const stream = streamThroughEgress(
			editor,
			model,
			{
				feature,
				messages,
				documentExcerpts: excerptsFromAgenticStep({
					editor,
					blockId,
					workingSet: currentWorkingSet,
					toolJournal,
				}),
				tools: availableTools,
			},
			{
				signal,
				requestMode: options.requestMode,
				operation: options.operation ?? undefined,
				sessionId: options.sessionId,
				turnId: options.turnId,
				generationId,
				toolChoice,
			},
		);
		const pendingToolCalls: Array<{
			toolCallId: string;
			toolName: string;
			input: unknown;
		}> = [];
		let emittedTextInPass = false;
		let passTextBuffer = "";

		for await (const event of stream) {
			if (signal?.aborted) {
				editPreview.withdraw();
				blockCommitter?.rollback();
				break;
			}

			if (event.type === "tool-input-start") {
				if (
					previewEnabled &&
					event.toolName === AI_EDIT_DOCUMENT_TOOL_NAME
				) {
					editPreview.start(event.toolCallId);
				}
				continue;
			}

			if (event.type === "tool-input-delta") {
				if (previewEnabled) {
					if (firstVisibleTextMs == null) {
						firstVisibleTextMs = performance.now() - loopStartedAt;
					}
					editPreview.append(event.inputTextDelta);
				}
				continue;
			}

			if (event.type === "text-delta") {
				if (!emittedTextInPass && pendingToolCalls.length === 0) {
					onStatusChange?.("writing");
					publishAwareness(editor, {
						status: "writing",
						activeBlockId: blockId,
						model: getModelName(model),
						generationZoneId: zoneId,
					});
					if (!streamingStarted) {
						onStreamingStart?.(zoneId, blockId);
						streamingStarted = true;
					}
				}
				if (firstVisibleTextMs == null) {
					firstVisibleTextMs = performance.now() - loopStartedAt;
				}
				emittedTextInPass = true;
				textBuffer += event.delta;
				passTextBuffer += event.delta;
				onTextDelta?.(event.delta);
				continue;
			}

			if (event.type === "structured-data") {
				if (firstVisibleTextMs == null) {
					firstVisibleTextMs = performance.now() - loopStartedAt;
				}
				onStructuredData?.({
					data: event.data,
					final: event.final === true,
				});
				continue;
			}

			if (event.type === "tool-call") {
				pendingToolCalls.push({
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					input: event.input,
				});
				onToolCall?.({
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					input: event.input,
				});
				continue;
			}

			if (event.type === "error") {
				editPreview.withdraw();
				blockCommitter?.rollback();
				if (streamingStarted) {
					onStreamingEnd?.("error");
				}
				publishAwareness(editor, null);
				throw event.error;
			}

			if (event.type === "done") {
				break;
			}
		}

		if (pendingToolCalls.length === 0) {
			// Fragments arrived but the call never closed. Whatever was written
			// on the strength of it has nothing to finish it (EC20).
			blockCommitter?.rollback();
			if (passTextBuffer.length > 0) {
				onMessagesChange?.([
					...messages,
					{
						role: "assistant",
						content: passTextBuffer,
					},
				]);
			}
			break;
		}

		onMessagesChange?.([
			...messages,
			{
				role: "assistant",
				content: buildAssistantToolCallParts(
					pendingToolCalls.map((toolCall) => ({
						toolCallId: toolCall.toolCallId,
						toolName: toolCall.toolName,
						input: toolCall.input,
						output: null,
					})),
					passTextBuffer,
				),
			},
		]);

		let passHasMutatingCall = false;
		let passCompletedCleanly = true;

		for (const toolCall of pendingToolCalls) {
			if (turn.ended) {
				// The call that would have finished the streamed write will not
				// run, so the prefix it wrote has nothing to complete it.
				blockCommitter?.rollback();
				passCompletedCleanly = false;
				break;
			}
			if (
				isMutatingAITool(
					toolCall.toolName,
					toolRuntime.getTool(toolCall.toolName),
				)
			) {
				passHasMutatingCall = true;
			}
			const step: AgenticStep = {
				index: stepIndex++,
				type: "tool-call",
				toolName: toolCall.toolName,
				toolCallId: toolCall.toolCallId,
				input: toolCall.input,
				status: "running",
			};
			steps.push(step);
			onStep?.(step);

			onStatusChange?.("tool-calling");
			publishAwareness(editor, {
				status: "tool-calling",
				activeBlockId: blockId,
				model: getModelName(model),
				activeTool: {
					name: toolCall.toolName,
					toolCallId: toolCall.toolCallId,
				},
				generationZoneId: zoneId,
			});

			try {
				editPreview.withdraw();
				if (firstToolStartMs == null) {
					firstToolStartMs = performance.now() - loopStartedAt;
				}
				const toolStartedAt = performance.now();
				const truncatedRefusal =
					toolCall.toolName === AI_EDIT_DOCUMENT_TOOL_NAME &&
					isTruncatedEditDocumentInput(toolCall.input)
						? truncatedEditDocumentRefusal()
						: null;
				// What runs is the call minus the part already written while it
				// streamed; what the model is told it called stays whole, so
				// its next pass reasons about the edit it asked for (EC20).
				const executedInput =
					truncatedRefusal == null &&
					toolCall.toolName === AI_EDIT_DOCUMENT_TOOL_NAME &&
					blockCommitter
						? blockCommitter.reconcile(toolCall.input)
						: toolCall.input;
				const staleRefusal =
					truncatedRefusal == null &&
					toolCall.toolName === AI_EDIT_DOCUMENT_TOOL_NAME
						? refuseStaleEditDocumentCall(
								editor,
								executedInput,
								currentWorkingSet?.viewHashes,
								currentWorkingSet?.viewMode ?? "resolved",
							)
						: null;
				if (truncatedRefusal ?? staleRefusal) {
					blockCommitter?.rollback();
				}
				const output =
					truncatedRefusal ??
					staleRefusal ??
					(await executeAITool(
						toolRuntime,
						toolCall.toolName,
						executedInput,
						toolContext,
						turn,
						(part, progressiveOutput) => {
							step.output = progressiveOutput;
							onStep?.({ ...step });
							onToolOutput?.({
								toolCallId: toolCall.toolCallId,
								toolName: toolCall.toolName,
								part,
								output: progressiveOutput,
							});
						},
					));
				toolExecutionMs += performance.now() - toolStartedAt;
				if (
					isAIToolCallDenied(output) ||
					isAIToolResultAskingRetry(output)
				) {
					// A refused call applied nothing, so the prefix written
					// while it streamed is now content nobody asked for.
					blockCommitter?.rollback();
					passCompletedCleanly = false;
					step.output = output;
					step.status = "complete";
					onToolResult?.({
						toolCallId: toolCall.toolCallId,
						toolName: toolCall.toolName,
						output,
						state: "complete",
					});
					toolJournal.push({
						toolCallId: toolCall.toolCallId,
						toolName: toolCall.toolName,
						input: toolCall.input,
						output,
					});
					if (turn.ended) {
						break;
					}
					continue;
				}
				step.output = output;
				step.status = "complete";
				blockCommitter?.settle();
				consecutiveErrors.set(toolCall.toolName, 0);
				if (firstToolResultMs == null) {
					firstToolResultMs = performance.now() - loopStartedAt;
				}

				const resultStep: AgenticStep = {
					index: stepIndex++,
					type: "tool-result",
					toolName: toolCall.toolName,
					toolCallId: toolCall.toolCallId,
					output,
					status: "complete",
				};
				steps.push(resultStep);
				onStep?.(resultStep);
				onToolResult?.({
					toolCallId: toolCall.toolCallId,
					toolName: toolCall.toolName,
					output,
					state: "complete",
				});

				toolJournal.push({
					toolCallId: toolCall.toolCallId,
					toolName: toolCall.toolName,
					input: toolCall.input,
					output,
				});
				onMessagesChange?.(
					buildAgentMessages({
						prompt,
						workingSet: currentWorkingSet
							? buildWorkingSetPrompt(currentWorkingSet)
							: null,
						toolResults: toolJournal,
					}),
				);
			} catch (error) {
				blockCommitter?.rollback();
				passCompletedCleanly = false;
				toolExecutionMs += 0;
				const failures =
					(consecutiveErrors.get(toolCall.toolName) ?? 0) + 1;
				consecutiveErrors.set(toolCall.toolName, failures);
				step.status = "error";
				step.output =
					error instanceof Error ? error.message : String(error);
				editor.internals?.emit?.("diagnostic", {
					code: AI_TOOL_FAILED_CODE,
					level: "error",
					source: "ai-tools",
					message: `Tool "${toolCall.toolName}" failed: ${step.output}`,
					extension: "ai-tools",
				});
				onToolResult?.({
					toolCallId: toolCall.toolCallId,
					toolName: toolCall.toolName,
					output: step.output,
					state: "error",
				});
				toolJournal.push({
					toolCallId: toolCall.toolCallId,
					toolName: toolCall.toolName,
					input: toolCall.input,
					output: step.output,
					isError: true,
				});
				onMessagesChange?.(
					buildAgentMessages({
						prompt,
						workingSet: currentWorkingSet
							? buildWorkingSetPrompt(currentWorkingSet)
							: null,
						toolResults: toolJournal,
					}),
				);
			}
		}

		// A clean mutating pass is the document outcome (EC14). Read-only
		// calls and any refusal still loop so a correction can happen in-turn
		// (EC10). Off by default: the legacy multi-tool channel spreads edits
		// across passes.
		if (isEditChannel && passHasMutatingCall && passCompletedCleanly) {
			break;
		}
	}

	editPreview.withdraw();
	onCompleteText?.(textBuffer);
	onStatusChange?.("idle");
	publishAwareness(editor, null);
	if (streamingStarted) {
		onStreamingEnd?.(signal?.aborted ? "cancelled" : "complete");
	}

	onDebug?.({
		messageAssemblyLatencyMs,
		firstToolStartMs,
		firstToolResultMs,
		firstVisibleTextMs,
		toolExecutionMs,
		qualitySignals: {
			staleContextRate: staleContextCount,
			requestRestartRateUnderChurn: workingSetRefreshCount,
		},
		routeConfidence,
	});

	return {
		id: generationId,
		zoneId,
		blockId,
		target: "block",
		prompt,
		status: signal?.aborted ? "cancelled" : "complete",
		tokenCount: 0,
		steps,
		undoGroupId: generationId,
		turnReason: turn.reason,
		text: textBuffer,
		editsArriveAsToolCalls: isEditChannel,
		debug: {
			messageAssemblyLatencyMs,
			firstToolStartMs,
			firstToolResultMs,
			firstVisibleTextMs,
			toolExecutionMs,
			qualitySignals: {
				staleContextRate: staleContextCount,
				requestRestartRateUnderChurn: workingSetRefreshCount,
			},
			routeConfidence,
		},
	};
}

function buildWorkingSetPrompt(
	workingSet: NonNullable<AgenticLoopOptions["workingSet"]>,
): string {
	return [
		`Working set source: ${workingSet.source}`,
		`Document version: ${workingSet.documentVersion}`,
		`View mode: ${workingSet.viewMode}`,
		"Document context:",
		typeof workingSet.context === "string"
			? workingSet.context
			: JSON.stringify(workingSet.context),
	].join("\n");
}

class StaleWorkingSetError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "StaleWorkingSetError";
	}
}

function getModelName(
	model: ModelAdapter & { name?: string; modelId?: string },
): string {
	return model.name ?? model.modelId ?? "unknown";
}

function resolveEditStreaming(
	configured: AgenticLoopOptions["editStreaming"],
	model: ModelAdapter,
): "atomic" | "preview" | "commit" {
	if (configured === "atomic") {
		return "atomic";
	}
	// An adapter that cannot report partial input has nothing to stream from,
	// so both visible modes collapse to waiting for the call.
	if (model.capabilities?.partialToolInput !== true) {
		return "atomic";
	}
	return configured ?? "commit";
}

/**
 * Charges a streamed write against the turn's op budget, keeping headroom.
 *
 * The budget exists to bound one turn's writes, and a streamed write is a write
 * — but it must not be the thing that exhausts the turn. An exhausted budget
 * ends the turn silently, whereas the same overrun reached through the closing
 * call returns a refusal the model can read and split (`AIToolBudgetError`).
 * So streaming stops one op short and lets the call be the one to complain.
 */
function chargeStreamedOps(turn: AIToolTurn, count: number): boolean {
	if (
		count >= turn.limits.maxOpsPerCall ||
		turn.ops + count >= turn.limits.maxTotalOpsPerTurn
	) {
		return false;
	}
	return turn.tryRecordOps(count) == null;
}

const BLOCK_ANNOTATION_PATTERN = /<!-- block:\S+ \S+ -->/;

function workingSetHasBlockAnnotations(
	workingSet: AgenticLoopOptions["workingSet"],
): boolean {
	if (!workingSet) {
		return false;
	}
	const serialized =
		typeof workingSet.context === "string"
			? workingSet.context
			: JSON.stringify(workingSet.context ?? "");
	return BLOCK_ANNOTATION_PATTERN.test(serialized);
}

/**
 * EC17, and note the first argument is edit *intent* on the edit channel, not
 * the channel alone: forcing a tool on a pass that asked a question leaves the
 * model no way to answer except by editing the document.
 */
function resolveEditChannelToolChoice(
	model: ModelAdapter,
	forceEditTool: boolean,
	workingSet: AgenticLoopOptions["workingSet"],
): ModelToolChoice | undefined {
	if (!forceEditTool || model.capabilities?.forcedToolChoice !== true) {
		return undefined;
	}
	if (workingSetHasBlockAnnotations(workingSet)) {
		return { type: "tool", name: AI_EDIT_DOCUMENT_TOOL_NAME };
	}
	return { type: "any" };
}
