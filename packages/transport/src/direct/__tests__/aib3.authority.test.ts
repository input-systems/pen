import { describe, expect, it, vi } from "vitest";
import { aiToolConfirmPolicyFacet, type AIToolConfirmPolicy } from "@input/pen-ai/tools";
import { directTransport } from "../directTransport";
import type {
	DocumentOp,
	Editor,
	PenStreamPart,
	PenStreamRequest,
	ToolRuntime,
} from "@input/pen-types";

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

function createRuntime(executeTool: ToolRuntime["executeTool"]): ToolRuntime {
	return {
		registerTool() {},
		unregisterTool() {},
		listTools: () => [],
		getTool: () => null,
		executeTool,
	};
}

function requestFor(name: string): PenStreamRequest {
	return {
		prompt: "x",
		toolCalls: [{ toolCallId: "tc-1", name, input: {} }],
	};
}

async function collectParts(
	iterable: AsyncIterable<PenStreamPart>,
): Promise<PenStreamPart[]> {
	const parts: PenStreamPart[] = [];
	for await (const part of iterable) {
		parts.push(part);
	}
	return parts;
}

describe("AIB3 direct transport tool authority", () => {
	it("AIB3: an un-allowlisted mutating toolCall does not execute and does not write", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async (_name, _input, ctx) => {
			ctx.editor.apply([insertTextOp("b1", HOSTILE_TEXT)], {
				origin: "ai",
			});
			return { wrote: true };
		});

		const parts = await collectParts(
			directTransport({
				editor,
				toolRuntime: createRuntime(executeTool),
			}).stream(requestFor("insert_block")),
		);

		expect(executeTool).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
		expect(JSON.stringify(applied)).not.toContain(HOSTILE_TEXT);
		expect(
			parts
				.filter((part) => part.type === "tool-error")
				.map((part) => ({
					toolCallId: "toolCallId" in part ? part.toolCallId : null,
					error: "error" in part ? part.error : null,
				})),
		).toEqual([{ toolCallId: "tc-1", error: "tool-not-allowed" }]);
		expect(parts.some((part) => part.type === "tool-output")).toBe(false);
	});

	it("AIB3: a granted mutating tool may write; an un-allowlisted sibling does not", async () => {
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

		const parts = await collectParts(
			directTransport({
				editor,
				allowedMutatingTools: ["insert_block"],
				toolRuntime: createRuntime(executeTool),
			}).stream({
				prompt: "x",
				toolCalls: [
					{ toolCallId: "ok", name: "insert_block", input: {} },
					{ toolCallId: "denied", name: "delete_block", input: {} },
				],
			}),
		);

		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(executeTool.mock.calls[0]?.[0]).toBe("insert_block");
		expect(applied).toEqual([insertTextOp("b1", "granted")]);
		expect(JSON.stringify(applied)).not.toContain(HOSTILE_TEXT);
		expect(
			parts
				.filter((part) => part.type === "tool-error")
				.map((part) => ("error" in part ? part.error : null)),
		).toEqual(["tool-not-allowed"]);
	});

	it("AIB3: a read-only catalog name that calls apply does not change the document", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async (_name, _input, ctx) => {
			ctx.editor.apply([insertTextOp("b1", HOSTILE_TEXT)], {
				origin: "ai",
			});
			return { wrote: true };
		});

		const parts = await collectParts(
			directTransport({
				editor,
				toolRuntime: createRuntime(executeTool),
			}).stream(requestFor("read_document")),
		);

		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(applied).toEqual([]);
		expect(JSON.stringify(applied)).not.toContain(HOSTILE_TEXT);
		expect(
			parts
				.filter((part) => part.type === "tool-error")
				.map((part) => ("error" in part ? part.error : null)),
		).toEqual(["tool-not-allowed"]);
	});

	it("AIB3: request.tools listing a mutating name is not a grant", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async (_name, _input, ctx) => {
			ctx.editor.apply([insertTextOp("b1", HOSTILE_TEXT)], {
				origin: "ai",
			});
			return { wrote: true };
		});

		const parts = await collectParts(
			directTransport({
				editor,
				toolRuntime: createRuntime(executeTool),
			}).stream({
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
		);

		expect(executeTool).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
		expect(
			parts
				.filter((part) => part.type === "tool-error")
				.map((part) => ("error" in part ? part.error : null)),
		).toEqual(["tool-not-allowed"]);
	});

	it("AIB3: a read-only tool cannot write through context.insertBlock", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async (_name, _input, ctx) => {
			ctx.insertBlock("paragraph", {}, "last");
			return { wrote: true };
		});

		const parts = await collectParts(
			directTransport({
				editor,
				toolRuntime: createRuntime(executeTool),
			}).stream(requestFor("read_document")),
		);

		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(applied).toEqual([]);
		expect(
			parts
				.filter((part) => part.type === "tool-error")
				.map((part) => ("error" in part ? part.error : null)),
		).toEqual(["tool-not-allowed"]);
	});

	it("AIB3: abandoning the stream mid-tool restores editor.apply", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = vi.fn(async () =>
			(async function* () {
				yield { type: "tool-delta", toolCallId: "tc-1", delta: "one" };
				yield { type: "tool-delta", toolCallId: "tc-1", delta: "two" };
			})(),
		);

		// Break out of `for await` the way a host does when the user hits stop.
		// The generator resumes with a return completion, which runs `finally`
		// and skips `catch`.
		for await (const _part of directTransport({
			editor,
			toolRuntime: createRuntime(executeTool),
		}).stream(requestFor("read_document"))) {
			break;
		}

		editor.apply([insertTextOp("b1", "after-abandon")], { origin: "user" });
		expect(applied).toEqual([insertTextOp("b1", "after-abandon")]);
	});

	function policyEditor(policy: AIToolConfirmPolicy) {
		const recording = createRecordingEditor();
		(recording.editor as unknown as { facet: (facet: unknown) => unknown }).facet = (facet) =>
			facet === aiToolConfirmPolicyFacet ? policy : null;
		return recording;
	}

	function deleteRuntime() {
		return vi.fn(async (_name, _input, ctx) => {
			ctx.editor.apply([insertTextOp("b1", HOSTILE_TEXT)], { origin: "ai" });
			return { deleted: true };
		});
	}

	function errors(parts: PenStreamPart[]) {
		return parts
			.filter((part) => part.type === "tool-error")
			.map((part) => ("error" in part ? part.error : null));
	}

	it("AIB3: unconfirmedDestructive refuse on the transport refuses an unconfirmed delete_block", async () => {
		const { editor, applied } = createRecordingEditor();
		const executeTool = deleteRuntime();
		const parts = await collectParts(
			directTransport({
				editor,
				allowedMutatingTools: ["delete_block"],
				unconfirmedDestructive: "refuse",
				toolRuntime: createRuntime(executeTool),
			}).stream(requestFor("delete_block")),
		);
		expect(executeTool).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
		expect(errors(parts)).toEqual(["tool-refused"]);
	});

	it("AIB3: the editor's configured unconfirmedDestructive policy applies to the transport", async () => {
		const { editor, applied } = policyEditor({ unconfirmedDestructive: "refuse" });
		const executeTool = deleteRuntime();
		const parts = await collectParts(
			directTransport({
				editor,
				allowedMutatingTools: ["delete_block"],
				toolRuntime: createRuntime(executeTool),
			}).stream(requestFor("delete_block")),
		);
		expect(executeTool).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
		expect(errors(parts)).toEqual(["tool-refused"]);
	});

	it("AIB3: a transport confirm resolver decides a destructive call under refuse", async () => {
		const { editor } = policyEditor({ unconfirmedDestructive: "refuse" });
		const executeTool = deleteRuntime();
		const confirm = vi.fn(() => "allow" as const);
		const parts = await collectParts(
			directTransport({
				editor,
				allowedMutatingTools: ["delete_block"],
				confirm,
				toolRuntime: createRuntime(executeTool),
			}).stream(requestFor("delete_block")),
		);
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(errors(parts)).toEqual([]);
	});
});
