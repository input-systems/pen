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

describe("@input/pen-react AI primitives: custom floating inline controls", () => {
	it("supports custom floating inline suggestion controls built from primitives", async () => {
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

		await controller?.runPrompt("Rewrite the selection");

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSuggestionControls>
							<Pen.AI.InlineSuggestionFloatingSurface>
								<div data-pen-ai-inline-suggestion-nav="">
									<Pen.AI.InlineSuggestionPrevious />
									<Pen.AI.InlineSuggestionCount />
									<Pen.AI.InlineSuggestionNext />
								</div>
								<Pen.AI.InlineSuggestionReject />
								<Pen.AI.InlineSuggestionAccept />
							</Pen.AI.InlineSuggestionFloatingSurface>
						</Pen.AI.InlineSuggestionControls>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
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

		const suggestionRects = suggestionIds.map((_, index) => ({
			top: 180 + Math.floor(index / 3) * 24,
			left: 140 + (index % 3) * 88,
			width: 80,
			height: 18,
		}));
		const suggestionElements = suggestionIds.map((suggestionId, index) => {
			const suggestionAnchor = document.createElement("span");
			suggestionAnchor.setAttribute("data-suggestion-id", suggestionId);
			suggestionAnchor.textContent = "change";
			Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					top: suggestionRects[index]!.top,
					left: suggestionRects[index]!.left,
					width: suggestionRects[index]!.width,
					height: suggestionRects[index]!.height,
					right:
						suggestionRects[index]!.left +
						suggestionRects[index]!.width,
					bottom:
						suggestionRects[index]!.top +
						suggestionRects[index]!.height,
					x: suggestionRects[index]!.left,
					y: suggestionRects[index]!.top,
					toJSON() {
						return this;
					},
				}),
			});
			if (index > 0) {
				blockElement.appendChild(document.createTextNode(" "));
			}
			blockElement.appendChild(suggestionAnchor);
			return suggestionAnchor;
		});

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		const floatingControl = container.querySelector(
			"[data-pen-ai-inline-suggestion-control]",
		) as HTMLDivElement | null;
		expect(floatingControl).not.toBeNull();
		expect(
			floatingControl?.querySelector(
				"[data-pen-ai-inline-suggestion-count]",
			)?.textContent,
		).toBe("1 of 1");

		const suggestionCountBeforeAccept =
			controller?.getSuggestions().length ?? 0;
		const keepButton = floatingControl?.querySelector(
			"[data-pen-ai-inline-suggestion-accept]",
		) as HTMLButtonElement | null;
		expect(keepButton).not.toBeNull();

		await act(() => {
			keepButton?.click();
		});

		await act(async () => {
			await Promise.resolve();
		});

		expect(controller?.getSuggestions().length ?? 0).toBeLessThan(
			suggestionCountBeforeAccept,
		);

		await act(async () => {
			root.unmount();
		});
		for (const suggestionElement of suggestionElements) {
			suggestionElement.remove();
		}
		blockElement.remove();
		container.remove();
		editor.destroy();
	});
});
