import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createHeadlessEditor } from "@input/pen-core";
import { deltaStreamExtension, processStream } from "@input/pen-ai/stream";
import type {
	PenStreamPart,
	PenStreamRequest,
	ToolRuntime,
} from "@input/pen-types";
import { directTransport } from "../../direct";

function createRuntime(executeTool: ToolRuntime["executeTool"]): ToolRuntime {
	return {
		registerTool() {},
		unregisterTool() {},
		listTools: () => [],
		getTool: () => null,
		executeTool,
	};
}

describe("HB6 direct transport host integration", () => {
	it("HB6: a host constructs directTransport and consumes stream() through processStream", async () => {
		const readme = readFileSync(
			join(import.meta.dirname, "../../../README.md"),
			"utf8",
		);
		expect(readme).toMatch(/Grade:\s*development-only/);

		const editor = createHeadlessEditor({
			extensions: [deltaStreamExtension()],
		});
		await editor.whenReady();

		const executeTool = vi.fn(async (_name, input, ctx) => {
			// The call's own view of the construction-time editor (AIB3).
			expect(ctx.editor.internals.adapter).toBe(editor.internals.adapter);
			expect(ctx.docId).toBe("doc-1");
			return { echoed: input };
		});
		const transport = directTransport({
			editor,
			toolRuntime: createRuntime(executeTool),
		});

		expect(transport.reconnect).toBeUndefined();
		expect(transport.connected).toBe(true);
		await transport.connect();

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
		await processStream(transport.stream(request), editor, {
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

		editor.destroy();
	});
});
