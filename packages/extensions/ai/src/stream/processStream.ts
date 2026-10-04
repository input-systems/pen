import {
	PEN_STREAM_PROTOCOL_VERSION,
	generateId,
	type AppPlacement,
	type ApplyOptions,
	type DataPart,
	type DiagnosticEvent,
	type DocumentOp,
	type Editor,
	type PenStreamPart,
	type Position,
} from "@input/pen-types";
import { streamingTargetFacet } from "@input/pen-core";
import type { StreamingTarget } from "./streamingTarget";
import {
	applyValidatedOps,
	assertToolCanMutateBlock,
	assertToolCanUseBlockType,
	getDocumentToolRuntime,
	ToolContextImpl,
} from "@input/pen-tools";
import type { ToolRuntimeImpl } from "@input/pen-tools";
import {
	createAIToolTurn,
	executeAITool,
	isAIToolCallDenied,
	resolveAIToolConfirmPolicy,
	type AIToolConfirmFn,
	type AIToolRuntime,
	type AIToolTurn,
	type AIUnconfirmedDestructivePolicy,
} from "../tools";

export interface ProcessStreamOptions {
	onPart?: (part: PenStreamPart) => void;
	signal?: AbortSignal;
	/** Handshake version from `PenStreamRequest.protocolVersion`. */
	protocolVersion?: number;
	/**
	 * Undo group for every apply in this stream. processStream does not mint
	 * one; AI write paths must pass the turn `groupId` (AIB4). If omitted,
	 * applies use `{ origin: "ai" }` only.
	 */
	groupId?: string;
	/**
	 * Mutating tools this stream may run or emulate via structural parts.
	 * Default deny. `gen-start` / `gen-delta` / `gen-end` do not consult this;
	 * they write through the host-opened streaming target.
	 */
	allowedMutatingTools?: readonly string[];
	/** Confirms destructive tool calls (AIB3). Defaults to `aiExtension({ confirm })`. */
	confirm?: AIToolConfirmFn;
	/**
	 * A destructive call with no `confirm` resolver (AIB3). Defaults to
	 * `aiExtension({ unconfirmedDestructive })`, then `"allow"`.
	 */
	unconfirmedDestructive?: AIUnconfirmedDestructivePolicy;
}

