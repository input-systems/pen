// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import {
	createEditor,
	ensureInlineCompletionController,
} from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { ParagraphRenderer, registerRenderer } from "../renderers/index";
import { defaultSchema } from "@input/pen-schema";
import { PlaceholderParagraphRenderer } from "./utils/placeholderTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	registerRenderer("paragraph", ParagraphRenderer);
});

describe("@input/pen-react placeholder behavior: active block placeholders", () => {
	it("shows a block placeholder only for the active empty block", async () => {
		registerRenderer("paragraph", PlaceholderParagraphRenderer);

		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		editor.apply([
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
		]);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(0);

		await act(async () => {
			editor.selectText(secondBlockId, 0, 0);
		});

		const placeholders = container.querySelectorAll(
			"[data-placeholder-visible]",
		);
		expect(placeholders).toHaveLength(1);
		expect(placeholders[0]?.getAttribute("data-placeholder")).toBe(
			"Type ⌘I for AI Agent, or / for commands",
		);
		expect(
			placeholders[0]
				?.closest("[data-block-id]")
				?.getAttribute("data-block-id"),
		).toBe(secondBlockId);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("hides active block placeholders for an atom-only block", async () => {
		registerRenderer("paragraph", PlaceholderParagraphRenderer);

		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		editor.apply([
			{
				type: "splice-text",
				blockId: firstBlockId,
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: secondBlockId,
				from: 0,
				to: 0,
				insert: {
					nodeType: "mention",
					props: { id: "user-1", label: "Ada" },
				},
			},
		]);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
			editor.selectText(secondBlockId, 0, 0);
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(0);
		expect(
			container.querySelector("[data-pen-inline-atom]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("hides active empty block placeholders while any inline completion is visible", async () => {
		registerRenderer("paragraph", PlaceholderParagraphRenderer);

		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const inlineCompletion = ensureInlineCompletionController(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		editor.apply([
			{
				type: "splice-text",
				blockId: firstBlockId,
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
		]);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
			editor.selectText(secondBlockId, 0, 0);
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(1);

		await act(async () => {
			inlineCompletion.controller.showSuggestion({
				id: "suggestion-1",
				blockId: firstBlockId,
				offset: 5,
				text: " there",
				type: "inline",
			});
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(0);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		inlineCompletion.release();
		editor.destroy();
	});
});
