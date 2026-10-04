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
import {
	createKeyDownEvent,
	withNavigatorPlatform,
} from "./utils/aiPrimitivesTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react AI primitives: focus when history reopens a prompt", () => {
	it("does not autofocus the inline session input when history reopens it", async () => {
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
		const controller = getAIController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();
		const originalFocus = HTMLTextAreaElement.prototype.focus;
		let focusCalls = 0;
		HTMLTextAreaElement.prototype.focus = function focusPatched(
			this: HTMLTextAreaElement,
			options?: FocusOptions,
		) {
			focusCalls += 1;
			return originalFocus.call(this, options);
		};
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		try {
			controller.suspendInlineSession(session!.id);
			editor.internals.emit("historyApplied", {
				kind: "undo",
				selection: editor.selection,
				focusBlockId: blockId,
				requestId: 1,
			});
			expect(
				controller.getState().sessions[0]?.contextualPrompt?.composer
					.openReason,
			).toBe("history");

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

			const reopenedTextarea = container.querySelector(
				"[data-pen-ai-inline-session-input]",
			) as HTMLTextAreaElement | null;
			expect(reopenedTextarea).not.toBeNull();
			expect(focusCalls).toBe(0);

			await act(async () => {
				root.unmount();
			});
		} finally {
			HTMLTextAreaElement.prototype.focus = originalFocus;
		}
		restoreSelectionRect();
		container.remove();
	});

	it("reopens the inline prompt on the first undo shortcut after accepting a turn", async () => {
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
						<Pen.AI.InlineSession />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		await act(async () => {
			await controller.runSessionPrompt(
				session!.id,
				"Rewrite the selection",
			);
			const reviewTurnId = controller.getActiveSession()?.turns[0]?.id;
			if (reviewTurnId) {
				controller.acceptSessionTurn(session!.id, reviewTurnId);
			}
			for (let tick = 0; tick < 6; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(
			container.querySelector("[data-pen-ai-inline-session-input]"),
		).toBeNull();

		await act(async () => {
			withNavigatorPlatform("MacIntel", () => {
				document.dispatchEvent(
					createKeyDownEvent("z", { metaKey: true }),
				);
			});
			for (let tick = 0; tick < 6; tick += 1) {
				await Promise.resolve();
			}
		});

		const reopenedTextarea = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		expect(reopenedTextarea).not.toBeNull();
		expect(
			controller.getActiveSession()?.contextualPrompt?.composer
				.draftPrompt,
		).toBe("Rewrite the selection");

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});
});
