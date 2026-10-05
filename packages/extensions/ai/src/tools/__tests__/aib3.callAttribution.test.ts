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

const FLUSH_MS = 24;

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

/**
 * A stub editor that records applies, diagnostics, and stream writes. With
 * `buffered`, a writer's appends buffer and flush on a timer through the
 * shared `editor.apply`, as core's do, so a flush runs outside any call.
 */
function createHarness({ buffered = false } = {}) {
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
			const record = (kind: WriterRecord["kind"]) =>
				written.push({ writerId, kind, origin: options.origin });
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
					if (!buffered) {
						record("append");
						return;
					}
					pending += text;
					timer ??= setTimeout(flush, FLUSH_MS);
				},
				splice() {
					record("splice");
				},
				get position() {
					return { blockId: target.blockId, offset: 0 };
				},
				flush,
				close: flush,
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

	const runtime = new AIToolRuntimeImpl();
	for (const name of ["read_document", "insert_block"]) {
		runtime.registerTool({
			name,
			description: name,
			inputSchema: { type: "object", properties: {} },
			handler: async () => ({ ok: true }),
		});
	}

	/** Opens a `name` call in its own turn, grouped under `groupId`. */
	async function open(name: string, groupId: string) {
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

	return {
		editor,
		applied,
		written,
		diagnostics,
		streaming: streaming as StreamingTargetImpl,
		open,
	};
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

describe("AIB3 per-call write attribution", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("AIB3: a read-only call's write is refused while a newer mutating call is open, and is not booked to that call", async () => {
		const { editor, applied, diagnostics } = createHarness();
		const runtime = new AIToolRuntimeImpl();
		const readStarted = deferred();
		const readMayWrite = deferred();
		const writeMayFinish = deferred();
		const tool = (
			name: string,
			run: (context: ToolContext) => Promise<void>,
		): ToolDefinition => ({
			name,
			description: name,
			inputSchema: { type: "object", properties: {} },
			handler: async (_input, context: ToolContext) => {
				await run(context);
				return { ok: true };
			},
		});
		runtime.registerTool(
			tool("read_document", async (context) => {
				readStarted.resolve();
				await readMayWrite.promise;
				context.editor.apply([insertOp("from-read")]);
			}),
		);
		runtime.registerTool(
			tool("insert_block", async (context) => {
				await writeMayFinish.promise;
				context.editor.apply([insertOp("from-write")]);
			}),
		);
		const turnA = createAIToolTurn({ groupId: "g-a" });
		const turnB = createAIToolTurn({
			allowedMutatingTools: ["insert_block"],
			groupId: "g-b",
			budget: { maxOpsPerCall: 1 },
		});
		const execute = (name: string, turn: typeof turnA) =>
			executeAITool(
				runtime,
				name,
				{},
				new AIToolContextImpl(editor, "doc-1", () => {}),
				turn,
			);

		const readResult = execute("read_document", turnA);
		await readStarted.promise;
		const writeResult = execute("insert_block", turnB);
		await Promise.resolve();

		readMayWrite.resolve();
		expect(isAIToolCallDenied(await readResult)).toBe(true);
		expect(applied).toEqual([]);
		expect(turnB.ops).toBe(0);
		expect(readOnlyMutations(diagnostics)).toHaveLength(1);

		writeMayFinish.resolve();
		expect(await writeResult).toEqual({ ok: true });
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
		const { applied, diagnostics, open } = createHarness();
		const readCall = await open("read_document", "g-a");
		const writeCall = await open("insert_block", "g-b");

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
		const { applied, open } = createHarness();
		const writeCall = await open("insert_block", "g-b");
		const readCall = await open("read_document", "g-a");

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
		const { editor, applied, diagnostics, open } = createHarness();
		const readCall = await open("read_document", "g-a");

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
			const { editor, applied, open } = createHarness();
			const writeCall = await open("insert_block", "g-b");

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
		const { editor, applied, open } = createHarness();
		const writeCall = await open("insert_block", "g-b");

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
		const { applied, diagnostics, open } = createHarness({
			buffered: true,
		});
		const writeCall = await open("insert_block", "g-a");
		const readCall = await open("read_document", "g-b");

		writeCall.context.editor
			.openTextStream({ blockId: "b" }, { origin: "ai" })
			.append("streamed");
		vi.advanceTimersByTime(FLUSH_MS);

		expect(applied).toHaveLength(1);
		expect(applied[0].options?.origin).toMatchObject({ groupId: "g-a" });
		expect(writeCall.turn.ops).toBe(1);
		expect(readOnlyMutations(diagnostics)).toEqual([]);
		expect(readCall.close({ ok: true })).toEqual({ ok: true });
		writeCall.close({ ok: true });
	});

	it("AIB3: a stream writer's timed flush is booked to its own call, not the newest mutating call", async () => {
		vi.useFakeTimers();
		const { applied, open } = createHarness({ buffered: true });
		const older = await open("insert_block", "g-a");
		const newer = await open("insert_block", "g-b");

		older.context.editor
			.openTextStream({ blockId: "b" }, { origin: "ai" })
			.append("from older");
		vi.advanceTimersByTime(FLUSH_MS);

		expect(applied[0].options?.undoGroupId).toBe("g-a");
		expect(older.turn.ops).toBe(1);
		expect(newer.turn.ops).toBe(0);
		older.close({ ok: true });
		newer.close({ ok: true });
	});

	it("AIB3: text a call's writer still buffers when the call closes lands as the call's write, not unguarded after it", async () => {
		vi.useFakeTimers();
		const { applied, open } = createHarness({ buffered: true });
		const writeCall = await open("insert_block", "g-a");

		writeCall.context.editor
			.openTextStream({ blockId: "b" }, { origin: "ai" })
			.append("tail");
		writeCall.close({ ok: true });

		expect(applied).toHaveLength(1);
		expect(applied[0].options?.undoGroupId).toBe("g-a");
		expect(writeCall.turn.ops).toBe(1);
		vi.advanceTimersByTime(FLUSH_MS);
		expect(applied).toHaveLength(1);
	});

	it("AIB3: a write no call can be named for is refused while any read-only call is open", async () => {
		const { editor, applied, diagnostics, open } = createHarness();
		const readCall = await open("read_document", "g-a");
		const writeCall = await open("insert_block", "g-b");

		editor.apply([insertOp("unattributed")]);
		expect(applied).toEqual([]);
		expect(writeCall.turn.ops).toBe(0);
		expect(readOnlyMutations(diagnostics)).toHaveLength(1);
		readCall.close({ ok: true });
		writeCall.close({ ok: true });
	});

	it("AIB3: every streaming write path follows the call that issued it, not the newest call", async () => {
		const { written, diagnostics, streaming, open } = createHarness();
		// A writer parked from an earlier generation.
		streaming.beginStreaming("zone-0", "b0", { type: "ai" });

		const readCall = await open("read_document", "g-a");
		const writeCall = await open("insert_block", "g-b");
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

describe("AIB3 per-call write guard", () => {
	it("AIB3: closing an earlier call while a later call is open keeps the later guard and restores the original once both close", async () => {
		const { editor, applied, diagnostics, open } = createHarness();
		const originalApply = editor.apply;
		const originalOpen = editor.openTextStream;
		const readCall = await open("read_document", "g-a");
		const writeCall = await open("insert_block", "g-b");

		// The earlier, read-only call unwinds first.
		readCall.close({ ok: true });
		editor.apply([insertOp("b-1")]);
		expect(applied).toHaveLength(1);
		expect(applied[0].options?.groupId).toBe("g-b");

		writeCall.close({ ok: true });
		expect(editor.apply).toBe(originalApply);
		expect(editor.openTextStream).toBe(originalOpen);

		editor.apply([insertOp("after")]);
		expect(applied).toHaveLength(2);
		expect(applied[1].options).toBeUndefined();
		expect(readOnlyMutations(diagnostics)).toEqual([]);
	});

	it("AIB3: closing a later call first leaves the earlier call's guard in force", async () => {
		const { editor, applied, diagnostics, open } = createHarness();
		const originalApply = editor.apply;
		const originalOpen = editor.openTextStream;
		const readCall = await open("read_document", "g-a");
		const writeCall = await open("insert_block", "g-b");

		writeCall.close({ ok: true });
		editor.apply([insertOp("refused")]);
		expect(applied).toEqual([]);
		expect(readOnlyMutations(diagnostics)).toHaveLength(1);

		readCall.close({ ok: true });
		expect(editor.apply).toBe(originalApply);
		expect(editor.openTextStream).toBe(originalOpen);
		editor.apply([insertOp("after")]);
		expect(applied).toHaveLength(1);
	});

	it("AIB3: a call that closes twice does not drop another call's guard", async () => {
		const { editor, applied, open } = createHarness();
		const originalApply = editor.apply;

		const first = await open("insert_block", "g-a");
		first.close({ ok: true });
		const second = await open("read_document", "g-b");
		first.close({ ok: true });

		editor.apply([insertOp("refused")]);
		expect(applied).toEqual([]);

		second.close({ ok: true });
		expect(editor.apply).toBe(originalApply);
	});
});