export async function processStream(
	stream: AsyncIterable<PenStreamPart>,
	editor: Editor,
	options?: ProcessStreamOptions,
): Promise<void> {
	if (!protocolVersionAccepted(editor, options?.protocolVersion)) {
		return;
	}

	const streaming =
		(editor.facet(streamingTargetFacet) as StreamingTarget | null) ?? null;
	if (!streaming) {
		emitStreamDiagnostic(editor, {
			code: "stream-target-missing",
			level: "error",
			source: "delta-stream",
			message:
				"No streaming target is registered; the stream was refused.",
			remediation:
				"Activate the delta-stream extension before calling processStream.",
		});
		return;
	}

	const toolRuntime = getDocumentToolRuntime(
		editor,
	) as ToolRuntimeImpl | null;
	const groupId = options?.groupId;
	const toolTurn = createAIToolTurn({
		allowedMutatingTools: options?.allowedMutatingTools ?? [],
		groupId: groupId ?? undefined,
		...resolveAIToolConfirmPolicy(editor, options),
	});
	const seenUnknownTypes = new Set<string>();
	let closed = false;
	let abortRequested = false;

	for await (const part of stream) {
		if (closed) {
			break;
		}
		if (options?.signal?.aborted) {
			abortRequested = true;
			break;
		}

		options?.onPart?.(part);

		if (!hasStringType(part)) {
			closeMalformed(
				editor,
				streaming,
				"stream part requires a string type",
				groupId,
			);
			closed = true;
			continue;
		}

		if (isDataPart(part)) {
			// Data parts are stored by consumers via onPart; they are not document ops.
			continue;
		}

		switch (part.type) {
			case "gen-start": {
				if (
					!isNonEmptyString(part.zoneId) ||
					!isNonEmptyString(part.blockId)
				) {
					closeMalformed(
						editor,
						streaming,
						"gen-start requires non-empty zoneId and blockId",
						groupId,
					);
					closed = true;
					break;
				}
				streaming.beginStreaming(
					part.zoneId,
					part.blockId,
					groupId === undefined
						? { type: "ai" }
						: { type: "ai", groupId },
				);
				break;
			}

			case "gen-delta": {
				if (
					!isNonEmptyString(part.zoneId) ||
					typeof part.delta !== "string"
				) {
					closeMalformed(
						editor,
						streaming,
						"gen-delta requires a zoneId and string delta",
						groupId,
					);
					closed = true;
					break;
				}
				if (!streaming.generationZone) {
					closeOutOfOrder(
						editor,
						streaming,
						"gen-delta arrived with no active generation",
						groupId,
					);
					closed = true;
					break;
				}
				streaming.appendDelta(part.delta);
				break;
			}

			case "gen-end": {
				if (
					part.status !== "complete" &&
					part.status !== "cancelled" &&
					part.status !== "error"
				) {
					closeMalformed(
						editor,
						streaming,
						"gen-end status must be complete, cancelled, or error",
						groupId,
					);
					closed = true;
					break;
				}
				if (!streaming.generationZone) {
					closeOutOfOrder(
						editor,
						streaming,
						"gen-end arrived with no active generation",
						groupId,
					);
					closed = true;
					break;
				}
				streaming.endStreaming(part.status);
				break;
			}

			case "block-insert": {
				if (
					!isNonEmptyString(part.blockType) ||
					!isPosition(part.position) ||
					(part.blockId !== undefined &&
						!isNonEmptyString(part.blockId)) ||
					(part.props !== undefined && !isRecord(part.props))
				) {
					closeMalformed(
						editor,
						streaming,
						"block-insert requires a blockType, position, and optional non-empty blockId",
						groupId,
					);
					closed = true;
					break;
				}
				const applied = applyGuarded(editor, groupId, toolTurn, () => {
					assertToolCanUseBlockType(editor, part.blockType);
					return [
						{
							type: "insert-block",
							blockId: part.blockId ?? generateId(),
							blockType: part.blockType,
							props: part.props ?? {},
							position: part.position,
						},
					];
				});
				if (!applied.ok) {
					closeApplyFailure(
						editor,
						streaming,
						applied.error,
						groupId,
					);
					closed = true;
				}
				break;
			}

			case "block-update": {
				if (!isNonEmptyString(part.blockId) || !isRecord(part.props)) {
					closeMalformed(
						editor,
						streaming,
						"block-update requires a non-empty blockId and props object",
						groupId,
					);
					closed = true;
					break;
				}
				const applied = applyGuarded(editor, groupId, toolTurn, () => {
					assertToolCanMutateBlock(editor, part.blockId);
					return [
						{
							type: "set-props",
							blockId: part.blockId,
							props: part.props,
						},
					];
				});
				if (!applied.ok) {
					closeApplyFailure(
						editor,
						streaming,
						applied.error,
						groupId,
					);
					closed = true;
				}
				break;
			}

			case "block-delete": {
				if (!isNonEmptyString(part.blockId)) {
					closeMalformed(
						editor,
						streaming,
						"block-delete requires a non-empty blockId",
						groupId,
					);
					closed = true;
					break;
				}
				const applied = applyGuarded(editor, groupId, toolTurn, () => {
					assertToolCanMutateBlock(editor, part.blockId);
					return [{ type: "delete-block", blockId: part.blockId }];
				});
				if (!applied.ok) {
					closeApplyFailure(
						editor,
						streaming,
						applied.error,
						groupId,
					);
					closed = true;
				}
				break;
			}

			case "block-move": {
				if (
					!isNonEmptyString(part.blockId) ||
					!isPosition(part.position)
				) {
					closeMalformed(
						editor,
						streaming,
						"block-move requires a non-empty blockId and position",
						groupId,
					);
					closed = true;
					break;
				}
				const applied = applyGuarded(editor, groupId, toolTurn, () => {
					assertToolCanMutateBlock(editor, part.blockId);
					return [
						{
							type: "move-block",
							blockId: part.blockId,
							position: part.position,
						},
					];
				});
				if (!applied.ok) {
					closeApplyFailure(
						editor,
						streaming,
						applied.error,
						groupId,
					);
					closed = true;
				}
				break;
			}

			case "layout-update": {
				if (!isNonEmptyString(part.blockId) || !isRecord(part.layout)) {
					closeMalformed(
						editor,
						streaming,
						"layout-update requires a non-empty blockId and layout object",
						groupId,
					);
					closed = true;
					break;
				}
				const applied = applyGuarded(editor, groupId, toolTurn, () => {
					assertToolCanMutateBlock(editor, part.blockId);
					return [
						{
							type: "set-props",
							blockId: part.blockId,
							props: { layout: part.layout },
						},
					];
				});
				if (!applied.ok) {
					closeApplyFailure(
						editor,
						streaming,
						applied.error,
						groupId,
					);
					closed = true;
				}
				break;
			}

			case "app-create": {
				if (
					!isNonEmptyString(part.appId) ||
					!isNonEmptyString(part.appType) ||
					!isRecord(part.config) ||
					!isAppPlacement(part.placement)
				) {
					closeMalformed(
						editor,
						streaming,
						"app-create requires appId, appType, config, and a valid placement",
						groupId,
					);
					closed = true;
					break;
				}
				const applied = applyGuarded(editor, groupId, toolTurn, () => [
					{
						type: "app",
						change: {
							kind: "create",
							appId: part.appId,
							appType: part.appType,
							config: part.config,
							placement: part.placement,
						},
					},
				]);
				if (!applied.ok) {
					closeApplyFailure(
						editor,
						streaming,
						applied.error,
						groupId,
					);
					closed = true;
				}
				break;
			}

			case "app-update": {
				if (!isNonEmptyString(part.appId) || !isRecord(part.patch)) {
					closeMalformed(
						editor,
						streaming,
						"app-update requires a non-empty appId and patch object",
						groupId,
					);
					closed = true;
					break;
				}
				const applied = applyGuarded(editor, groupId, toolTurn, () => [
					{
						type: "app",
						change: {
							kind: "update",
							appId: part.appId,
							patch: part.patch,
						},
					},
				]);
				if (!applied.ok) {
					closeApplyFailure(
						editor,
						streaming,
						applied.error,
						groupId,
					);
					closed = true;
				}
				break;
			}

			case "app-delete": {
				if (!isNonEmptyString(part.appId)) {
					closeMalformed(
						editor,
						streaming,
						"app-delete requires a non-empty appId",
						groupId,
					);
					closed = true;
					break;
				}
				const applied = applyGuarded(editor, groupId, toolTurn, () => [
					{
						type: "app",
						change: { kind: "delete", appId: part.appId },
					},
				]);
				if (!applied.ok) {
					closeApplyFailure(
						editor,
						streaming,
						applied.error,
						groupId,
					);
					closed = true;
				}
				break;
			}

			case "step-start":
			case "step-end":
				// Agent step markers. Not document ops; hosts observe them via onPart.
				break;

			case "tool-input-start":
			case "tool-input-delta":
				// Incomplete tool args. Wait for tool-input-available; do not execute.
				break;

			case "tool-input-available": {
				if (
					!isNonEmptyString(part.toolCallId) ||
					!isNonEmptyString(part.toolName)
				) {
					closeMalformed(
						editor,
						streaming,
						"tool-input-available requires non-empty toolCallId and toolName",
						groupId,
					);
					closed = true;
					break;
				}
				if (!toolRuntime) {
					closeMalformed(
						editor,
						streaming,
						"tool-input-available cannot run without a tool runtime",
						groupId,
					);
					closed = true;
					break;
				}
				try {
					let emittedProgressiveOutput = false;
					const result = await executeAITool(
						asAIToolRuntime(toolRuntime),
						part.toolName,
						part.input,
						new ToolContextImpl(editor, "", (emitted) =>
							options?.onPart?.(emitted),
						),
						toolTurn,
						(_toolPart, progressiveOutput) => {
							emittedProgressiveOutput = true;
							options?.onPart?.({
								type: "tool-output",
								toolCallId: part.toolCallId,
								output: progressiveOutput,
							});
						},
					);

					if (isAIToolCallDenied(result)) {
						options?.onPart?.({
							type: "tool-error",
							toolCallId: part.toolCallId,
							error: result.reason,
						});
						emitStreamDiagnostic(editor, {
							code: "stream-tool-error",
							level: "warn",
							source: "delta-stream",
							message: `Tool "${part.toolName}" was not granted for this stream (${result.reason}).`,
							toolCallId: part.toolCallId,
							groupId: groupId ?? null,
						});
						break;
					}

					if (!emittedProgressiveOutput) {
						options?.onPart?.({
							type: "tool-output",
							toolCallId: part.toolCallId,
							output: result,
						});
					}
				} catch (err) {
					const error = String(err);
					options?.onPart?.({
						type: "tool-error",
						toolCallId: part.toolCallId,
						error,
					});
					emitStreamDiagnostic(editor, {
						code: "stream-tool-error",
						level: "error",
						source: "delta-stream",
						message: error,
						toolCallId: part.toolCallId,
						groupId: groupId ?? null,
					});
				}
				break;
			}

			case "tool-output":
				// Inbound result (including a host round-trip of parts this file emits).
				// Output is not a document op; do not apply.
				break;

			case "tool-error":
				emitStreamDiagnostic(editor, {
					code: "stream-tool-error",
					level: "error",
					source: "delta-stream",
					message:
						typeof part.error === "string" && part.error.length > 0
							? part.error
							: "tool-error part carried no error text",
					toolCallId: part.toolCallId,
					groupId: groupId ?? null,
				});
				break;

			case "error":
				if (streaming.generationZone) {
					streaming.endStreaming("error");
				}
				break;

			case "abort":
				abortRequested = true;
				closed = true;
				break;

			case "ping":
				break;

			case "done":
				break;

			default: {
				const unexpected: never = part;
				const type = (unexpected as { type: string }).type;
				if (!seenUnknownTypes.has(type)) {
					seenUnknownTypes.add(type);
					emitStreamDiagnostic(editor, {
						code: "stream-part-unknown",
						level: "warn",
						source: "delta-stream",
						message: `Unknown stream part type "${type}" was dropped.`,
						remediation:
							"Upgrade the client or stop sending this part type; it was not applied.",
						partType: type,
						groupId: groupId ?? null,
					});
				}
				break;
			}
		}
	}

	if (abortRequested) {
		endGeneration(streaming, "cancelled");
		emitStreamDiagnostic(editor, {
			code: "stream-aborted",
			level: "info",
			source: "delta-stream",
			message: groupId
				? `Stream aborted; landed ops share undo group "${groupId}".`
				: "Stream aborted; no groupId was provided so landed ops are not one undo group.",
			remediation: groupId
				? "Show cancelled or partial generation. One undo reverts what landed."
				: "Pass groupId when starting the stream so an abort is one undo step.",
			groupId: groupId ?? null,
		});
		return;
	}

	if (streaming.generationZone) {
		streaming.endStreaming("error");
	}
}

