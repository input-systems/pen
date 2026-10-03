// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

function createMouseEvent(
	type: "mousedown" | "mousemove" | "mouseup",
	clientX: number,
	clientY: number,
): MouseEvent {
	return new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		button: 0,
		buttons: type === "mouseup" ? 0 : 1,
		clientX,
		clientY,
	});
}

function setRect(
	element: Element,
	left: number,
	top: number,
	width: number,
	height: number,
): void {
	Object.defineProperty(element, "getBoundingClientRect", {
		configurable: true,
		value: () => new DOMRect(left, top, width, height),
	});
}

function createThreeBlockEditor() {
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
	const thirdBlockId = crypto.randomUUID();

	editor.apply([
		{
			type: "splice-text",
			blockId: firstBlockId,
			from: 0,
			to: 0,
			insert: "First",
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
			insert: "Second",
		},
		{
			type: "insert-block",
			blockId: thirdBlockId,
			blockType: "paragraph",
			props: {},
			position: { after: secondBlockId },
		},
		{
			type: "splice-text",
			blockId: thirdBlockId,
			from: 0,
			to: 0,
			insert: "Third",
		},
	]);

	return { editor, firstBlockId, secondBlockId, thirdBlockId };
}

describe("@input/pen-react region selection: background click and marquee", () => {
	it("focuses the existing empty placeholder block on background click", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstBlockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content emptyPlaceholder="Start writing..." />
						<Pen.Editor.RegionSelector />
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;

			expect(contentElement).not.toBeNull();

			await act(async () => {
				contentElement?.dispatchEvent(
					createMouseEvent("mousedown", 12, 12),
				);
				document.dispatchEvent(createMouseEvent("mouseup", 12, 12));
				contentElement?.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: firstBlockId, offset: 0 },
				focus: { blockId: firstBlockId, offset: 0 },
			});
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("inserts a new paragraph when the editor has no blocks", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply([{ type: "delete-block", blockId: firstBlockId }]);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content emptyPlaceholder="Start writing..." />
						<Pen.Editor.RegionSelector />
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;

			expect(contentElement).not.toBeNull();
			expect(editor.documentState.blockOrder).toHaveLength(0);

			await act(async () => {
				contentElement?.dispatchEvent(
					createMouseEvent("mousedown", 12, 12),
				);
				document.dispatchEvent(createMouseEvent("mouseup", 12, 12));
				contentElement?.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.documentState.blockOrder).toHaveLength(1);
			const newBlockId = editor.documentState.blockOrder[0]!;
			expect(editor.getBlock(newBlockId)?.type).toBe("paragraph");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: newBlockId, offset: 0 },
				focus: { blockId: newBlockId, offset: 0 },
			});
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("preserves normal click-to-focus on blocks", async () => {
		const { editor, firstBlockId } = createThreeBlockEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.Editor.RegionSelector />
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const firstBlockElement = container.querySelector(
				`[data-block-id="${firstBlockId}"]`,
			) as HTMLElement | null;

			expect(firstBlockElement).not.toBeNull();

			await act(async () => {
				firstBlockElement?.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						cancelable: true,
						button: 0,
						buttons: 1,
					}),
				);
				document.dispatchEvent(createMouseEvent("mouseup", 12, 12));
				firstBlockElement?.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: firstBlockId, offset: 0 },
				focus: { blockId: firstBlockId, offset: 0 },
			});
			expect(
				container.querySelector("[data-pen-selection-rect]"),
			).toBeNull();
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("O3: selects intersected blocks in document order; the marquee gives way to overlay outlines", async () => {
		const { editor, firstBlockId, secondBlockId, thirdBlockId } =
			createThreeBlockEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.Editor.RegionSelector />
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;
			const blockElements = container.querySelectorAll("[data-block-id]");

			expect(contentElement).not.toBeNull();
			expect(blockElements).toHaveLength(3);

			setRect(blockElements[0]!, 0, 0, 200, 40);
			setRect(blockElements[1]!, 0, 50, 200, 40);
			setRect(blockElements[2]!, 0, 100, 200, 40);

			await act(async () => {
				contentElement?.dispatchEvent(
					createMouseEvent("mousedown", 0, 0),
				);
				document.dispatchEvent(createMouseEvent("mousemove", 180, 85));
			});

			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [firstBlockId, secondBlockId],
			});

			const activeOverlay = container.querySelector(
				"[data-pen-selection-rect]",
			) as HTMLElement | null;
			expect(activeOverlay).not.toBeNull();
			expect(activeOverlay?.hasAttribute("data-selecting")).toBe(true);

			await act(async () => {
				document.dispatchEvent(createMouseEvent("mouseup", 180, 85));
				await flushAnimationFrames(2);
			});

			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [firstBlockId, secondBlockId],
			});
			expect(
				container
					.querySelector(`[data-block-id="${firstBlockId}"]`)
					?.hasAttribute("data-selected"),
			).toBe(true);
			expect(
				container
					.querySelector(`[data-block-id="${secondBlockId}"]`)
					?.hasAttribute("data-selected"),
			).toBe(true);
			expect(
				container
					.querySelector(`[data-block-id="${thirdBlockId}"]`)
					?.hasAttribute("data-selected"),
			).toBe(false);

			// The committed selection is not the marquee's: pen-dom draws it
			// as one O3 outline per block in the overlay layer.
			expect(container.querySelector("[data-pen-selection-rect]")).toBeNull();
			const outlines = [
				...container.querySelectorAll(
					'[data-pen-overlay-layer] [data-pen-overlay-item="block-outline"]',
				),
			].map((node) => node.getAttribute("data-block-id"));
			expect(outlines).toEqual([firstBlockId, secondBlockId]);
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("does not activate marquee selection unless the primitive is mounted", async () => {
		const { editor } = createThreeBlockEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;
			const blockElements = container.querySelectorAll("[data-block-id]");

			expect(contentElement).not.toBeNull();
			expect(blockElements).toHaveLength(3);

			setRect(blockElements[0]!, 0, 0, 200, 40);
			setRect(blockElements[1]!, 0, 50, 200, 40);
			setRect(blockElements[2]!, 0, 100, 200, 40);

			await act(async () => {
				contentElement?.dispatchEvent(
					createMouseEvent("mousedown", 0, 0),
				);
				document.dispatchEvent(createMouseEvent("mousemove", 180, 85));
				document.dispatchEvent(createMouseEvent("mouseup", 180, 85));
			});

			// The drag starts on the background, so FE10 makes it a text
			// drag. What this scenario guards is the marquee: without the
			// primitive there is no block selection and no rect.
			expect(editor.selection?.type).toBe("text");
			expect(
				container.querySelector("[data-pen-selection-rect]"),
			).toBeNull();
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});
