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
import { Pen, useAIActions, useAISessions, useActiveAISession } from "../index";
import {
	createDeferred,
	waitForCondition,
} from "./utils/aiPrimitivesTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react AI primitives: bottom-chat preview and session hooks", () => {
	it("previews bottom-chat markdown as text while streaming, then renders schema blocks", async () => {
		const releaseFinalDelta = createDeferred();
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
							yield {
								type: "text-delta" as const,
								delta: "# Story\n\nOnce upon ",
							};
							await releaseFinalDelta.promise;
							yield {
								type: "text-delta" as const,
								delta: "a time",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		let session: ReturnType<
			NonNullable<typeof controller>["startSession"]
		> | null = null;
		let generationPromise: Promise<unknown> | null = null;

		await act(async () => {
			session = controller!.startSession({
				surface: "bottom-chat",
				target: "document",
			});
			generationPromise = controller!.runSessionPrompt(
				session!.id,
				"Write a short story",
				{ target: "document" },
			);
			await waitForCondition(() =>
				(container.textContent ?? "")
					.replace(/\u200B/g, "")
					.includes("Once upon"),
			);
		});

		// RS2: while the call is open the words show on the review surface and
		// the structure does not, because the structure is not final yet. The
		// heading arrives when the edit stages.
		expect(
			container.querySelector("h1[data-block-type='heading']"),
		).toBeNull();
		expect((container.textContent ?? "").replace(/\u200B/g, "")).toContain(
			"Once upon",
		);

		await act(async () => {
			releaseFinalDelta.resolve();
			await generationPromise;
		});

		await act(async () => {
			await waitForCondition(
				() =>
					container
						.querySelector("h1[data-block-type='heading']")
						?.textContent?.includes("Story") === true,
			);
		});
		expect(
			container.querySelector("h1[data-block-type='heading']")
				?.textContent,
		).toContain("Story");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("exposes AI sessions through React hooks", async () => {
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

		function SessionProbe() {
			const sessions = useAISessions(editor);
			const activeSession = useActiveAISession(editor);
			const actions = useAIActions(editor);

			return (
				<div
					data-session-count={String(sessions.length)}
					data-active-session-id={activeSession?.id ?? undefined}
					data-session-action-ready={
						typeof actions.startSession === "function"
							? ""
							: undefined
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
					<SessionProbe />
				</Pen.Editor.Root>,
			);
		});

		let sessionId = "";
		await act(async () => {
			const session = controller?.startSession({
				surface: "inline-edit",
				target: "selection",
			});
			if (session) {
				sessionId = session.id;
				await controller?.runSessionPrompt(
					session.id,
					"Rewrite the selection",
				);
			}
		});

		await act(async () => {
			const controllerAny = controller as any;
			controllerAny?._recordSessionCommitMetrics(sessionId, {
				attempted: true,
				succeeded: true,
				executionPath: "selection-replacement",
			});
			await Promise.resolve();
		});

		const probe = container.querySelector("[data-session-count]");
		expect(probe?.getAttribute("data-session-count")).toBe("1");
		expect(probe?.getAttribute("data-active-session-id")).toBeTruthy();
		expect(probe?.getAttribute("data-session-action-ready")).toBe("");

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});
