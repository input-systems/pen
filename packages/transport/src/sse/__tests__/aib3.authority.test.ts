import { describe, expect, it, vi } from "vitest";
import type { DocumentOp, Editor, PenStreamPart, ToolRuntime } from "@input/pen-types";
import { aiToolConfirmPolicyFacet, type AIToolConfirmPolicy } from "@input/pen-ai/tools";
import { createSSEHandler } from "../server";
import { parseSSELine } from "../parser";
import type { SSEEvent } from "../types";

const HOSTILE_TEXT = "hostile-ungranted-write";

function insertTextOp(blockId: string, text: string): DocumentOp {
	return { type: "splice-text", blockId, from: 0, to: 0, insert: text };
}

function createRecordingEditor() {
	const applied: DocumentOp[] = [];
	const editor = {
		apply(ops: DocumentOp[]) {
			applied.push(...ops);
		},
		facet: () => null,
		internals: {
			emit() {},
		},
	} as unknown as Editor;
	return { editor, applied };
}

function createRuntime(
	executeTool: ToolRuntime["executeTool"],
): ToolRuntime {
	return {
		registerTool() {},
		unregisterTool() {},
		listTools: () => [],
		getTool: () => null,
		executeTool,
	};
}

async function readAllSSEEvents(response: Response): Promise<SSEEvent[]> {
	const events: SSEEvent[] = [];
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let pending: Partial<SSEEvent> = {};

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const result = parseSSELine(line, pending);
			pending = result.pending;
			if (result.event) events.push(result.event);
		}
	}
	if (buffer.length > 0) {
		const result = parseSSELine(buffer, pending);
		if (result.event) events.push(result.event);
	}
	return events;
}

async function postToolCall(
	handler: ReturnType<typeof createSSEHandler>,
	name: string,
): Promise<{
	status: number;
	parts: PenStreamPart[];
}> {
	const response = await handler(
		new Request("http://localhost/sse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				prompt: "x",
				toolCalls: [{ toolCallId: "tc-1", name, input: {} }],
			}),
		}),
	);
	const events = await readAllSSEEvents(response);
	return {
		status: response.status,
		parts: events.map((event) => JSON.parse(event.data) as PenStreamPart),
	};
}

function errors(parts: PenStreamPart[]) {
	return parts
		.filter((part) => part.type === "tool-error")
		.map((part) => ("error" in part ? part.error : null));
}

function deleteRuntime() {
	return vi.fn(async (_name, _input, ctx) => {
		ctx.editor.apply([insertTextOp("b1", HOSTILE_TEXT)], { origin: "ai" });
		return { deleted: true };
	});
}

/** A refuse policy from the transport option or the editor's facet (AIB3). */
const REFUSE_SOURCES = [
	{ source: "the transport option", option: "refuse", facet: null },
	{ source: "the editor's configured policy", option: undefined, facet: { unconfirmedDestructive: "refuse" } },
] as const;

function policyEditor(policy: AIToolConfirmPolicy | null) {
	const recording = createRecordingEditor();
	(recording.editor as unknown as { facet: (facet: unknown) => unknown }).facet = (facet) =>
		facet === aiToolConfirmPolicyFacet ? policy : null;
	return recording;
}