function protocolVersionAccepted(
	editor: Editor,
	protocolVersion: number | undefined,
): boolean {
	if (
		protocolVersion === undefined ||
		protocolVersion === PEN_STREAM_PROTOCOL_VERSION
	) {
		return true;
	}

	emitStreamDiagnostic(editor, {
		code: "stream-protocol-mismatch",
		level: "error",
		source: "delta-stream",
		message: `Unsupported stream protocol version ${protocolVersion}; expected ${PEN_STREAM_PROTOCOL_VERSION}.`,
		remediation:
			"Send PenStreamRequest.protocolVersion matching PEN_STREAM_PROTOCOL_VERSION.",
		protocolVersion,
		expectedVersion: PEN_STREAM_PROTOCOL_VERSION,
	});
	return false;
}

function streamApplyOptions(groupId: string | undefined): ApplyOptions {
	if (groupId === undefined) {
		return { origin: "ai" };
	}
	return {
		origin: { type: "ai", groupId },
		groupId,
		undoGroupId: groupId,
	};
}

function applyGuarded(
	editor: Editor,
	groupId: string | undefined,
	toolTurn: AIToolTurn,
	buildOps: () => DocumentOp[],
): { ok: true } | { ok: false; error: unknown } {
	try {
		const ops = buildOps();
		const denied = deniedStreamMutation(ops, toolTurn);
		if (denied) {
			return { ok: false, error: new Error(denied) };
		}
		applyValidatedOps(editor, ops, streamApplyOptions(groupId));
		return { ok: true };
	} catch (error) {
		return { ok: false, error };
	}
}

