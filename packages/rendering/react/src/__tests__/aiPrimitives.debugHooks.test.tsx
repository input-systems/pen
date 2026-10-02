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

describe("@input/pen-react AI primitives: debug logs and commit metrics", () => {
	it("exposes AI debug logs through a React hook", async () => {
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

		function DebugProbe() {
			const debugLog = useAIDebugLog(editor);

			return (
				<div
					data-status={debugLog.status}
					data-entry-count={String(debugLog.entries.length)}
					data-active-generation-id={
						debugLog.activeGenerationId ?? undefined
					}
					data-aggregate-commit-attempt-count={String(
						debugLog.aggregateCommit.attemptCount,
					)}
					data-aggregate-commit-selection-replacement-count={String(
						debugLog.aggregateCommit.selectionReplacementCount,
					)}
					data-commit-attempt-count={
						debugLog.activeSessionCommit
							? String(
									debugLog.activeSessionCommit
										.attemptCount,
								)
							: undefined
					}
					data-commit-selection-replacement-count={
						debugLog.activeSessionCommit
							? String(
									debugLog.activeSessionCommit
										.selectionReplacementCount,
								)
							: undefined
					}
					data-commit-scoped-count={
						debugLog.activeSessionCommit
							? String(
									debugLog.activeSessionCommit
										.scopedReplacementCount,
								)
							: undefined
					}
					data-commit-plain-count={
						debugLog.activeSessionCommit
							? String(
									debugLog.activeSessionCommit
										.plainMarkdownCount,
								)
							: undefined
					}
					data-commit-failed-count={
						debugLog.activeSessionCommit
							? String(
									debugLog.activeSessionCommit.failedCount,
								)
							: undefined
					}
					data-last-entry-label={
						debugLog.entries[debugLog.entries.length - 1]?.label ??
						undefined
					}
				/>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<DebugProbe />
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
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
		});

		const probe = container.querySelector("[data-entry-count]");
		expect(Number(probe?.getAttribute("data-entry-count"))).toBeGreaterThan(
			0,
		);
		expect(probe?.getAttribute("data-active-generation-id")).toBeTruthy();
		expect(
			probe?.getAttribute("data-aggregate-commit-attempt-count"),
		).toBe("1");
		expect(
			probe?.getAttribute("data-aggregate-commit-selection-replacement-count"),
		).toBe("1");
		expect(probe?.getAttribute("data-commit-attempt-count")).toBe("1");
		expect(probe?.getAttribute("data-commit-selection-replacement-count")).toBe("1");
		expect(probe?.getAttribute("data-commit-scoped-count")).toBe("0");
		expect(probe?.getAttribute("data-commit-plain-count")).toBe("0");
		expect(probe?.getAttribute("data-commit-failed-count")).toBe("0");
		expect(probe?.getAttribute("data-last-entry-label")).toBe(
			"Generation finished",
		);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("reads commit metrics for a requested session in the debug hook", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({}),
			],
		});
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		function DebugProbe(props: { sessionId: string }) {
			const debugLog = useAIDebugLog(editor, {
				sessionId: props.sessionId,
			});

			return (
				<div
					data-commit-session-id={
						debugLog.commitSessionId ?? undefined
					}
					data-aggregate-commit-attempt-count={String(
						debugLog.aggregateCommit.attemptCount,
					)}
					data-aggregate-commit-selection-replacement-count={String(
						debugLog.aggregateCommit.selectionReplacementCount,
					)}
					data-commit-attempt-count={
						debugLog.activeSessionCommit
							? String(
									debugLog.activeSessionCommit
										.attemptCount,
								)
							: undefined
					}
					data-commit-selection-replacement-count={
						debugLog.activeSessionCommit
							? String(
									debugLog.activeSessionCommit
										.selectionReplacementCount,
								)
							: undefined
					}
				/>
			);
		}

		const bottomChatSession = controller!.startSession({
			surface: "bottom-chat",
			target: "document",
		});
		const inlineSession = controller!.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		expect(controller!.getState().activeSessionId).toBe(inlineSession.id);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			const controllerAny = controller as any;
			controllerAny?._recordSessionCommitMetrics(
				bottomChatSession.id,
				{
					attempted: true,
					succeeded: true,
					executionPath: "selection-replacement",
				},
			);
			controllerAny?._recordSessionCommitMetrics(
				bottomChatSession.id,
				{
					attempted: true,
					succeeded: true,
					executionPath: "scoped-replacement",
				},
			);
			root.render(
				<Pen.Editor.Root editor={editor}>
					<DebugProbe sessionId={bottomChatSession.id} />
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		const probe = container.querySelector(
			"[data-commit-session-id]",
		) as HTMLElement | null;
		expect(probe?.getAttribute("data-commit-session-id")).toBe(
			bottomChatSession.id,
		);
		expect(
			probe?.getAttribute("data-aggregate-commit-attempt-count"),
		).toBe("2");
		expect(
			probe?.getAttribute("data-aggregate-commit-selection-replacement-count"),
		).toBe("1");
		expect(probe?.getAttribute("data-commit-attempt-count")).toBe("2");
		expect(probe?.getAttribute("data-commit-selection-replacement-count")).toBe("1");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
