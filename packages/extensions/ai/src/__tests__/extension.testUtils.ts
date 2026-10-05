import { getDocumentToolRuntime, toolsExtension } from "@input/pen-tools";
import type { ToolRuntime } from "@input/pen-types";
import { createEditor, defineExtension } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { undoExtension } from "@input/pen-undo";
import { aiExtension } from "../index";
import { deltaStreamExtension } from "../stream";
import {
	createModelDouble,
	type ModelDouble,
	type ModelDoubleResponse,
} from "@input/pen-test";

export function scriptedModel(
	response: string | ModelDoubleResponse = " world",
): ModelDouble {
	return createModelDouble({
		responses: [
			typeof response === "string" ? { text: response } : response,
		],
	});
}

/**
 * An editor with undo, delta streaming, tools and an AI model whose every
 * turn streams `delta` once and finishes.
 */
export function createSingleDeltaEditor(delta: string) {
	return createEditor({
		schema: defaultSchema,
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({
				model: {
					async *stream() {
						yield { type: "text-delta" as const, delta };
						yield { type: "done" as const };
					},
				},
			}),
		],
	});
}

export function testStreamingToolExtension() {
	let toolRuntime: ToolRuntime | null = null;

	return defineExtension({
		name: "test-streaming-tool",
		dependencies: ["tools"],
		activateClient: async ({ editor }) => {
			toolRuntime = getDocumentToolRuntime(editor);
			const definition = {
				name: "test_search",
				description: "Test streaming search tool",
				mutating: false,
				inputSchema: {
					type: "object",
					required: ["query"],
					properties: {
						query: { type: "string" },
					},
				},
				async *handler(input: unknown) {
					const { query } = input as { query: string };
					yield `searching:${query}`;
					yield { matches: 2, query };
				},
			};
			toolRuntime?.registerTool(definition);
		},
		deactivateClient: async () => {
			toolRuntime?.unregisterTool("test_search");
			toolRuntime = null;
		},
	});
}

export function createDeferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

export async function waitForPreview(
	readPreview: () => unknown,
	maxTicks = 10,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (readPreview()) {
			return;
		}
		await Promise.resolve();
	}
}
