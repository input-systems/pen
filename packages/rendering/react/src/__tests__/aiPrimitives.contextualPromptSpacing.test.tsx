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

describe("@input/pen-react AI primitives: contextual prompt spacing", () => {
	it("closes the inline prompt when resolving a turn from the prompt buttons", async () => {
		async function runResolutionCase(resolution: "accept" | "reject") {
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
			editor.selectTextRange(
				{ blockId, offset: 6 },
				{ blockId, offset: 11 },
			);

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
				await Promise.resolve();
			});

			const controller = getAIController(editor);
			await act(async () => {
				document.dispatchEvent(
					createKeyDownEvent("j", { ctrlKey: true }),
				);
				await Promise.resolve();
				const activeSessionId =
					controller?.getState().activeSessionId ?? null;
				if (activeSessionId) {
					await controller?.runSessionPrompt(
						activeSessionId,
						"Rewrite this",
						{
							target: "selection",
						},
					);
				}
				for (let tick = 0; tick < 4; tick += 1) {
					await Promise.resolve();
				}
			});

			const selector =
				resolution === "accept"
					? "[data-pen-ai-inline-session-turn-accept]"
					: "[data-pen-ai-inline-session-turn-reject]";
			const resolutionButton = container.querySelector(
				selector,
			) as HTMLButtonElement | null;
			expect(resolutionButton).not.toBeNull();

			await act(async () => {
				resolutionButton?.click();
				for (let tick = 0; tick < 4; tick += 1) {
					await Promise.resolve();
				}
			});

			expect(
				container.querySelector("[data-pen-ai-inline-session-input]"),
			).toBeNull();
			expect(
				getAIController(editor)?.getState().sessions[0]
					?.contextualPrompt?.composer.isOpen,
			).toBe(false);

			await act(async () => {
				root.unmount();
			});
			restoreSelectionRect();
			container.remove();
		}

		await runResolutionCase("accept");
		await runResolutionCase("reject");
	});

	it("reserves document space for inserted contextual prompts", async () => {
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
		editor.selectTextRange({ blockId, offset: 0 }, { blockId, offset: 5 });

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.SelectionTrigger shortcut="ctrl+j">
							AI
						</Pen.AI.SelectionTrigger>
						<Pen.AI.ContextualPromptSurface mode="inserted">
							<div>
								<Pen.AI.ContextualPromptComposer />
							</div>
						</Pen.AI.ContextualPromptSurface>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		const blockElement = container.querySelector(
			`[data-block-id="${blockId}"]`,
		) as HTMLElement | null;
		expect(blockElement).not.toBeNull();
		Object.defineProperty(blockElement, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				top: 120,
				left: 120,
				width: 320,
				height: 24,
				right: 440,
				bottom: 144,
				x: 120,
				y: 120,
				toJSON() {
					return this;
				},
			}),
		});

		await act(async () => {
			document.dispatchEvent(createKeyDownEvent("j", { ctrlKey: true }));
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(blockElement?.style.marginTop).not.toBe("");
		const insertedPrompt = container.querySelector(
			'[data-pen-ai-inline-session][data-mode="inserted"]',
		) as HTMLElement | null;
		expect(insertedPrompt).not.toBeNull();
		expect(
			container.querySelector(
				"[data-pen-ai-contextual-prompt-selection-overlay]",
			),
		).toBeNull();
		expect(
			insertedPrompt?.style.getPropertyValue(
				"--pen-ai-contextual-prompt-top",
			),
		).not.toBe("0px");

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("reserves document space for inserted contextual prompts opened from a collapsed caret", async () => {
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
		editor.selectTextRange({ blockId, offset: 5 }, { blockId, offset: 5 });

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.ContextualPromptSurface mode="inserted">
							<div>
								<Pen.AI.ContextualPromptComposer />
							</div>
						</Pen.AI.ContextualPromptSurface>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		const blockElement = container.querySelector(
			`[data-block-id="${blockId}"]`,
		) as HTMLElement | null;
		expect(blockElement).not.toBeNull();
		Object.defineProperty(blockElement, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				top: 120,
				left: 120,
				width: 320,
				height: 24,
				right: 440,
				bottom: 144,
				x: 120,
				y: 120,
				toJSON() {
					return this;
				},
			}),
		});

		await act(async () => {
			const session = getAIController(editor)?.openContextualPrompt({
				surface: "inline-edit",
				target: "auto",
			});
			expect(session?.contextualPrompt?.anchor).toMatchObject({
				kind: "block",
				focusBlockId: blockId,
			});
			await waitForCondition(() => blockElement?.style.marginTop !== "");
		});

		const insertedPrompt = container.querySelector(
			'[data-pen-ai-inline-session][data-mode="inserted"]',
		) as HTMLElement | null;
		expect(insertedPrompt).not.toBeNull();
		expect(insertedPrompt?.dataset.anchorBlockId).toBe(blockId);
		expect(blockElement?.style.marginTop).not.toBe("");
		expect(
			insertedPrompt?.style.getPropertyValue(
				"--pen-ai-contextual-prompt-top",
			),
		).not.toBe("0px");

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});
});
