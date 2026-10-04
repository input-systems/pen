import type {
	ApplyOptions,
	DocumentOp,
	Editor,
	TextStreamWriter,
	ToolDefinition,
} from "@input/pen-types";
import { describe, expect, it } from "vitest";

import {
	AI_TOOL_READ_ONLY_MUTATION_CODE,
	AIToolContextImpl,
	AIToolRuntimeImpl,
	createAIToolTurn,
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

function createRecordingEditor() {
	const applied: Array<{ ops: DocumentOp[]; options?: ApplyOptions }> = [];
	const diagnostics: Array<{ code: string; message: string }> = [];
	const writer: TextStreamWriter = {
		append() {},
		splice() {},
		get position() {
			return { blockId: "b1", offset: 0 };
		},
		flush() {},
		close() {},
		abort() {},
	};
	const editor = {
		apply(ops: DocumentOp[], options?: ApplyOptions) {
			applied.push({ ops, options });
		},
		openTextStream: () => writer,
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
	return { editor, applied, diagnostics, writer };
}

function createRuntime(): AIToolRuntimeImpl {
	const runtime = new AIToolRuntimeImpl();
	const handler = async () => ({ ok: true });
	const tools: ToolDefinition[] = [
		{
			name: "read_document",
			description: "Read",
			inputSchema: { type: "object", properties: {} },
			handler,
		},
		{
			name: "insert_block",
			description: "Insert",
			inputSchema: { type: "object", properties: {} },
			handler,
		},
	];
	for (const tool of tools) {
		runtime.registerTool(tool);
	}
	return runtime;
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
	});
	const opened = await openAIToolCall(runtime, name, {}, context, turn);
	if (!opened.ok) {
		throw new Error(`call ${name} was denied`);
	}
	return opened;
}

describe("AIB3 per-call write guard", () => {
	it("AIB3: closing an earlier call while a later call is open keeps the later guard and restores the original once both close", async () => {
		const runtime = createRuntime();
		const { editor, applied, diagnostics } = createRecordingEditor();
		const originalApply = editor.apply;
		const originalOpen = editor.openTextStream;

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
		expect(
			diagnostics.filter(
				(diagnostic) =>
					diagnostic.code === AI_TOOL_READ_ONLY_MUTATION_CODE,
			),
		).toEqual([]);
	});

	it("AIB3: closing a later call first leaves the earlier call's guard in force", async () => {
		const runtime = createRuntime();
		const { editor, applied, diagnostics } = createRecordingEditor();
		const originalApply = editor.apply;
		const originalOpen = editor.openTextStream;

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

		writeCall.close({ ok: true });
		editor.apply([insertOp("refused")]);
		expect(applied).toEqual([]);
		expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
			AI_TOOL_READ_ONLY_MUTATION_CODE,
		);

		readCall.close({ ok: true });
		expect(editor.apply).toBe(originalApply);
		expect(editor.openTextStream).toBe(originalOpen);
		editor.apply([insertOp("after")]);
		expect(applied).toHaveLength(1);
	});

	it("AIB3: a call that closes twice does not drop another call's guard", async () => {
		const runtime = createRuntime();
		const { editor, applied } = createRecordingEditor();
		const originalApply = editor.apply;

		const first = await openCall(runtime, editor, "insert_block", "g-a");
		first.close({ ok: true });
		const second = await openCall(runtime, editor, "read_document", "g-b");
		first.close({ ok: true });

		editor.apply([insertOp("refused")]);
		expect(applied).toEqual([]);

		second.close({ ok: true });
		expect(editor.apply).toBe(originalApply);
	});
});
