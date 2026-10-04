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

describe("@input/pen-react AI primitives: affected-range decoration", () => {
	it("submits a new inline selection edit after keeping bottom-chat changes", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 160,
			width: 120,
			height: 18,
		});
		let pass = 0;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
						selectionRewrite: "text",
					},
					model: {
						async *stream() {
							pass += 1;
							yield {
								type: "text-delta" as const,
								delta: pass === 1 ? "Hello world" : "planet",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const controller = getAIController(editor);

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

		await act(async () => {
			const bottomChatSession = controller?.startSession({
				surface: "bottom-chat",
				target: "document",
			});
			if (bottomChatSession) {
				await controller?.runSessionPrompt(
					bottomChatSession.id,
					"Write something in the document",
					{ target: "document" },
				);
				const keptTurnId = controller
					?.getSessions()
					.find((session) => session.id === bottomChatSession.id)
					?.turns[0]?.id;
				if (keptTurnId) {
					controller?.acceptSessionTurn(
						bottomChatSession.id,
						keptTurnId,
					);
				}
			}
			for (let tick = 0; tick < 6; tick += 1) {
				await Promise.resolve();
			}
		});

		const blockId = editor.firstBlock()!.id;
		await act(async () => {
			editor.selectTextRange(
				{ blockId, offset: 6 },
				{ blockId, offset: 11 },
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const trigger = container.querySelector(
			"[data-pen-ai-selection-trigger]",
		) as HTMLButtonElement | null;
		expect(trigger).not.toBeNull();

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

		const activeSession = controller?.getActiveSession() ?? null;
		expect(activeSession?.surface).toBe("inline-edit");
		expect(activeSession?.turns).toHaveLength(1);
		expect(activeSession?.turns[0]?.status).toBe("review");

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("renders a durable affected-range decoration while the inline session is visible", async () => {
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
			await Promise.resolve();
		});

		await act(async () => {
			controller?.openContextualPrompt({
				surface: "inline-edit",
				target: "selection",
			});
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const decorations = editor.getDecorations().decorations;
		expect(
			decorations.some(
				(decoration) =>
					decoration.type !== "app" &&
					decoration.attributes["data-ai-affected-range"] === "",
			),
		).toBe(true);

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});
});
