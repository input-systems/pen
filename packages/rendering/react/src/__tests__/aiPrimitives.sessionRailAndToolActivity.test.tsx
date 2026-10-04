// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor, toolRuntimeFacet } from "@input/pen-core";
import type { ToolRuntime } from "@input/pen-types";
import { defineExtension } from "@input/pen-core";
import { aiExtension, getAIController } from "@input/pen-ai";
import { undoExtension } from "@input/pen-undo";
import { deltaStreamExtension } from "@input/pen-ai/stream";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { Pen } from "../index";
import { waitForAttributeValue } from "./utils/aiPrimitivesTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function testStreamingToolExtension() {
	let toolRuntime: ToolRuntime | null = null;

	return defineExtension({
		name: "test-streaming-tool",
		dependencies: ["tools"],
		activateClient: async ({ editor }) => {
			toolRuntime =
				(editor.facet(
					toolRuntimeFacet,
				) as ToolRuntime | null) ?? null;
			toolRuntime?.registerTool({
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
			});
		},
		deactivateClient: async () => {
			toolRuntime?.unregisterTool("test_search");
			toolRuntime = null;
		},
	});
}

describe("@input/pen-react AI primitives: session rail and tool activity", () => {
	it("renders active inline session controls as a right-edge rail", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "planet",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hello world",
				},
			],
			{ origin: "system" },
		);
		editor.selectTextRange({ blockId, offset: 6 }, { blockId, offset: 11 });

		const session = controller?.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		if (session) {
			await controller?.runSessionPrompt(
				session.id,
				"Rewrite the selection",
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSession />
						<Pen.AI.InlineSuggestionControls />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const suggestionIds = [
			...new Set(
				(controller?.getSuggestions() ?? []).map(
					(suggestion) => suggestion.id,
				),
			),
		];
		expect(suggestionIds.length).toBeGreaterThan(0);

		const editorContent = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(editorContent).not.toBeNull();
		Object.defineProperty(editorContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		const blockElement = document.createElement("div");
		blockElement.setAttribute("data-block-id", blockId);
		editorContent?.appendChild(blockElement);

		for (const [index, suggestionId] of suggestionIds.entries()) {
			const suggestionAnchor = document.createElement("span");
			suggestionAnchor.setAttribute("data-suggestion-id", suggestionId);
			suggestionAnchor.textContent = "change";
			Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					top: 220 + index * 20,
					left: 140,
					width: 80,
					height: 18,
					right: 220,
					bottom: 238 + index * 20,
					x: 140,
					y: 220 + index * 20,
					toJSON() {
						return this;
					},
				}),
			});
			blockElement.appendChild(suggestionAnchor);
		}

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		const rail = container.querySelector(
			'[data-pen-ai-inline-suggestion-control][data-placement="right-rail"]',
		) as HTMLDivElement | null;
		expect(rail).not.toBeNull();
		expect(rail?.style.left).toBe("524px");
		expect(
			rail?.querySelector("[data-pen-ai-inline-suggestion-accept]"),
		).toBeNull();
		expect(
			rail?.querySelector("[data-pen-ai-inline-suggestion-reject]"),
		).toBeNull();

		await act(async () => {
			root.unmount();
		});
		blockElement.remove();
		container.remove();
	});

	it("renders streamed tool activity and progress metadata", async () => {
		let pass = 0;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					allowedMutatingTools: ["test_search"],
					model: {
						async *stream() {
							pass += 1;
							if (pass === 1) {
								yield {
									type: "tool-call" as const,
									toolCallId: "tool-call-1",
									toolName: "test_search",
									input: { query: "plan" },
								};
							}
							yield { type: "done" as const };
						},
					},
				}),
				testStreamingToolExtension(),
			],
		});
		await editor.whenReady();
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.AI.Progress />
						<Pen.AI.ToolStream />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
			await controller?.runPrompt("search the document", {
				blockId: editor.firstBlock()!.id,
			});
		});
		await act(async () => {
			await waitForAttributeValue(
				() =>
					container
						.querySelector("[data-pen-ai-progress]")
						?.getAttribute("data-tool-output-count"),
				"2",
			);
		});

		const progress = container.querySelector("[data-pen-ai-progress]");
		const toolStream = container.querySelector("[data-pen-ai-tool-stream]");
		const toolCallOutput = toolStream?.querySelector(
			"[data-tool-call-output]",
		);

		expect(progress?.getAttribute("data-tool-output-count")).toBe("2");
		expect(progress?.getAttribute("data-last-stream-event")).toBe(
			"generation-finish",
		);
		expect(toolStream?.getAttribute("data-tool-call-count")).toBe("1");
		expect(toolStream?.getAttribute("data-running-tool-count")).toBe("0");
		expect(
			toolStream?.querySelector("[data-tool-call-name]")?.textContent,
		).toBe("test_search");
		expect(
			toolStream?.querySelector("[data-tool-call-status]")?.textContent,
		).toBe("complete");
		expect(
			toolStream?.querySelector("[data-tool-call-input]")?.textContent,
		).toContain('"query": "plan"');
		expect(toolCallOutput?.textContent).toContain("searching:plan");
		expect(toolCallOutput?.textContent).toContain('"matches": 2');

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});