/** Op type → grant name. Missing keys fail closed. */
const STREAM_OP_TOOL_NAMES: Partial<Record<DocumentOp["type"], string>> = {
	"insert-block": "insert_block",
	"set-props": "update_block",
	"delete-block": "delete_block",
	"move-block": "move_block",
};

function streamOpToolName(op: DocumentOp): string | undefined {
	if (op.type === "app") {
		switch (op.change.kind) {
			case "create":
				return "create_app";
			case "update":
				return "update_app";
			case "delete":
				return "delete_app";
			default: {
				const _exhaustive: never = op.change;
				return _exhaustive;
			}
		}
	}
	return STREAM_OP_TOOL_NAMES[op.type];
}

function deniedStreamMutation(
	ops: readonly DocumentOp[],
	toolTurn: AIToolTurn,
): string | null {
	for (const op of ops) {
		const toolName = streamOpToolName(op);
		if (toolName === undefined) {
			return `Stream part produced an unauthorized op type "${op.type}".`;
		}
		if (!toolTurn.grant.allowedMutatingTools.includes(toolName)) {
			return `Tool "${toolName}" was not granted for this stream (tool-not-allowed).`;
		}
	}
	return null;
}

function closeMalformed(
	editor: Editor,
	streaming: StreamingTarget,
	message: string,
	groupId: string | undefined,
): void {
	endGeneration(streaming, "error");
	emitStreamDiagnostic(editor, {
		code: "stream-part-malformed",
		level: "error",
		source: "delta-stream",
		message,
		remediation:
			"Fix the part fields. The stream was closed; earlier applies were not reverted.",
		groupId: groupId ?? null,
	});
}

