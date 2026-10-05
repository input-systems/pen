import { streamingTargetFacet } from "@input/pen-core";
import type {
	ApplyOptions,
	DocumentOp,
	Editor,
	OpenTextStreamOptions,
	ToolContext,
	ToolDefinition,
} from "@input/pen-types";
import { describe, expect, it } from "vitest";

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
