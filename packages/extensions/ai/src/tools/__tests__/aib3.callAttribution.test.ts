import { streamingTargetFacet } from "@input/pen-core";
import type {
	ApplyOptions,
	DocumentOp,
	Editor,
	OpenTextStreamOptions,
	ToolContext,
	ToolDefinition,
} from "@input/pen-types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StreamingTargetImpl } from "../../stream/streamingTarget";
import {
	AI_TOOL_READ_ONLY_MUTATION_CODE,
	AIToolContextImpl,
	AIToolRuntimeImpl,
	createAIToolTurn,
	executeAITool,
	isAIToolCallDenied,
	openAIToolCall,
} from "../index";

function insertOp(blockId: string): DocumentOp {
	return {
		type: "insert-block",
		blockId,
		blockType: "paragraph",
		props: {},
		position: "last",
	};
}

interface WriterRecord {
	readonly writerId: number;
	readonly kind: "append" | "splice";
	readonly origin: unknown;
}

function createRecordingEditor() {
	const applied: Array<{ ops: DocumentOp[]; options?: ApplyOptions }> = [];
	const written: WriterRecord[] = [];
	const diagnostics: Array<{ code: string; message: string }> = [];
	let writerCount = 0;
	let streaming: StreamingTargetImpl | null = null;
	const editor = {
		apply(ops: DocumentOp[], options?: ApplyOptions) {
			applied.push({ ops, options });
		},
		openTextStream(
			target: { blockId: string },
			options: OpenTextStreamOptions,
		) {
			writerCount += 1;
			const writerId = writerCount;
			return {
				append() {
					written.push({
						writerId,
						kind: "append",
						origin: options.origin,
					});
				},
				splice() {
					written.push({
						writerId,
						kind: "splice",
						origin: options.origin,
					});
				},
				get position() {
					return { blockId: target.blockId, offset: 0 };
				},
				flush() {},
				close() {},
				abort() {},
			};
		},
		on: () => () => {},
		facet: (facet: unknown) =>
			facet === streamingTargetFacet ? streaming : null,
		internals: {
			emit(
				_event: string,
				diagnostic: { code: string; message: string },
			) {
				diagnostics.push(diagnostic);
			},
		},
	} as unknown as Editor;
	streaming = new StreamingTargetImpl(editor, 0);
	return {
		editor,
		applied,
		written,
		diagnostics,
		streaming: streaming as StreamingTargetImpl,
	};
}

/**
 * An editor whose stream writers buffer and flush on a timer through the
 * shared `editor.apply`, as core's do, so a flush runs outside any call.
 */
