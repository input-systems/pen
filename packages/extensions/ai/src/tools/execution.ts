import {
	collectToolExecutionOutput,
	streamingTargetFacet,
} from "@input/pen-core";
import type {
	ApplyOptions,
	DocumentOp,
	Editor,
	OpOrigin,
	TextStreamWriter,
	ToolAuthorityContext,
	ToolContext,
} from "@input/pen-types";
import type { AIMutationMode } from "../runtime/contracts";
import { stagesAsSuggestions } from "../runtime/mutationPolicy";
import { applySuggestedAIOperations } from "../suggestions/applySuggestedAIOperations";
import {
	AIToolBudgetError,
	authorizeAIToolCall,
	denyAIToolCall,
	isAIToolCallDenied,
	type AIToolAuthorityReason,
	type AIToolCallDenied,
	type AIToolTurn,
} from "./authority";
import { AI_TOOL_READ_ONLY_MUTATION_CODE } from "./constants";
import type { AIToolRuntime } from "./types";
import { layerMethod } from "../utils/methodLayers";
import {
	createCallView,
	openGuardedCallRecord,
	reportRefusedWrite,
	resolveWriteOwner,
	runAsCall,
	runPastGuards,
	type GuardedCall,
} from "./callAttribution";

/**
 * Every live generation's binding, in bind order (AIB3). Generations overlap
 * — one is cancelled after the next has bound — so each binding is its own
 * entry and unbinding removes only that entry; the most recent live binding
 * decides. A single save-and-restore slot would let the earlier generation's
 * unbind restore over the later one and land its staged writes durably.
 */
const toolApplyMutationModes = new WeakMap<
	Editor,
	{ readonly mode: AIMutationMode }[]
>();

export function bindAIToolMutationMode(
	editor: Editor,
	mode: AIMutationMode,
): () => void {
	const binding = { mode };
	const bindings = toolApplyMutationModes.get(editor) ?? [];
	bindings.push(binding);
	toolApplyMutationModes.set(editor, bindings);
	return () => {
		const index = bindings.indexOf(binding);
		if (index >= 0) {
			bindings.splice(index, 1);
		}
	};
}

function boundMutationMode(editor: Editor): AIMutationMode | undefined {
	return toolApplyMutationModes.get(editor)?.at(-1)?.mode;
}

/**
 * Applies ops the way a tool call would under the turn's posture: staged when
 * the bound mutation mode makes the turn's writes proposals, durable when it
 * does not.
 *
 * Staging is installed by the write guard, which only exists while a call is
 * open (see {@link applyToolOps}). A write that happens between calls — content
 * committed while its own call is still streaming, EC20 — is not covered by it
 * and would land durably under a posture that promised review, so it asks the
 * same question here instead of writing directly.
 */
export function applyAIOpsForBoundMutationMode(
	editor: Editor,
	ops: DocumentOp[],
	options?: ApplyOptions,
): void {
	if (ops.length === 0) {
		return;
	}
	if (!stagesAsSuggestions(boundMutationMode(editor))) {
		editor.apply(ops, options);
		return;
	}
	applySuggestedAIOperations(editor, {
		operations: ops,
		undoGroupId: options?.undoGroupId,
	});
}

export type OpenAIToolCall =
	| { ok: false; denial: AIToolCallDenied }
	| {
			ok: true;
			/**
			 * The context the call's handler runs with: its writes are attributed
			 * to this call even while other calls overlap it (AIB3). Run the
			 * handler with this, not the context passed in.
			 */
			context: ToolContext;
			close: (output?: unknown) => unknown;
	  };

/**
 * Authorize a model-driven tool call and install the write guard without
 * executing the handler. Transports stream `executeTool` themselves so
 * they can abort mid-iterable; they must not call `executeTool` unless
 * this returns `{ ok: true }`.
 */
