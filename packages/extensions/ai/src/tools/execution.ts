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
	| { ok: true; close: (output?: unknown) => unknown };

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
			editor != null &&
			stagesAsSuggestions(boundMutationMode(editor)),
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
			toolRuntime.executeTool(name, input, context),
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
	const restoreWrites = editor
		? guardEditorWrites(editor, {
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
			})
		: () => {};
	return {
		ok: true,
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
	disableActiveWriter?: (onReadOnlyMutation: () => void) => () => void;
	_writer?: TextStreamWriter;
};

function guardEditorWrites(
	editor: Editor,
	options: {
		mutating: boolean;
		turn?: AIToolTurn;
		onReadOnlyMutation: () => void;
	},
): () => void {
	const restoreApply = patchEditorApply(editor, options);
	const restoreStream = patchEditorOpenTextStream(editor, options);
	const restoreTarget = patchStreamingTarget(editor, options);
	return () => {
		restoreTarget();
		restoreStream();
		restoreApply();
	};
}

function patchEditorApply(
	editor: Editor,
	options: {
		mutating: boolean;
		turn?: AIToolTurn;
		onReadOnlyMutation: () => void;
	},
): () => void {
	const apply = editor.apply;
	if (typeof apply !== "function") {
		return () => {};
	}
	const originalApply = apply.bind(editor);
	editor.apply = (ops: DocumentOp[], applyOptions?: ApplyOptions) => {
		if (!options.mutating) {
			if (ops.length > 0) {
				options.onReadOnlyMutation();
			}
			return;
		}
		const turn = options.turn;
		if (turn) {
			const rejection = turn.tryRecordOps(ops.length);
			if (rejection) {
				// Reject the whole batch: a partially applied edit is worse than a
				// failed tool call the model can see and retry.
				throw new AIToolBudgetError(
					rejection === "budget-total-ops-exhausted"
						? "budget-total-ops-exhausted"
						: "budget-ops-per-call-exhausted",
					ops.length,
					turn.limits,
				);
			}
		}
		const resolvedOptions = turn
			? applyOptionsWithTurn(applyOptions, turn)
			: applyOptions;
		applyToolOps(editor, originalApply, ops, resolvedOptions);
	};
	return () => {
		editor.apply = originalApply;
	};
}

function patchEditorOpenTextStream(
	editor: Editor,
	options: {
		mutating: boolean;
		turn?: AIToolTurn;
		onReadOnlyMutation: () => void;
	},
): () => void {
	const openTextStream = editor.openTextStream;
	if (typeof openTextStream !== "function") {
		return () => {};
	}
	const originalOpen = openTextStream.bind(editor);
	editor.openTextStream = (target, streamOptions) => {
		if (!options.mutating) {
			options.onReadOnlyMutation();
			return refuseTextStreamWriter(target.blockId);
		}
		const turn = options.turn;
		if (!turn?.groupId) {
			return originalOpen(target, streamOptions);
		}
		return originalOpen(target, {
			...streamOptions,
			origin: originWithGroupId(streamOptions.origin, turn.groupId),
		});
	};
	return () => {
		editor.openTextStream = originalOpen;
	};
}

function patchStreamingTarget(
	editor: Editor,
	options: {
		mutating: boolean;
		onReadOnlyMutation: () => void;
	},
): () => void {
	if (options.mutating) {
		return () => {};
	}
	const streaming = editor.facet(
		streamingTargetFacet,
	) as StreamingTargetHandle | null;
	if (!streaming || typeof streaming !== "object") {
		return () => {};
	}
	const restores: Array<() => void> = [];
	if (typeof streaming.appendDelta === "function") {
		const originalAppend = streaming.appendDelta.bind(streaming);
		streaming.appendDelta = () => {
			options.onReadOnlyMutation();
		};
		restores.push(() => {
			streaming.appendDelta = originalAppend;
		});
	}
	if (typeof streaming.beginStreaming === "function") {
		const originalBegin = streaming.beginStreaming.bind(streaming);
		streaming.beginStreaming = () => {
			options.onReadOnlyMutation();
		};
		restores.push(() => {
			streaming.beginStreaming = originalBegin;
		});
	}
	restores.push(
		disableParkedStreamWriter(streaming, options.onReadOnlyMutation),
	);
	return () => {
		for (const restore of restores.reverse()) {
			restore();
		}
	};
}

function disableParkedStreamWriter(
	streaming: StreamingTargetHandle,
	onReadOnlyMutation: () => void,
): () => void {
	if (typeof streaming.disableActiveWriter === "function") {
		return streaming.disableActiveWriter(onReadOnlyMutation);
	}
	const writer = streaming._writer;
	if (
		writer &&
		typeof writer.append === "function" &&
		typeof writer.splice === "function"
	) {
		return disableTextStreamWriter(writer, onReadOnlyMutation);
	}
	return () => {};
}

function disableTextStreamWriter(
	writer: TextStreamWriter,
	onReadOnlyMutation: () => void,
): () => void {
	const originalAppend = writer.append.bind(writer);
	const originalSplice = writer.splice.bind(writer);
	writer.append = () => {
		onReadOnlyMutation();
	};
	writer.splice = () => {
		onReadOnlyMutation();
	};
	return () => {
		writer.append = originalAppend;
		writer.splice = originalSplice;
	};
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
	if (
		!stagesAsSuggestions(boundMutationMode(editor)) ||
		ops.length === 0
	) {
		originalApply(ops, applyOptions);
		return;
	}
	const wrapped = editor.apply;
	editor.apply = originalApply;
	try {
		applySuggestedAIOperations(editor, {
			operations: ops,
			undoGroupId: applyOptions?.undoGroupId,
		});
	} finally {
		editor.apply = wrapped;
	}
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