function createBufferingEditor() {
	const applied: Array<{ ops: DocumentOp[]; options?: ApplyOptions }> = [];
	const diagnostics: Array<{ code: string; message: string }> = [];
	const editor = {
		apply(ops: DocumentOp[], options?: ApplyOptions) {
			applied.push({ ops, options });
		},
		openTextStream(
			target: { blockId: string },
			options: OpenTextStreamOptions,
		) {
			let pending = "";
			let timer: ReturnType<typeof setTimeout> | null = null;
			const flush = () => {
				if (timer !== null) {
					clearTimeout(timer);
					timer = null;
				}
				if (pending.length === 0) {
					return;
				}
				const insert = pending;
				pending = "";
				editor.apply(
					[
						{
							type: "splice-text",
							blockId: target.blockId,
							from: 0,
							to: 0,
							insert,
						},
					],
					{ origin: options.origin },
				);
			};
			return {
				append(text: string) {
					pending += text;
					timer ??= setTimeout(flush, 24);
				},
				splice() {},
				get position() {
					return { blockId: target.blockId, offset: 0 };
				},
				flush,
				close: flush,
				abort() {},
			};
		},
		on: () => () => {},
		facet: () => null,
		internals: {
			emit(
				_event: string,
				diagnostic: { code: string; message: string },
			) {
				diagnostics.push(diagnostic);
			},
		},
	} as unknown as Editor;
	return { editor, applied, diagnostics };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function readOnlyMutations(
	diagnostics: ReadonlyArray<{ code: string; message: string }>,
): string[] {
	return diagnostics
		.filter(
			(diagnostic) => diagnostic.code === AI_TOOL_READ_ONLY_MUTATION_CODE,
		)
		.map((diagnostic) => diagnostic.message);
}

async function openCall(
	runtime: AIToolRuntimeImpl,
	editor: Editor,
	name: string,
	groupId: string,
) {
	const context = new AIToolContextImpl(editor, "doc-1", () => {});
	const turn = createAIToolTurn({
		allowedMutatingTools: ["insert_block"],
		groupId,
		budget: { maxOpsPerCall: 2 },
	});
	const opened = await openAIToolCall(runtime, name, {}, context, turn);
	if (!opened.ok) {
		throw new Error(`call ${name} was denied`);
	}
	return { ...opened, turn };
}

function createRuntime(): AIToolRuntimeImpl {
	const runtime = new AIToolRuntimeImpl();
	const handler = async () => ({ ok: true });
	for (const name of ["read_document", "insert_block"]) {
		runtime.registerTool({
			name,
			description: name,
			inputSchema: { type: "object", properties: {} },
			handler,
		});
	}
	return runtime;
}

describe("AIB3 per-call write attribution", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("AIB3: a read-only call's write is refused while a newer mutating call is open, and is not booked to that call", async () => {
		const { editor, applied, diagnostics } = createRecordingEditor();
		const runtime = new AIToolRuntimeImpl();
		const readStarted = deferred();
		const readMayWrite = deferred();
		const writeMayFinish = deferred();
		const readTool: ToolDefinition = {
			name: "read_document",
			description: "Read",
			inputSchema: { type: "object", properties: {} },
			handler: async (_input, context: ToolContext) => {
				readStarted.resolve();
				await readMayWrite.promise;
				context.editor.apply([insertOp("from-read")]);
				return { ok: true };
			},
		};
		const writeTool: ToolDefinition = {
			name: "insert_block",
			description: "Insert",
			inputSchema: { type: "object", properties: {} },
			handler: async (_input, context: ToolContext) => {
				await writeMayFinish.promise;
				context.editor.apply([insertOp("from-write")]);
				return { ok: true };
			},
		};
		runtime.registerTool(readTool);
		runtime.registerTool(writeTool);
		const turnA = createAIToolTurn({ groupId: "g-a" });
		const turnB = createAIToolTurn({
			allowedMutatingTools: ["insert_block"],
			groupId: "g-b",
			budget: { maxOpsPerCall: 1 },
		});

		const readResult = executeAITool(
			runtime,
			"read_document",
			{},
			new AIToolContextImpl(editor, "doc-1", () => {}),
			turnA,
		);
		await readStarted.promise;
		const writeResult = executeAITool(
			runtime,
			"insert_block",
			{},
			new AIToolContextImpl(editor, "doc-1", () => {}),
			turnB,
		);
		await Promise.resolve();

		readMayWrite.resolve();
		const readOutput = await readResult;
		expect(applied).toEqual([]);
		expect(turnB.ops).toBe(0);
		expect(isAIToolCallDenied(readOutput)).toBe(true);
		expect(readOnlyMutations(diagnostics)).toHaveLength(1);

		writeMayFinish.resolve();
		const writeOutput = await writeResult;
		expect(writeOutput).toEqual({ ok: true });
		expect(applied).toHaveLength(1);
		expect(applied[0].ops[0]).toMatchObject({ blockId: "from-write" });
		expect(applied[0].options?.origin).toEqual({
			type: "ai",
			groupId: "g-b",
		});
		expect(applied[0].options?.undoGroupId).toBe("g-b");
		expect(turnB.ops).toBe(1);
	});

	it("AIB3: a mutating call's writes land under its own group while an older read-only call is open", async () => {
		const { editor, applied, diagnostics } = createRecordingEditor();
		const runtime = createRuntime();
		const readCall = await openCall(
			runtime,
			editor,
			"read_document",
			"g-a",
		);
		const writeCall = await openCall(
			runtime,
			editor,
			"insert_block",
			"g-b",
		);

		writeCall.context.editor.apply([insertOp("b-1")]);
		writeCall.context.editor.apply([insertOp("b-2")]);
		expect(applied).toHaveLength(2);
		for (const entry of applied) {
			expect(entry.options?.groupId).toBe("g-b");
		}
		expect(writeCall.turn.ops).toBe(2);
		expect(readOnlyMutations(diagnostics)).toEqual([]);

		readCall.context.editor.apply([insertOp("a-1")]);
		expect(applied).toHaveLength(2);
		expect(readCall.turn.ops).toBe(0);
		expect(writeCall.turn.ops).toBe(2);
		expect(isAIToolCallDenied(readCall.close({ ok: true }))).toBe(true);
		expect(writeCall.close({ ok: true })).toEqual({ ok: true });
	});

	it("AIB3: an older mutating call keeps writing while a newer read-only call is open", async () => {
		const { editor, applied } = createRecordingEditor();
		const runtime = createRuntime();
		const writeCall = await openCall(
			runtime,
			editor,
			"insert_block",
			"g-b",
		);
		const readCall = await openCall(
			runtime,
			editor,
			"read_document",
			"g-a",
		);

		writeCall.context.editor.apply([insertOp("b-1")]);
		readCall.context.editor.apply([insertOp("a-1")]);
		expect(applied.map((entry) => entry.ops[0])).toMatchObject([
			{ blockId: "b-1" },
		]);
		expect(applied[0].options?.groupId).toBe("g-b");
		expect(isAIToolCallDenied(readCall.close({ ok: true }))).toBe(true);
		expect(writeCall.close({ ok: true })).toEqual({ ok: true });
	});

	it("AIB3: the user's typing while a read-only call is open lands and is not reported against the call", async () => {
		const { editor, applied, diagnostics } = createRecordingEditor();
		const runtime = createRuntime();
		const readCall = await openCall(
			runtime,
			editor,
			"read_document",
			"g-a",
		);

		editor.apply([insertOp("typed")], { origin: "user" });
		expect(applied).toEqual([
			{ ops: [insertOp("typed")], options: { origin: "user" } },
		]);
		expect(readOnlyMutations(diagnostics)).toEqual([]);
		expect(readCall.close({ ok: true })).toEqual({ ok: true });
	});

	it.each(["user", "history", "input-rule", "collaborator"] as const)(
		"AIB3: a %s-origin write while a mutating call is open joins neither its group nor its budget (AIB4)",
		async (origin) => {
			const { editor, applied } = createRecordingEditor();
			const runtime = createRuntime();
			const writeCall = await openCall(
				runtime,
				editor,
				"insert_block",
				"g-b",
			);

			editor.apply([insertOp("a"), insertOp("b"), insertOp("c")], {
				origin,
			});
			expect(applied).toHaveLength(1);
			expect(applied[0].options).toEqual({ origin });
			expect(writeCall.turn.ops).toBe(0);
			writeCall.close({ ok: true });
		},
	);

	it("AIB3: an unframed write with an AI origin still belongs to the only open call", async () => {
		const { editor, applied } = createRecordingEditor();
		const runtime = createRuntime();
		const writeCall = await openCall(
			runtime,
			editor,
			"insert_block",
			"g-b",
		);

		editor.apply([insertOp("late")], { origin: { type: "ai" } });
		expect(applied[0].options?.origin).toEqual({
			type: "ai",
			groupId: "g-b",
		});
		expect(writeCall.turn.ops).toBe(1);
		writeCall.close({ ok: true });
	});

	it("AIB3: a stream writer's timed flush lands as its call's write while a read-only call of another turn is open", async () => {
		vi.useFakeTimers();
		const { editor, applied, diagnostics } = createBufferingEditor();
		const runtime = createRuntime();
		const writeCall = await openCall(
			runtime,
			editor,
			"insert_block",
			"g-a",
		);
		const readCall = await openCall(
			runtime,
			editor,
			"read_document",
			"g-b",
		);

		const writer = writeCall.context.editor.openTextStream(
			{ blockId: "b" },
			{ origin: "ai" },
		);
		writer.append("streamed");
		vi.advanceTimersByTime(24);

		expect(applied).toHaveLength(1);
		expect(applied[0].options?.origin).toMatchObject({ groupId: "g-a" });
		expect(writeCall.turn.ops).toBe(1);
		expect(readOnlyMutations(diagnostics)).toEqual([]);
		expect(readCall.close({ ok: true })).toEqual({ ok: true });
		writeCall.close({ ok: true });
	});

	it("AIB3: a stream writer's timed flush is booked to its own call, not the newest mutating call", async () => {
		vi.useFakeTimers();
		const { editor, applied } = createBufferingEditor();
		const runtime = createRuntime();
		const older = await openCall(runtime, editor, "insert_block", "g-a");
		const newer = await openCall(runtime, editor, "insert_block", "g-b");

		older.context.editor
			.openTextStream({ blockId: "b" }, { origin: "ai" })
			.append("from older");
		vi.advanceTimersByTime(24);

		expect(applied[0].options?.undoGroupId).toBe("g-a");
		expect(older.turn.ops).toBe(1);
		expect(newer.turn.ops).toBe(0);
		older.close({ ok: true });
		newer.close({ ok: true });
	});

	it("AIB3: text a call's writer still buffers when the call closes lands as the call's write, not unguarded after it", async () => {
		vi.useFakeTimers();
		const { editor, applied } = createBufferingEditor();
		const runtime = createRuntime();
		const writeCall = await openCall(
			runtime,
			editor,
			"insert_block",
			"g-a",
		);

		writeCall.context.editor
			.openTextStream({ blockId: "b" }, { origin: "ai" })
			.append("tail");
		writeCall.close({ ok: true });

		expect(applied).toHaveLength(1);
		expect(applied[0].options?.undoGroupId).toBe("g-a");
		expect(writeCall.turn.ops).toBe(1);
		vi.advanceTimersByTime(24);
		expect(applied).toHaveLength(1);
	});

	it("AIB3: a write no call can be named for is refused while any read-only call is open", async () => {
		const { editor, applied, diagnostics } = createRecordingEditor();
		const runtime = createRuntime();
		const readCall = await openCall(
			runtime,
			editor,
			"read_document",
			"g-a",
		);
		const writeCall = await openCall(
			runtime,
			editor,
			"insert_block",
			"g-b",
		);

		editor.apply([insertOp("unattributed")]);
		expect(applied).toEqual([]);
		expect(writeCall.turn.ops).toBe(0);
		expect(readOnlyMutations(diagnostics)).toHaveLength(1);
		readCall.close({ ok: true });
		writeCall.close({ ok: true });
	});

	it("AIB3: every streaming write path follows the call that issued it, not the newest call", async () => {
		const { editor, written, diagnostics, streaming } =
			createRecordingEditor();
		const runtime = createRuntime();
		// A writer parked from an earlier generation.
		streaming.beginStreaming("zone-0", "b0", { type: "ai" });

		const readCall = await openCall(
			runtime,
			editor,
			"read_document",
			"g-a",
		);
		const writeCall = await openCall(
			runtime,
			editor,
			"insert_block",
			"g-b",
		);
		const streamingFor = (context: ToolContext) =>
			context.editor.facet(
				streamingTargetFacet,
			) as StreamingTargetImpl;

		// The read-only call's streaming writes are refused on every path.
		const readStreaming = streamingFor(readCall.context);
		readStreaming.appendDelta("parked from A");
		readCall.context.beginStreaming("zone-a0", "b1");
		readCall.context.appendDelta("parked from A via context");
		const readWriter = readCall.context.editor.openTextStream(
			{ blockId: "b1" },
			{ origin: { type: "ai" } },
		);
		readWriter.append("from A");
		readWriter.splice(0, 0, "from A");
		readStreaming.beginStreaming("zone-a", "b1");
		expect(written).toEqual([]);

		// The mutating call's writes pass on every path, parked writer first.
		const writeStreaming = streamingFor(writeCall.context);
		writeStreaming.appendDelta("parked from B");
		const writeWriter = writeCall.context.editor.openTextStream(
			{ blockId: "b2" },
			{ origin: { type: "ai" } },
		);
		writeWriter.append("from B");
		writeWriter.splice(0, 0, "from B");
		writeStreaming.beginStreaming("zone-b", "b3", { type: "ai" });
		writeStreaming.appendDelta("streamed by B");
		writeCall.context.beginStreaming("zone-b2", "b4");
		writeCall.context.appendDelta("streamed by B via context");

		expect(written.map((entry) => [entry.writerId, entry.kind])).toEqual([
			[1, "append"],
			[2, "append"],
			[2, "splice"],
			[3, "append"],
			[4, "append"],
		]);
		for (const entry of written.slice(1)) {
			expect(entry.origin).toMatchObject({ groupId: "g-b" });
		}
		expect(readOnlyMutations(diagnostics)).toHaveLength(1);
		expect(isAIToolCallDenied(readCall.close({ ok: true }))).toBe(true);
		expect(writeCall.close({ ok: true })).toEqual({ ok: true });
	});
});
