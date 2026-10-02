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
import { mockSelectionToolbarRect } from "./utils/selectionToolbarRectMock";

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

describe("@input/pen-react AI primitives: prompt focus retention", () => {
	it("keeps the inline prompt focused after submitting a prompt", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 180,
			width: 80,
			height: 20,
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
		const controller = getAIController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const inlineSessionInput = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		const inlineSessionForm = container.querySelector(
			"[data-pen-ai-inline-session-form]",
		) as HTMLFormElement | null;
		expect(inlineSessionInput).not.toBeNull();
		expect(inlineSessionForm).not.toBeNull();

		await act(async () => {
			inlineSessionInput?.focus();
			controller.updateContextualPromptDraft(session!.id, "Rewrite this");
			for (let tick = 0; tick < 2; tick += 1) {
				await Promise.resolve();
			}
		});

		await act(async () => {
			inlineSessionForm?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			for (let tick = 0; tick < 8; tick += 1) {
				await Promise.resolve();
			}
		});

		const inlineSessionInputAfterSubmit = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		expect(inlineSessionInputAfterSubmit).not.toBeNull();
		expect(document.activeElement).toBe(inlineSessionInputAfterSubmit);

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("keeps the inline session open after a second submitted edit", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 180,
			width: 80,
			height: 20,
		});
		let streamCount = 0;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream() {
							streamCount += 1;
							yield {
								type: "text-delta" as const,
								delta: streamCount === 1 ? "planet" : "galaxy",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
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
		const controller = getAIController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSession />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const inlineSessionInput = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		const inlineSessionForm = container.querySelector(
			"[data-pen-ai-inline-session-form]",
		) as HTMLFormElement | null;
		expect(inlineSessionInput).not.toBeNull();
		expect(inlineSessionForm).not.toBeNull();

		await act(async () => {
			inlineSessionInput?.focus();
			controller.updateContextualPromptDraft(session!.id, "Rewrite this");
			for (let tick = 0; tick < 2; tick += 1) {
				await Promise.resolve();
			}
		});

		await act(async () => {
			inlineSessionForm?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			for (let tick = 0; tick < 8; tick += 1) {
				await Promise.resolve();
			}
		});

		const inlineSessionInputAfterFirstSubmit = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		expect(inlineSessionInputAfterFirstSubmit).not.toBeNull();

		await act(async () => {
			controller.updateContextualPromptDraft(
				session!.id,
				"Make it more whimsical",
			);
			for (let tick = 0; tick < 2; tick += 1) {
				await Promise.resolve();
			}
		});

		await act(async () => {
			inlineSessionForm?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			for (let tick = 0; tick < 6; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(
			container.querySelector("[data-pen-ai-inline-session-input]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});
});
