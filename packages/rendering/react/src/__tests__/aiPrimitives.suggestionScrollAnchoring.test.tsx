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
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import {
	Pen,
	useAIActions,
	useAISessions,
	useActiveAISession,
	useAIDebugLog,
} from "../index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createKeyDownEvent(
	key: string,
	options: KeyboardEventInit = {},
): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...options,
	});
}

function createDeferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

function withNavigatorPlatform<T>(platform: string, run: () => T): T {
	const descriptor = Object.getOwnPropertyDescriptor(navigator, "platform");
	Object.defineProperty(navigator, "platform", {
		configurable: true,
		value: platform,
	});
	try {
		return run();
	} finally {
		if (descriptor) {
			Object.defineProperty(navigator, "platform", descriptor);
		}
	}
}

async function waitForAttributeValue(
	readValue: () => string | null | undefined,
	expectedValue: string,
	maxTicks = 12,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (readValue() === expectedValue) {
			return;
		}
		await Promise.resolve();
	}
}

async function waitForCondition(
	check: () => boolean,
	maxTicks = 20,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (check()) {
			return;
		}
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

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

describe("@input/pen-react AI primitives: suggestion scroll anchoring", () => {
	it("does not auto-scroll the same inline suggestion while the viewport scrolls", async () => {
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

		await controller?.runPrompt("Rewrite the selection");

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSuggestionControls />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const suggestionId = controller?.getSuggestions()[0]?.id;
		expect(suggestionId).toBeTruthy();

		const editorContent = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(editorContent).not.toBeNull();
		Object.defineProperty(editorContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(editorContent, "clientHeight", {
			configurable: true,
			value: 800,
		});

		const scrollContainer =
			editorContent?.parentElement as HTMLElement | null;
		expect(scrollContainer).not.toBeNull();
		if (!scrollContainer) {
			throw new Error("Expected inline suggestion scroll container");
		}
		scrollContainer.style.overflowY = "auto";
		Object.defineProperty(scrollContainer, "clientHeight", {
			configurable: true,
			value: 220,
		});
		Object.defineProperty(scrollContainer, "scrollHeight", {
			configurable: true,
			value: 1000,
		});

		let scrollTopValue = 0;
		Object.defineProperty(scrollContainer, "scrollTop", {
			configurable: true,
			get: () => scrollTopValue,
			set: (value: number) => {
				scrollTopValue = value;
			},
		});
		Object.defineProperty(scrollContainer, "scrollTo", {
			configurable: true,
			value: ({ top }: { top?: number }) => {
				scrollTopValue = top ?? scrollTopValue;
			},
		});
		Object.defineProperty(scrollContainer, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				top: 0,
				left: 0,
				width: 800,
				height: 220,
				right: 800,
				bottom: 220,
				x: 0,
				y: 0,
				toJSON() {
					return this;
				},
			}),
		});

		const blockElement = document.createElement("div");
		blockElement.setAttribute("data-block-id", blockId);
		editorContent?.appendChild(blockElement);

		const suggestionAnchor = document.createElement("span");
		suggestionAnchor.setAttribute("data-suggestion-id", suggestionId!);
		suggestionAnchor.textContent = "change";
		Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
			configurable: true,
			value: () => {
				const top = 320 - scrollTopValue;
				const height = 18;
				const left = 140;
				const width = 80;
				return {
					top,
					left,
					width,
					height,
					right: left + width,
					bottom: top + height,
					x: left,
					y: top,
					toJSON() {
						return this;
					},
				};
			},
		});
		blockElement.appendChild(suggestionAnchor);

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-suggestion-control]"),
		).not.toBeNull();
		expect(scrollTopValue).toBeGreaterThan(0);
		const scrollTopAfterMount = scrollTopValue;

		await act(async () => {
			scrollTopValue = 260;
			window.dispatchEvent(new Event("scroll"));
			await Promise.resolve();
		});

		expect(scrollTopValue).toBe(260);
		expect(scrollTopValue).not.toBe(scrollTopAfterMount);

		await act(async () => {
			root.unmount();
		});
		suggestionAnchor.remove();
		blockElement.remove();
		container.remove();
		editor.destroy();
	});
});
