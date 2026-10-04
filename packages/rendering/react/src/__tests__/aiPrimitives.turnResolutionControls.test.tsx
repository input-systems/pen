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
import { createKeyDownEvent } from "./utils/aiPrimitivesTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react AI primitives: turn resolution controls", () => {
	it("rejects and closes the inline session on Escape even when unfocused", async () => {
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

		await act(async () => {
			document.dispatchEvent(createKeyDownEvent("j", { ctrlKey: true }));
			await Promise.resolve();
		});

		const textarea = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		expect(textarea).not.toBeNull();

		await act(async () => {
			(document.body as HTMLElement).focus?.();
			document.dispatchEvent(createKeyDownEvent("Escape"));
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(
			getAIController(editor)?.getState().sessions[0]?.contextualPrompt
				?.composer.isOpen,
		).toBe(false);

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("shows Accept and Reject on the latest inline prompt turn after submission", async () => {
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

		await act(async () => {
			document.dispatchEvent(createKeyDownEvent("j", { ctrlKey: true }));
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-accept]"),
		).toBeNull();
		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-reject]"),
		).toBeNull();

		const controller = getAIController(editor);
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
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-accept]"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-reject]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});
});
