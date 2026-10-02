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

describe("@input/pen-react AI primitives: control scoping to the editor root", () => {
	it("scopes inline suggestion controls to the active editor root", async () => {
		const secondaryEditor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
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
				<>
					<Pen.Editor.Root editor={secondaryEditor}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>
					<Pen.Editor.Root editor={editor}>
						<Pen.AI.Root editor={editor}>
							<Pen.Editor.Content />
							<Pen.AI.InlineSuggestionControls>
								<Pen.AI.InlineSuggestionFloatingSurface>
									<div data-pen-ai-inline-suggestion-nav="">
										<Pen.AI.InlineSuggestionPrevious />
										<Pen.AI.InlineSuggestionCount />
										<Pen.AI.InlineSuggestionNext />
									</div>
									<Pen.AI.InlineSuggestionReject />
									<Pen.AI.InlineSuggestionAccept />
								</Pen.AI.InlineSuggestionFloatingSurface>
							</Pen.AI.InlineSuggestionControls>
						</Pen.AI.Root>
					</Pen.Editor.Root>
				</>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const primaryContent = container.querySelector(
			`[data-pen-view-id="${editor.internals.viewId}"] [data-pen-editor-content]`,
		) as HTMLElement | null;
		const secondaryContent = container.querySelector(
			`[data-pen-view-id="${secondaryEditor.internals.viewId}"] [data-pen-editor-content]`,
		) as HTMLElement | null;
		expect(primaryContent).not.toBeNull();
		expect(secondaryContent).not.toBeNull();

		Object.defineProperty(primaryContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(primaryContent, "clientHeight", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(secondaryContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(secondaryContent, "clientHeight", {
			configurable: true,
			value: 800,
		});

		const suggestionId = controller?.getSuggestions()[0]?.id;
		expect(suggestionId).toBeTruthy();

		const rogueBlock = document.createElement("div");
		rogueBlock.setAttribute("data-block-id", "secondary-block");
		secondaryContent?.appendChild(rogueBlock);
		const rogueAnchor = document.createElement("span");
		rogueAnchor.setAttribute("data-suggestion-id", suggestionId!);
		rogueAnchor.textContent = "rogue";
		Object.defineProperty(rogueAnchor, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				top: 24,
				left: 24,
				width: 48,
				height: 18,
				right: 72,
				bottom: 42,
				x: 24,
				y: 24,
				toJSON() {
					return this;
				},
			}),
		});
		rogueBlock.appendChild(rogueAnchor);

		const primaryBlock = document.createElement("div");
		primaryBlock.setAttribute("data-block-id", blockId);
		primaryContent?.appendChild(primaryBlock);
		const primaryAnchor = document.createElement("span");
		primaryAnchor.setAttribute("data-suggestion-id", suggestionId!);
		primaryAnchor.textContent = "real";
		Object.defineProperty(primaryAnchor, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				top: 180,
				left: 140,
				width: 80,
				height: 18,
				right: 220,
				bottom: 198,
				x: 140,
				y: 180,
				toJSON() {
					return this;
				},
			}),
		});
		primaryBlock.appendChild(primaryAnchor);

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		const floatingControl = container.querySelector(
			"[data-pen-ai-inline-suggestion-control]",
		) as HTMLDivElement | null;
		expect(floatingControl).not.toBeNull();
		expect(primaryContent?.contains(floatingControl ?? null)).toBe(true);
		expect(secondaryContent?.contains(floatingControl ?? null)).toBe(false);

		await act(async () => {
			root.unmount();
		});
		rogueAnchor.remove();
		rogueBlock.remove();
		primaryAnchor.remove();
		primaryBlock.remove();
		container.remove();
		secondaryEditor.destroy();
		editor.destroy();
	});
});