describe("AIB3 SSE tool authority", () => {
	it("AIB3: an un-allowlisted mutating toolCall does not execute and does not write", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async (_name, _input, ctx) => {
			ctx.editor.apply([insertTextOp("b1", HOSTILE_TEXT)], {
				origin: "ai",
			});
			return { wrote: true };
		});

		const { status, parts } = await postToolCall(
			createSSEHandler({
				editor,
				toolRuntime: createRuntime(executeTool),
				pingInterval: 60_000,
			}),
			"insert_block",
		);

		expect(status).toBe(200);
		expect(executeTool).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
		expect(JSON.stringify(applied)).not.toContain(HOSTILE_TEXT);
		expect(
			parts.filter((part) => part.type === "tool-error").map((part) => ({
				toolCallId: "toolCallId" in part ? part.toolCallId : null,
				error: "error" in part ? part.error : null,
			})),
		).toEqual([{ toolCallId: "tc-1", error: "tool-not-allowed" }]);
		expect(parts.some((part) => part.type === "tool-output")).toBe(false);
	});

	it("AIB3: executeTool without a grant is default-deny even when the handler is already on the runtime", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async () => {
			throw new Error("handler must not run");
		});

		const { parts } = await postToolCall(
			createSSEHandler({
				editor,
				allowedMutatingTools: [],
				toolRuntime: createRuntime(executeTool),
				pingInterval: 60_000,
			}),
			"write_document",
		);

		expect(executeTool).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
		expect(parts.some((part) => part.type === "tool-error")).toBe(true);
	});

	it("AIB3: a granted mutating tool may write; a sibling un-allowlisted call does not", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async (name, _input, ctx) => {
			ctx.editor.apply(
				[
					insertTextOp(
						"b1",
						name === "insert_block" ? "granted" : HOSTILE_TEXT,
					),
				],
				{ origin: "ai" },
			);
			return { name };
		});

		const handler = createSSEHandler({
			editor,
			allowedMutatingTools: ["insert_block"],
			toolRuntime: createRuntime(executeTool),
			pingInterval: 60_000,
		});
		const response = await handler(
			new Request("http://localhost/sse", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt: "x",
					toolCalls: [
						{
							toolCallId: "ok",
							name: "insert_block",
							input: {},
						},
						{
							toolCallId: "denied",
							name: "delete_block",
							input: {},
						},
					],
				}),
			}),
		);
		const events = await readAllSSEEvents(response);
		const parts = events.map((event) => JSON.parse(event.data) as PenStreamPart);

		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(executeTool.mock.calls[0]?.[0]).toBe("insert_block");
		expect(applied).toEqual([insertTextOp("b1", "granted")]);
		expect(JSON.stringify(applied)).not.toContain(HOSTILE_TEXT);
		expect(errors(parts)).toEqual(["tool-not-allowed"]);
	});

	it("AIB3: a read-only catalog name that calls apply does not change the document", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async (_name, _input, ctx) => {
			ctx.editor.apply([insertTextOp("b1", HOSTILE_TEXT)], {
				origin: "ai",
			});
			return { wrote: true };
		});

		const { parts } = await postToolCall(
			createSSEHandler({
				editor,
				toolRuntime: createRuntime(executeTool),
				pingInterval: 60_000,
			}),
			"read_document",
		);

		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(applied).toEqual([]);
		expect(JSON.stringify(applied)).not.toContain(HOSTILE_TEXT);
		expect(errors(parts)).toEqual(["tool-not-allowed"]);
	});

	it("AIB3: request.tools listing a mutating name is not a grant", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async (_name, _input, ctx) => {
			ctx.editor.apply([insertTextOp("b1", HOSTILE_TEXT)], {
				origin: "ai",
			});
			return { wrote: true };
		});
		const handler = createSSEHandler({
			editor,
			toolRuntime: createRuntime(executeTool),
			pingInterval: 60_000,
		});
		const response = await handler(
			new Request("http://localhost/sse", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt: "x",
					tools: [
						{
							name: "insert_block",
							description: "Insert",
							inputSchema: { type: "object" },
						},
					],
					toolCalls: [
						{ toolCallId: "tc-1", name: "insert_block", input: {} },
					],
				}),
			}),
		);
		const events = await readAllSSEEvents(response);
		const parts = events.map((event) => JSON.parse(event.data) as PenStreamPart);

		expect(response.status).toBe(200);
		expect(executeTool).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
		expect(errors(parts)).toEqual(["tool-not-allowed"]);
	});

	it("AIB3: a read-only tool cannot write through context.insertBlock", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async (_name, _input, ctx) => {
			ctx.insertBlock("paragraph", {}, "last");
			return { wrote: true };
		});

		const { parts } = await postToolCall(
			createSSEHandler({
				editor,
				toolRuntime: createRuntime(executeTool),
				pingInterval: 60_000,
			}),
			"read_document",
		);

		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(applied).toEqual([]);
		expect(errors(parts)).toEqual(["tool-not-allowed"]);
	});

	it("AIB3: cancelling the SSE body mid-tool restores editor.apply", async () => {
		const { editor, applied } = createRecordingEditor();
		let releaseSecond: () => void = () => {};
		const secondGate = new Promise<void>((resolve) => {
			releaseSecond = resolve;
		});
		const executeTool = vi.fn(async () =>
			(async function* () {
				yield { type: "tool-delta", toolCallId: "tc-1", delta: "one" };
				await secondGate;
				yield { type: "tool-delta", toolCallId: "tc-1", delta: "two" };
			})(),
		);
		const handler = createSSEHandler({
			editor,
			toolRuntime: createRuntime(executeTool),
			pingInterval: 60_000,
		});
		const response = await handler(
			new Request("http://localhost/sse", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt: "x",
					toolCalls: [
						{ toolCallId: "tc-1", name: "read_document", input: {} },
					],
				}),
			}),
		);
		const reader = response.body!.getReader();
		await reader.read();
		await reader.cancel();
		releaseSecond();
		await new Promise((resolve) => setTimeout(resolve, 0));

		editor.apply([insertTextOp("b1", "after-cancel")], { origin: "user" });
		expect(applied).toEqual([insertTextOp("b1", "after-cancel")]);
	});

	it.each(REFUSE_SOURCES)(
		"AIB3: unconfirmedDestructive refuse from $source refuses an unconfirmed delete_block on the SSE handler",
		async ({ option, facet }) => {
			const { editor, applied } = policyEditor(facet);
			const executeTool = deleteRuntime();
			const { parts } = await postToolCall(
				createSSEHandler({
					editor,
					allowedMutatingTools: ["delete_block"],
					unconfirmedDestructive: option,
					toolRuntime: createRuntime(executeTool),
					pingInterval: 60_000,
				}),
				"delete_block",
			);
			expect(executeTool).not.toHaveBeenCalled();
			expect(applied).toEqual([]);
			expect(errors(parts)).toEqual(["tool-refused"]);
		},
	);
});