function closeOutOfOrder(
	editor: Editor,
	streaming: StreamingTarget,
	message: string,
	groupId: string | undefined,
): void {
	endGeneration(streaming, "error");
	emitStreamDiagnostic(editor, {
		code: "stream-part-out-of-order",
		level: "error",
		source: "delta-stream",
		message,
		remediation:
			"Send gen-start before gen-delta or gen-end. The stream was closed.",
		groupId: groupId ?? null,
	});
}

function closeApplyFailure(
	editor: Editor,
	streaming: StreamingTarget,
	error: unknown,
	groupId: string | undefined,
): void {
	endGeneration(streaming, "error");
	emitStreamDiagnostic(editor, {
		code: "stream-part-malformed",
		level: "error",
		source: "delta-stream",
		message: error instanceof Error ? error.message : String(error),
		remediation:
			"The part was not applied and the stream was closed. Undo the group to drop earlier applies.",
		error,
		groupId: groupId ?? null,
	});
}

function endGeneration(
	streaming: StreamingTarget,
	status: "complete" | "cancelled" | "error",
): void {
	if (streaming.generationZone) {
		streaming.endStreaming(status);
	}
}

function emitStreamDiagnostic(editor: Editor, event: DiagnosticEvent): void {
	editor.internals.emit("diagnostic", event);
}

function hasStringType(part: PenStreamPart): boolean {
	return (
		typeof part === "object" &&
		part !== null &&
		typeof (part as { type?: unknown }).type === "string"
	);
}

function isDataPart(part: PenStreamPart): part is DataPart {
	return part.type.startsWith("data-");
}

function asAIToolRuntime(runtime: {
	executeTool: AIToolRuntime["executeTool"];
	getTool?: AIToolRuntime["getTool"];
	listTools?: AIToolRuntime["listTools"];
	registerTool?: AIToolRuntime["registerTool"];
	unregisterTool?: AIToolRuntime["unregisterTool"];
}): AIToolRuntime {
	return {
		executeTool: runtime.executeTool.bind(runtime),
		getTool: runtime.getTool?.bind(runtime) ?? (() => null),
		listTools: runtime.listTools?.bind(runtime) ?? (() => []),
		registerTool: runtime.registerTool?.bind(runtime) ?? (() => {}),
		unregisterTool: runtime.unregisterTool?.bind(runtime) ?? (() => {}),
	};
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is Position {
	if (value === "first" || value === "last") {
		return true;
	}
	if (!isRecord(value)) {
		return false;
	}
	if (isNonEmptyString(value.before)) {
		return true;
	}
	if (isNonEmptyString(value.after)) {
		return true;
	}
	return (
		isNonEmptyString(value.parent) &&
		typeof value.index === "number" &&
		Number.isFinite(value.index)
	);
}

function isAppPlacement(value: unknown): value is AppPlacement {
	if (!isRecord(value)) {
		return false;
	}
	if (value.mode === "inline") {
		return (
			isNonEmptyString(value.blockId) &&
			typeof value.index === "number" &&
			Number.isFinite(value.index)
		);
	}
	if (value.mode === "anchored") {
		return (
			isNonEmptyString(value.blockId) &&
			(value.anchor === "before" ||
				value.anchor === "after" ||
				value.anchor === "left" ||
				value.anchor === "right" ||
				value.anchor === "overlay")
		);
	}
	return false;
}
