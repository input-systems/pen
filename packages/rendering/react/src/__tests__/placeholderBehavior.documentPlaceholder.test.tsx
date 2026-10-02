// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import {
	createEditor,
	defineBlock,
	ensureInlineCompletionController,
	mergeSchemas,
	SchemaRegistryImpl,
} from "@input/pen-core";
import { type BlockHandle, type BlockRenderContext } from "@input/pen-types";
import { defaultPreset } from "@input/pen";
import { InlineContent } from "../primitives/editor/inlineContent";
import { Pen } from "../primitives/index";
import { ParagraphRenderer, registerRenderer } from "../renderers/index";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function PlaceholderParagraphRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return (
		<div
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			data-block-type="paragraph"
			data-selected={ctx.selected ? "" : undefined}
		>
			<InlineContent
				blockId={block.id}
				placeholder="Type ⌘I for AI Agent, or / for commands"
			/>
		</div>
	);
}

/**
 * An email signature: chrome the host puts in the document, which the user did
 * not write and is not asked to write (RI8).
 */
const signature = defineBlock("signature", {
	content: "none",
	fieldEditor: "none",
	authoring: {
		contentRole: "chrome",
		flowCapability: "flow-structural",
		selectionRole: "structural",
	},
});

const composerSchema = mergeSchemas(
	defaultSchema,
	new SchemaRegistryImpl({ blocks: [signature], inlines: [] }),
);

function SignatureRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return (
		<div
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			data-block-type="signature"
		>
			— Ada
		</div>
	);
}

afterEach(() => {
	registerRenderer("paragraph", ParagraphRenderer);
});

describe("@input/pen-react placeholder behavior: the document placeholder", () => {
	it("shows the document empty placeholder for a single empty block", async () => {
		registerRenderer("paragraph", PlaceholderParagraphRenderer);

		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		const placeholders = container.querySelectorAll(
			"[data-placeholder-visible]",
		);
		expect(placeholders).toHaveLength(1);
		expect(placeholders[0]?.getAttribute("data-placeholder")).toBe(
			"Start writing...",
		);
		expect(placeholders[0]?.getAttribute("data-placeholder-visible")).toBe(
			"",
		);
		expect(
			placeholders[0]?.hasAttribute("data-pen-field-editor-surface"),
		).toBe(true);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("paints the document placeholder on the body of a chrome-first document", async () => {
		registerRenderer("paragraph", PlaceholderParagraphRenderer);

		const editor = createEditor({
			schema: composerSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const bodyId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		editor.apply([
			{
				type: "insert-block",
				blockId: "signature-1",
				blockType: "signature",
				props: {},
				position: "first",
			},
		]);

		await act(async () => {
			root.render(
				<Pen.Editor.Root
					editor={editor}
					renderers={{ signature: SignatureRenderer }}
				>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		const placeholders = container.querySelectorAll(
			"[data-placeholder-visible]",
		);
		expect(placeholders).toHaveLength(1);
		expect(placeholders[0]?.getAttribute("data-placeholder")).toBe(
			"Start writing...",
		);
		const bodyElement = container.querySelector(
			`[data-block-id="${bodyId}"]`,
		);
		expect(bodyElement).not.toBeNull();
		expect(placeholders[0]?.closest("[data-block-id]")).toBe(bodyElement);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("hides the document empty placeholder for a single atom-only block", async () => {
		registerRenderer("paragraph", PlaceholderParagraphRenderer);

		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		editor.apply([
			{
				type: "splice-text",
				blockId,
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

	it("hides the document empty placeholder while an inline completion is visible", async () => {
		registerRenderer("paragraph", PlaceholderParagraphRenderer);

		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		const inlineCompletion = ensureInlineCompletionController(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(1);

		await act(async () => {
			inlineCompletion.controller.showSuggestion({
				id: "suggestion-1",
				blockId,
				offset: 0,
				text: "",
				type: "inline",
				previewBlocks: [
					{
						id: "preview-1",
						text: "A suggested opening",
						blockType: "paragraph",
					},
				],
			});
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(0);

		await act(async () => {
			inlineCompletion.controller.dismissSuggestion();
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(1);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		inlineCompletion.release();
		editor.destroy();
	});

	it("hides schema placeholders while an inline completion is visible", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		const inlineCompletion = ensureInlineCompletionController(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="" />
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
			editor.selectText(blockId, 0, 0);
		});

		const placeholders = container.querySelectorAll(
			"[data-placeholder-visible]",
		);
		expect(placeholders).toHaveLength(1);
		expect(placeholders[0]?.getAttribute("data-placeholder")).toBe("Text");

		await act(async () => {
			inlineCompletion.controller.showSuggestion({
				id: "suggestion-1",
				blockId,
				offset: 0,
				text: "",
				type: "inline",
				previewBlocks: [
					{
						id: "preview-1",
						text: "A suggested opening",
						blockType: "paragraph",
					},
				],
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

	it("renders inline completion text on an empty block surface", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		const inlineCompletion = ensureInlineCompletionController(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
			editor.selectText(blockId, 0, 0);
			inlineCompletion.controller.showSuggestion({
				id: "suggestion-1",
				blockId,
				offset: 0,
				text: "Thanks for the update.",
				type: "inline",
			});
		});

		const suggestionSurface = container.querySelector(
			".pen-ephemeral-suggestion",
		);
		expect(suggestionSurface?.getAttribute("data-suggestion-id")).toBe(
			"suggestion-1",
		);
		expect(suggestionSurface?.getAttribute("data-suggestion-text")).toBe(
			"Thanks for the update.",
		);
		expect(
			suggestionSurface?.getAttribute("data-suggestion-placement"),
		).toBe("after");
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

	it("does not treat a single structural block as an empty document", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		editor.apply([
			{ type: "set-props", blockId, props: { type: "divider" } },
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
		expect(
			container
				.querySelector("[data-pen-editor-root]")
				?.hasAttribute("data-empty"),
		).toBe(false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("clears the document placeholder when a second empty block is inserted", async () => {
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

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(1);

		await act(async () => {
			editor.apply([
				{
					type: "insert-block",
					blockId: secondBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: firstBlockId },
				},
			]);
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(0);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
