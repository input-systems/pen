// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@input/pen-core";
import { aiExtension, getAIController } from "@input/pen-ai";
import { undoExtension } from "@input/pen-undo";
import { deltaStreamExtension } from "@input/pen-ai/stream";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { Pen } from "../index";
import { createKeyDownEvent } from "./utils/aiPrimitivesTestHelpers";
import { mockSelectionToolbarRect } from "./utils/selectionToolbarRectMock";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const INPUT_SELECTOR = "[data-pen-ai-inline-session-input]";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function flushTicks(count: number): Promise<void> {
	for (let tick = 0; tick < count; tick += 1) {
		await Promise.resolve();
	}
}

/**
 * Opens the contextual prompt while `ai-trigger` holds focus, the way a host
 * "Ask AI" control does, and returns once the prompt input has taken focus.
 */
async function openPromptFromTrigger() {
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
						yield { type: "text-delta" as const, delta: "planet" };
						yield { type: "done" as const };
					},
				},
			}),
		],
	});
	const blockId = editor.firstBlock()!.id;
	editor.apply([{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello world" }], {
		origin: "system",
	});
	editor.selectTextRange({ blockId, offset: 6 }, { blockId, offset: 11 });
	const controller = getAIController(editor)!;

	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			<Pen.Editor.Root editor={editor}>
				<Pen.AI.Root editor={editor}>
					<button type="button" data-testid="ai-trigger">
						Ask AI
					</button>
					<button type="button" data-testid="other-control">
						Other
					</button>
					<Pen.Editor.Content />
					<Pen.AI.InlineSession />
				</Pen.AI.Root>
			</Pen.Editor.Root>,
		);
		await flushTicks(4);
	});

	const trigger = container.querySelector<HTMLElement>(
		'[data-testid="ai-trigger"]',
	)!;
	await act(async () => {
		trigger.focus();
	});
	expect(document.activeElement).toBe(trigger);

	let sessionId = "";
	await act(async () => {
		sessionId =
			controller.openContextualPrompt({
				surface: "inline-edit",
				target: "selection",
			})?.id ?? "";
		await flushTicks(4);
	});
	expect(sessionId).not.toBe("");
	const input = container.querySelector<HTMLTextAreaElement>(INPUT_SELECTOR);
	expect(input).not.toBeNull();
	expect(document.activeElement).toBe(input);

	cleanups.push(async () => {
		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
		editor.destroy();
	});

	return { container, controller, sessionId, trigger, input: input! };
}

async function runPrompt(
	view: Awaited<ReturnType<typeof openPromptFromTrigger>>,
): Promise<void> {
	await act(async () => {
		await view.controller.runSessionPrompt(view.sessionId, "Rewrite this", {
			target: "selection",
		});
		await flushTicks(4);
	});
}

describe("@input/pen-react AI contextual prompt AX3 focus return", () => {
	it("AX3: the contextual prompt returns focus on accept, reject, dismiss and Escape", async () => {
		const paths: Array<{
			name: string;
			resolve: (
				view: Awaited<ReturnType<typeof openPromptFromTrigger>>,
			) => Promise<void>;
		}> = [
			...(["accept", "reject"] as const).map((name) => ({
				name,
				resolve: async (view: Awaited<ReturnType<typeof openPromptFromTrigger>>) => {
					await runPrompt(view);
					const control = view.container.querySelector<HTMLElement>(
						`[data-pen-ai-inline-session-turn-${name}]`,
					);
					expect(control).not.toBeNull();
					await act(async () => {
						control!.click();
						await flushTicks(4);
					});
				},
			})),
			{
				name: "dismiss (Escape in the prompt)",
				resolve: async (view) => {
					await act(async () => {
						view.input.dispatchEvent(createKeyDownEvent("Escape"));
						await flushTicks(4);
					});
				},
			},
			{
				name: "Escape from outside the prompt",
				resolve: async (view) => {
					const other = view.container.querySelector<HTMLElement>(
						'[data-testid="other-control"]',
					)!;
					await act(async () => {
						other.focus();
					});
					await act(async () => {
						other.dispatchEvent(createKeyDownEvent("Escape"));
						await flushTicks(4);
					});
				},
			},
		];

		for (const path of paths) {
			const view = await openPromptFromTrigger();
			await path.resolve(view);
			expect(
				view.container.querySelector(INPUT_SELECTOR),
				path.name,
			).toBeNull();
			expect(document.activeElement, path.name).toBe(view.trigger);
			await cleanups.pop()?.();
		}
	});
});