export async function openAIToolCall(
	toolRuntime: AIToolRuntime,
	name: string,
	input: unknown,
	context: ToolContext,
	turn?: AIToolTurn,
): Promise<OpenAIToolCall> {
	const authorityContext = toolAuthorityContext(context);
	if (!turn) {
		// No turn, no grant: a call that writes, or that this context
		// classifies destructive, never runs here (AIB3).
		const authorization = await authorizeAIToolCall(
			name,
			input,
			toolRuntime.getTool(name),
			{ allowedMutatingTools: [] },
			authorityContext,
		);
		if (!authorization.allowed || authorization.destructive) {
			return {
				ok: false,
				denial: denyAIToolCall(
					"blocked",
					authorization.reason ?? "tool-not-allowed",
				),
			};
		}
		return openGuardedCall(name, context, authorization.mutating);
	}

	if (turn.ended) {
		turn.markStatus("turn-ended", turn.reason ?? "budget-calls-exhausted");
		return {
			ok: false,
			denial: denyAIToolCall(
				"turn-ended",
				turn.reason ?? "budget-calls-exhausted",
			),
		};
	}

	const authorization = await authorizeAIToolCall(
		name,
		input,
		toolRuntime.getTool(name),
		turn.grant,
		authorityContext,
	);

	if (!turn.tryRecordCall()) {
		turn.markStatus("turn-ended", turn.reason ?? "budget-calls-exhausted");
		return {
			ok: false,
			denial: denyAIToolCall(
				"turn-ended",
				turn.reason ?? "budget-calls-exhausted",
			),
		};
	}

	// A refusal carries its diagnostic too ("refuse" with no resolver): the
	// host learns why the call was blocked, not only that it was.
	if (authorization.diagnostic) {
		emitAuthorityDiagnostic(context, authorization.diagnostic);
	}

	if (!authorization.allowed) {
		turn.closeCall();
		return {
			ok: false,
			denial: finishDeniedCall(
				turn,
				authorization.reason ?? "tool-not-allowed",
			),
		};
	}

	return openGuardedCall(name, context, authorization.mutating, turn);
}

/**
 * The per-call facts a destructive resolver reads (AIB3). `staged` is exactly
 * the predicate {@link applyToolOps} stages on, so it is never claimed for a
 * call that will land: a turn suggest mode stages while its bound mode is
 * direct reads as direct, the conservative direction.
 */
function toolAuthorityContext(context: ToolContext): ToolAuthorityContext {
	const editor = resolveToolEditor(context);
	return {
		staged:
			editor != null && stagesAsSuggestions(boundMutationMode(editor)),
	};
}

export async function executeAITool(
	toolRuntime: AIToolRuntime,
	name: string,
	input: unknown,
	context: ToolContext,
	turn?: AIToolTurn,
	onPart?: (part: unknown, output: unknown) => void,
): Promise<unknown> {
	const opened = await openAIToolCall(
		toolRuntime,
		name,
		input,
		context,
		turn,
	);
	if (!opened.ok) {
		return opened.denial;
	}
	try {
		const output = await collectToolExecutionOutput(
			toolRuntime.executeTool(name, input, opened.context),
			onPart,
		);
		return opened.close(output);
	} finally {
		// Must not be `catch`: a rejected collect is only one unwind. `close()`
		// is idempotent, so the success path that already closed is unaffected.
		opened.close();
	}
}

function resolveToolEditor(context: ToolContext): Editor | null {
	try {
		return context.editor ?? null;
	} catch {
		return null;
	}
}

function openGuardedCall(
	name: string,
	context: ToolContext,
	mutating: boolean,
	turn?: AIToolTurn,
): Extract<OpenAIToolCall, { ok: true }> {
	let readOnlyMutation = false;
	let closed = false;
	let closeResult: unknown;
	const editor = resolveToolEditor(context);
	const call: GuardedCall = {
		mutating,
		turn,
		onReadOnlyMutation: () => {
			if (readOnlyMutation) {
				return;
			}
			readOnlyMutation = true;
			emitAuthorityDiagnostic(context, {
				code: AI_TOOL_READ_ONLY_MUTATION_CODE,
				message: `Read-only tool "${name}" attempted a document write and was refused.`,
			});
		},
	};
	const restoreWrites = editor ? guardEditorWrites(editor, call) : () => {};
	return {
		ok: true,
		context: editor ? createCallContext(editor, call, context) : context,
		close: (output?: unknown) => {
			if (closed) {
				return closeResult;
			}
			closed = true;
			restoreWrites();
			turn?.closeCall();
			if (readOnlyMutation) {
				closeResult = turn
					? finishDeniedCall(turn, "tool-not-allowed")
					: denyAIToolCall("blocked", "tool-not-allowed");
				return closeResult;
			}
			if (isAIToolCallDenied(output)) {
				closeResult = turn
					? finishDeniedCall(turn, output.reason)
					: output;
				return closeResult;
			}
			if (turn) {
				if (turn.ended) {
					turn.markStatus("executed", turn.reason ?? undefined);
				} else {
					turn.markStatus("executed");
				}
			}
			closeResult = output;
			return closeResult;
		},
	};
}

