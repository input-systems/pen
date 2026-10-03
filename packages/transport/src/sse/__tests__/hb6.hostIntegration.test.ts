import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHeadlessEditor } from "@input/pen-core";
import { deltaStreamExtension, processStream } from "@input/pen-ai/stream";
import type {
	PenStreamPart,
	PenStreamRequest,
	ToolRuntime,
} from "@input/pen-types";
import { createSSEHandler, sseTransport } from "../../sse";

const STREAM_URL = "http://localhost/sse";

function createRuntime(executeTool: ToolRuntime["executeTool"]): ToolRuntime {
	return {
		registerTool() {},
		unregisterTool() {},
		listTools: () => [],
		getTool: () => null,
		executeTool,
	};
}

function installHandlerFetch(
	handler: (request: Request) => Response | Promise<Response>,
): () => void {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = ((input, init) =>
		handler(new Request(input, init))) as typeof fetch;
	return () => {
		globalThis.fetch = originalFetch;
	};
}

describe("HB6 SSE transport host integration", () => {
	let restoreFetch: (() => void) | undefined;

	afterEach(() => {
		restoreFetch?.();
		restoreFetch = undefined;
	});

	it("HB6: a host drives sseTransport.stream() through createSSEHandler into processStream", async () => {
		const readme = readFileSync(
			join(import.meta.dirname, "../../../README.md"),
			"utf8",
		);
		expect(readme).toMatch(/Grade:\s*reference/);

		const serverEditor = createHeadlessEditor();
		const clientEditor = createHeadlessEditor({
			extensions: [deltaStreamExtension()],
		});
		await serverEditor.whenReady();
		await clientEditor.whenReady();

		const executeTool = vi.fn(async (_name, input, ctx) => {
			expect(ctx.editor).toBe(serverEditor);
			expect(ctx.docId).toBe("doc-1");
			return { echoed: input };
		});
		const handler = createSSEHandler({
			editor: serverEditor,
			toolRuntime: createRuntime(executeTool),
			pingInterval: 60_000,
		});
		restoreFetch = installHandlerFetch(handler);

		const transport = sseTransport({ url: STREAM_URL });
		expect(transport.reconnect).toBeUndefined();

		const request: PenStreamRequest = {
			prompt: "summarize the open document",
			context: { docId: "doc-1", blockId: "b1" },
			toolCalls: [
				{
					toolCallId: "tc-1",
					name: "read_document",
					input: { path: "doc" },
				},
			],
		};

		const parts: PenStreamPart[] = [];
		await processStream(transport.stream(request), clientEditor, {
			onPart: (part) => {
				parts.push(part);
			},
		});
		await transport.disconnect();

		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(parts).toEqual([
			{
				type: "tool-output",
				toolCallId: "tc-1",
				output: { echoed: { path: "doc" } },
			},
			{ type: "done" },
		]);

		serverEditor.destroy();
		clientEditor.destroy();
	});
});
