// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@input/pen-core";
import { aiExtension, getAIController } from "@input/pen-ai";
import { undoExtension } from "@input/pen-undo";
import { deltaStreamExtension } from "@input/pen-ai/stream";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { Pen } from "../index";
import { mockSelectionToolbarRect } from "./utils/selectionToolbarRectMock";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react AI primitives: inline session from the selection toolbar", () => {
	it("renders an inline AI session from the selection toolbar", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 160,
			width: 120,
			height: 18,
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

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

		const trigger = container.querySelector(
			"[data-pen-ai-selection-trigger]",
		) as HTMLButtonElement | null;
		expect(trigger).toBeTruthy();
		expect(trigger?.disabled).toBe(false);
		expect(
			container.querySelector("[data-pen-selection-toolbar-content]"),
		).not.toBeNull();

		await act(async () => {
			trigger?.dispatchEvent(
				new Event("pointerdown", {
					bubbles: true,
					cancelable: true,
				}),
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const inlineSessionInput = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		expect(inlineSessionInput).toBeTruthy();
		expect(document.activeElement).toBe(inlineSessionInput);
		expect(
			container.querySelector("[data-pen-selection-toolbar-content]"),
		).toBeNull();
		expect(
			container.querySelector(
				"[data-pen-ai-contextual-prompt-selection-overlay]",
			),
		).not.toBeNull();
		expect(
			container.querySelector(
				"[data-pen-ai-inline-session-turn-actions]",
			),
		).toBeNull();

		await act(async () => {
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
			for (let tick = 0; tick < 6; tick += 1) {
				await Promise.resolve();
			}
		});

		const sessionId = controller?.getState().activeSessionId ?? null;
		const sessionTurns = controller?.getState().sessions[0]?.turns ?? [];
		expect(sessionTurns).toHaveLength(1);
		expect(
			container.querySelector(
				"[data-pen-ai-inline-session-turn-actions]",
			),
		).not.toBeNull();
		expect(
			container.querySelector(
				"[data-pen-ai-contextual-prompt-selection-overlay]",
			),
		).toBeNull();

		await act(async () => {
			if (sessionId && sessionTurns[0]) {
				controller?.acceptSessionTurn(sessionId, sessionTurns[0].id);
			}
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(editor.getBlock(blockId)?.textContent({ resolved: true })).toBe(
			"Hello planet",
		);

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});
});
