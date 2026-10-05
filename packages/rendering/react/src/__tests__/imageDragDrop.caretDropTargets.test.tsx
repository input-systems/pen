// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@input/pen-core";
import type { AssetProvider } from "@input/pen-types";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";
import {
	createDataTransfer,
	createDragEvent,
} from "./utils/imageDragDropTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react image drag and drop: caret drop targets", () => {
	it("splits inline text when dropping an image at a caret position", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const paragraphId = editor.firstBlock()!.id;
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockResolvedValue({
				url: "memory://photo.png",
				mimeType: "image/png",
			}),
			resolve(ref) {
				return ref.url;
			},
			async delete() {},
		};

		editor.apply([
			{
				type: "splice-text",
				blockId: paragraphId,
				from: 0,
				to: 0,
				insert: "Hello",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		const originalElementFromPoint = document.elementFromPoint;
		const docWithCaretRange = document as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const originalCaretRangeFromPoint =
			docWithCaretRange.caretRangeFromPoint;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor} assets={assetProvider}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as HTMLElement | null;
			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;

			expect(inlineElement).not.toBeNull();
			expect(contentElement).not.toBeNull();

			const textNode = inlineElement!.firstChild;
			expect(textNode).not.toBeNull();

			inlineElement!.getBoundingClientRect = () =>
				({
					left: 0,
					top: 0,
					right: 120,
					bottom: 24,
					width: 120,
					height: 24,
					x: 0,
					y: 0,
					toJSON() {
						return {};
					},
				}) as DOMRect;

			document.elementFromPoint = () => inlineElement;
			docWithCaretRange.caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(textNode!, 2);
				range.collapse(true);
				return range;
			};

			const file = new File(["image"], "photo.png", {
				type: "image/png",
			});
			const dataTransfer = createDataTransfer([file]);
			const dragEnterEvent = createDragEvent("dragenter", {
				dataTransfer,
				clientX: 40,
				clientY: 12,
			});
			const dragOverEvent = createDragEvent("dragover", {
				dataTransfer,
				clientX: 40,
				clientY: 12,
			});
			const dropEvent = createDragEvent("drop", {
				dataTransfer,
				clientX: 40,
				clientY: 12,
			});

			await act(async () => {
				inlineElement!.dispatchEvent(dragEnterEvent);
				inlineElement!.dispatchEvent(dragOverEvent);
			});

			expect(contentElement?.hasAttribute("data-drop-target")).toBe(true);
			expect(
				container.querySelector("[data-pen-drop-caret]"),
			).not.toBeNull();

			await act(async () => {
				inlineElement!.dispatchEvent(dropEvent);
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			const blockOrder = editor.documentState.blockOrder;
			const insertedImageId = blockOrder[1]!;
			const insertedImage = editor.getBlock(insertedImageId);
			expect(assetProvider.upload).toHaveBeenCalledTimes(1);
			expect(insertedImage?.type).toBe("image");
			expect(insertedImage?.props).toMatchObject({
				src: "memory://photo.png",
				alt: "photo",
			});
			expect(blockOrder).toHaveLength(3);
			expect(blockOrder[0]).toBe(paragraphId);
			expect(blockOrder[1]).toBe(insertedImageId);
			const trailingParagraphId = blockOrder[2]!;
			expect(editor.getBlock(paragraphId)?.textContent()).toBe("He");
			expect(editor.getBlock(trailingParagraphId)?.textContent()).toBe(
				"llo",
			);
			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [insertedImage!.id],
			});
			expect(contentElement?.hasAttribute("data-drop-target")).toBe(
				false,
			);

			await act(async () => {
				root.unmount();
			});
		} finally {
			docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;
			document.elementFromPoint = originalElementFromPoint;
			container.remove();
			editor.destroy();
		}
	});

	it("moves the drop target out of the focused block", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstParagraphId = editor.firstBlock()!.id;
		const secondParagraphId = crypto.randomUUID();
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockResolvedValue({
				url: "memory://photo.png",
				mimeType: "image/png",
			}),
			resolve(ref) {
				return ref.url;
			},
			async delete() {},
		};

		editor.apply([
			{
				type: "splice-text",
				blockId: firstParagraphId,
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondParagraphId,
				blockType: "paragraph",
				props: {},
				position: { after: firstParagraphId },
			},
			{
				type: "splice-text",
				blockId: secondParagraphId,
				from: 0,
				to: 0,
				insert: "World",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		const originalElementFromPoint = document.elementFromPoint;
		const docWithCaretRange = document as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const originalCaretRangeFromPoint =
			docWithCaretRange.caretRangeFromPoint;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor} assets={assetProvider}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const inlineElements = Array.from(
				container.querySelectorAll("[data-pen-inline-content]"),
			) as HTMLElement[];
			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;
			const firstInlineElement = inlineElements[0] ?? null;
			const secondInlineElement = inlineElements[1] ?? null;

			expect(firstInlineElement).not.toBeNull();
			expect(secondInlineElement).not.toBeNull();
			expect(contentElement).not.toBeNull();

			const firstTextNode = firstInlineElement!.firstChild;
			expect(firstTextNode).not.toBeNull();

			firstInlineElement!.getBoundingClientRect = () =>
				({
					left: 0,
					top: 0,
					right: 120,
					bottom: 24,
					width: 120,
					height: 24,
					x: 0,
					y: 0,
					toJSON() {
						return {};
					},
				}) as DOMRect;

			secondInlineElement!.getBoundingClientRect = () =>
				({
					left: 0,
					top: 40,
					right: 120,
					bottom: 64,
					width: 120,
					height: 24,
					x: 0,
					y: 40,
					toJSON() {
						return {};
					},
				}) as DOMRect;

			document.elementFromPoint = () => secondInlineElement;
			docWithCaretRange.caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(firstTextNode!, 2);
				range.collapse(true);
				return range;
			};

			const file = new File(["image"], "photo.png", {
				type: "image/png",
			});
			const dataTransfer = createDataTransfer([file]);
			const dragEnterEvent = createDragEvent("dragenter", {
				dataTransfer,
				clientX: 40,
				clientY: 52,
			});
			const dragOverEvent = createDragEvent("dragover", {
				dataTransfer,
				clientX: 40,
				clientY: 52,
			});
			const dropEvent = createDragEvent("drop", {
				dataTransfer,
				clientX: 40,
				clientY: 52,
			});

			await act(async () => {
				secondInlineElement!.dispatchEvent(dragEnterEvent);
				secondInlineElement!.dispatchEvent(dragOverEvent);
			});

			expect(contentElement?.hasAttribute("data-drop-target")).toBe(true);
			expect(
				container.querySelector("[data-pen-drop-caret]"),
			).not.toBeNull();

			await act(async () => {
				secondInlineElement!.dispatchEvent(dropEvent);
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			const blockOrder = editor.documentState.blockOrder;
			const insertedImageId = blockOrder[1]!;
			const insertedImage = editor.getBlock(insertedImageId);
			expect(insertedImage?.type).toBe("image");
			expect(blockOrder).toEqual([
				firstParagraphId,
				insertedImageId,
				secondParagraphId,
			]);
			expect(editor.getBlock(firstParagraphId)?.textContent()).toBe(
				"Hello",
			);
			expect(editor.getBlock(secondParagraphId)?.textContent()).toBe(
				"World",
			);

			await act(async () => {
				root.unmount();
			});
		} finally {
			docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;
			document.elementFromPoint = originalElementFromPoint;
			container.remove();
			editor.destroy();
		}
	});
});