function finishDeniedCall(
	turn: AIToolTurn,
	reason: AIToolAuthorityReason,
): AIToolCallDenied {
	if (turn.ended) {
		turn.markStatus("turn-ended", turn.reason ?? reason);
		return denyAIToolCall("turn-ended", turn.reason ?? reason);
	}
	turn.markStatus("blocked", reason);
	return denyAIToolCall("blocked", reason);
}

type StreamingTargetHandle = {
	beginStreaming?: (
		zoneId: string,
		blockId: string,
		origin?: OpOrigin,
	) => void;
	appendDelta?: (delta: string) => void;
	endStreaming?: (status: "complete" | "cancelled" | "error") => void;
	readonly activeWriter?: TextStreamWriter | null;
	_writer?: TextStreamWriter | null;
};

type WriteMethodKey = "append" | "splice" | "appendDelta" | "beginStreaming";

/**
 * The call's own view of the tool context (AIB3): its editor, the streaming
 * target and the writers it opens all attribute their writes to this call,
 * so overlapping calls each answer to their own guard.
 */
function createCallContext(
	editor: Editor,
	call: GuardedCall,
	context: ToolContext,
): ToolContext {
	const editorView = createCallView(editor, call, editor, {
		result: (key, args, value) => {
			if (!isObject(value)) {
				return value;
			}
			if (key === "openTextStream") {
				return createCallView(editor, call, value);
			}
			if (key === "facet" && args[0] === streamingTargetFacet) {
				return createCallView(editor, call, value);
			}
			return value;
		},
	});
	return createCallView(editor, call, context, {
		property: (key, value) => (key === "editor" ? editorView : value),
	});
}

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

/**
 * Installs the write guard for one call. Every guarded write path — `apply`,
 * `openTextStream`, the streaming target's `beginStreaming`/`appendDelta` and
 * its parked writer's `append`/`splice` — asks {@link resolveWriteOwner} whose
 * write it is, so all of them follow the call that issued the write.
 */
function guardEditorWrites(editor: Editor, call: GuardedCall): () => void {
	const releaseCall = openGuardedCallRecord(editor, call);
	const restoreApply = patchEditorApply(editor);
	const restoreStream = patchEditorOpenTextStream(editor);
	const restoreTarget = patchStreamingTarget(editor);
	return () => {
		restoreTarget();
		restoreStream();
		restoreApply();
		releaseCall();
	};
}

function patchEditorApply(editor: Editor): () => void {
	if (typeof editor.apply !== "function") {
		return () => {};
	}
	return layerMethod(
		editor,
		"apply",
		(originalApply) => (ops, applyOptions) => {
			const owner = resolveWriteOwner(editor, applyOptions?.origin);
			if (owner.kind === "none") {
				originalApply(ops, applyOptions);
				return;
			}
			if (owner.kind === "refused" || !owner.call.mutating) {
				if (ops.length > 0) {
					reportRefusedWrite(owner);
				}
				return;
			}
			const turn = owner.call.turn;
			if (turn) {
				recordTurnOps(turn, ops.length);
			}
			const resolvedOptions = turn
				? applyOptionsWithTurn(applyOptions, turn)
				: applyOptions;
			applyToolOps(editor, originalApply, ops, resolvedOptions);
		},
	);
}

/**
 * Books `count` ops to the turn, or throws for the whole batch: a partially
 * applied edit is worse than a failed tool call the model can see and retry.
 */
function recordTurnOps(turn: AIToolTurn, count: number): void {
	const rejection = turn.tryRecordOps(count);
	if (!rejection) {
		return;
	}
	throw new AIToolBudgetError(
		rejection === "budget-total-ops-exhausted"
			? "budget-total-ops-exhausted"
			: "budget-ops-per-call-exhausted",
		count,
		turn.limits,
	);
}

