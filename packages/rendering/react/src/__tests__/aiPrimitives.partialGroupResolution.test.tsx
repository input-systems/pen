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

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react AI primitives: partial suggestion group resolution", () => {
	it("keeps inline suggestion controls visible when only part of a group resolves", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension(),
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

		const suggestionIds = ["partial-success-a", "partial-success-b"];
		(controller as unknown as { _suggestions: unknown })._suggestions =
			suggestionIds.map((suggestionId) => ({
				id: suggestionId,
				kind: "text" as const,
				action: "insert" as const,
				author: "AI",
				authorType: "ai" as const,
				createdAt: Date.now(),
				blockId,
				offset: 0,
				length: 5,
			}));

		const originalAcceptSuggestion =
			controller!.acceptSuggestion.bind(controller);
		controller!.acceptSuggestion = (suggestionId: string) =>
			suggestionId === suggestionIds[0];

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
					top: 180,
					left: 140 + index * 88,
					width: 80,
					height: 18,
					right: 220 + index * 88,
					bottom: 198,
					x: 140 + index * 88,
					y: 180,
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
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-suggestion-control]"),
		).not.toBeNull();

		controller!.acceptSuggestion = originalAcceptSuggestion;
		await act(async () => {
			root.unmount();
		});
		blockElement.remove();
		container.remove();
	});
});
