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
import { createDeferred } from "./utils/aiPrimitivesTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react AI primitives: keep cancels a streaming suggestion", () => {
	it("cancels a streaming inline suggestion when keep is clicked", async () => {
		const abortObserved = createDeferred();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream(options: { signal?: AbortSignal }) {
							yield {
								type: "text-delta" as const,
								delta: "planet",
							};
							await new Promise<void>((resolve) => {
								if (options.signal?.aborted) {
									abortObserved.resolve();
									resolve();
									return;
								}
								options.signal?.addEventListener(
									"abort",
									() => {
										abortObserved.resolve();
										resolve();
									},
									{ once: true },
								);
							});
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSuggestionControls />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		let generationPromise: Promise<unknown> | null = null;
		await act(async () => {
			generationPromise =
				controller?.runPrompt("Rewrite the selection") ?? null;
			await new Promise((resolve) => setTimeout(resolve, 120));
		});

		const suggestionIds = [
			...new Set(
				(controller?.getSuggestions() ?? []).map(
					(suggestion) => suggestion.id,
				),
			),
		];
		expect(suggestionIds.length).toBeGreaterThan(0);

		const editorContent = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(editorContent).not.toBeNull();
		Object.defineProperty(editorContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(editorContent, "clientHeight", {
			configurable: true,
			value: 800,
		});

		const blockElement = document.createElement("div");
		blockElement.setAttribute("data-block-id", blockId);
		editorContent?.appendChild(blockElement);

		for (const [index, suggestionId] of suggestionIds.entries()) {
			const suggestionAnchor = document.createElement("span");
			suggestionAnchor.setAttribute("data-suggestion-id", suggestionId);
			suggestionAnchor.textContent = "change";
			Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					top: 180 + Math.floor(index / 3) * 24,
					left: 140 + (index % 3) * 88,
					width: 80,
					height: 18,
					right: 220 + (index % 3) * 88,
					bottom: 198 + Math.floor(index / 3) * 24,
					x: 140 + (index % 3) * 88,
					y: 180 + Math.floor(index / 3) * 24,
					toJSON() {
						return this;
					},
				}),
			});
			if (index > 0) {
				blockElement.appendChild(document.createTextNode(" "));
			}
			blockElement.appendChild(suggestionAnchor);
		}

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		const keepButton = container.querySelector(
			"[data-pen-ai-inline-suggestion-accept]",
		) as HTMLButtonElement | null;
		expect(keepButton).not.toBeNull();

		await act(async () => {
			keepButton?.click();
			await abortObserved.promise;
			await generationPromise;
		});

		expect(controller?.getState().status).toBe("idle");
		expect(controller?.getState().activeGeneration?.status).toBe(
			"cancelled",
		);

		await act(async () => {
			root.unmount();
		});
		blockElement.remove();
		container.remove();
		editor.destroy();
	});
});