function patchEditorOpenTextStream(editor: Editor): () => void {
	if (typeof editor.openTextStream !== "function") {
		return () => {};
	}
	return layerMethod(
		editor,
		"openTextStream",
		(originalOpen) => (target, streamOptions) => {
			const owner = resolveWriteOwner(editor, streamOptions?.origin);
			if (owner.kind === "none") {
				return originalOpen(target, streamOptions);
			}
			if (owner.kind === "refused" || !owner.call.mutating) {
				reportRefusedWrite(owner);
				return refuseTextStreamWriter(target.blockId);
			}
			const groupId = owner.call.turn?.groupId;
			if (!groupId) {
				return originalOpen(target, streamOptions);
			}
			return originalOpen(target, {
				...streamOptions,
				origin: originWithGroupId(streamOptions.origin, groupId),
			});
		},
	);
}

function patchStreamingTarget(editor: Editor): () => void {
	const streaming = editor.facet(
		streamingTargetFacet,
	) as StreamingTargetHandle | null;
	if (!streaming || typeof streaming !== "object") {
		return () => {};
	}
	const restores: Array<() => void> = [];
	for (const key of ["appendDelta", "beginStreaming"] as const) {
		if (typeof streaming[key] === "function") {
			restores.push(guardWriteMethod(editor, streaming, key));
		}
	}
	// A writer parked from an earlier stream is reachable without reopening it
	// through `openTextStream`, so it is guarded where it stands.
	const writer = streaming.activeWriter ?? streaming._writer;
	if (
		writer &&
		typeof writer.append === "function" &&
		typeof writer.splice === "function"
	) {
		restores.push(guardWriteMethod(editor, writer, "append"));
		restores.push(guardWriteMethod(editor, writer, "splice"));
	}
	return () => {
		for (const restore of restores.reverse()) {
			restore();
		}
	};
}

/**
 * Guards a method that only writes: refused for a read-only owner, run as the
 * owner for a mutating one so its nested `apply`/`openTextStream` stay its own.
 */
function guardWriteMethod(
	editor: Editor,
	target: object,
	key: WriteMethodKey,
): () => void {
	return layerMethod(
		target as Record<WriteMethodKey, (...args: never[]) => void>,
		key,
		(original) =>
			(...args: never[]) => {
				const owner = resolveWriteOwner(editor);
				if (owner.kind === "none") {
					original(...args);
					return;
				}
				if (owner.kind === "refused" || !owner.call.mutating) {
					reportRefusedWrite(owner);
					return;
				}
				runAsCall(editor, owner.call, () => original(...args));
			},
	);
}

function refuseTextStreamWriter(blockId: string): TextStreamWriter {
	return {
		append() {},
		splice() {},
		get position() {
			return { blockId, offset: 0 };
		},
		flush() {},
		close() {},
		abort() {},
	};
}

function applyToolOps(
	editor: Editor,
	originalApply: (ops: DocumentOp[], applyOptions?: ApplyOptions) => void,
	ops: DocumentOp[],
	applyOptions: ApplyOptions | undefined,
): void {
	if (!stagesAsSuggestions(boundMutationMode(editor)) || ops.length === 0) {
		originalApply(ops, applyOptions);
		return;
	}
	// Staging writes its suggestion marks through `editor.apply`; this guard
	// already accounted for them, so they pass every call's guard.
	runPastGuards(editor, () =>
		applySuggestedAIOperations(editor, {
			operations: ops,
			undoGroupId: applyOptions?.undoGroupId,
		}),
	);
}

function applyOptionsWithTurn(
	options: ApplyOptions | undefined,
	turn: AIToolTurn,
): ApplyOptions {
	const groupId = turn.groupId;
	if (!groupId) {
		return options ?? {};
	}
	return {
		...options,
		origin: originWithGroupId(options?.origin, groupId),
		groupId: options?.groupId ?? groupId,
		undoGroupId: options?.undoGroupId ?? groupId,
	};
}

function originWithGroupId(
	origin: OpOrigin | undefined,
	groupId: string,
): OpOrigin {
	if (typeof origin === "string") {
		return { type: origin, groupId };
	}
	if (origin) {
		return { ...origin, groupId: origin.groupId ?? groupId };
	}
	return { type: "ai", groupId };
}

function emitAuthorityDiagnostic(
	context: ToolContext,
	diagnostic: { code: string; message: string },
): void {
	context.editor.internals?.emit?.("diagnostic", {
		code: diagnostic.code,
		level: "info",
		source: "ai-tools",
		message: diagnostic.message,
		extension: "ai-tools",
	});
}
