// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import { domSelectionToEditor } from "@input/pen-dom/field-editor/selectionBridge";
import {
	createEditor,
	createMouseUpEvent,
	flushAnimationFrames,
	getFieldEditor,
	setNativeSelectionRange,
} from "./utils/crossBlockSelectionTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react cross-block drag: native selection promotion", () => {
	it("promotes native cross-block DOM selection into expanded text selection", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

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
				insert: "World",
			},
		]);

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

		const fieldEditor = getFieldEditor(editor);
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(rootElement).not.toBeNull();
		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			await flushAnimationFrames(1);
		});

		await act(async () => {
			fieldEditor.beginPointerSelection();
			const selection = document.getSelection();
			const range = document.createRange();
			range.setStart(
				firstInlineElement!.firstChild ?? firstInlineElement!,
				1,
			);
			range.setEnd(
				secondInlineElement!.firstChild ?? secondInlineElement!,
				2,
			);

			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
			await flushAnimationFrames(2);
		});

		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
		});
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			isEditing: true,
			mode: "expanded",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps expanded inline blocks reconciled from CRDT updates", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

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
				insert: "World",
			},
		]);

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

		const fieldEditor = getFieldEditor(editor);
		const blocksHost = container.querySelector(
			"[data-pen-editor-blocks-host]",
		) as HTMLElement | null;
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(blocksHost).not.toBeNull();
		expect(blocksHost?.hasAttribute("data-pen-field-editor-surface")).toBe(
			false,
		);
		expect(
			blocksHost?.hasAttribute("data-pen-field-editor-active-surface"),
		).toBe(false);
		expect(secondInlineElement).toBeDefined();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: secondBlockId, offset: 2 },
			);
			await flushAnimationFrames(2);
		});

		expect(fieldEditor.getSnapshot()).toMatchObject({
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});
		expect(blocksHost?.hasAttribute("data-pen-field-editor-surface")).toBe(
			true,
		);
		expect(
			blocksHost?.hasAttribute("data-pen-field-editor-active-surface"),
		).toBe(true);

		await act(async () => {
			editor.apply([
				{
					type: "splice-text",
					blockId: secondBlockId,
					from: 5,
					to: 5,
					insert: "!",
				},
			]);
			await flushAnimationFrames(2);
		});

		expect(secondInlineElement?.textContent).toBe("World!");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("expands an in-progress drag selection into the next block", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

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
				insert: "World",
			},
		]);

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

		const fieldEditor = getFieldEditor(editor);
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const blockElements = container.querySelectorAll("[data-block-id]");
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const blocksHost = container.querySelector(
			"[data-pen-editor-blocks-host]",
		) as HTMLElement | null;
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;
		const secondBlockElement = blockElements[1] as HTMLElement | undefined;

		expect(rootElement).not.toBeNull();
		expect(blocksHost).not.toBeNull();
		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();
		expect(secondBlockElement).toBeDefined();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: firstBlockId, offset: 5 },
			);
			firstInlineElement?.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					buttons: 1,
				}),
			);
			setNativeSelectionRange(
				firstInlineElement!,
				1,
				secondInlineElement!,
				2,
			);
			// Browsers fire pointerup before mouseup; the reader reads there (D19).
			document.dispatchEvent(new Event("pointerup"));
			document.dispatchEvent(createMouseUpEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});
		expect(document.activeElement).toBe(blocksHost);

		await act(async () => {
			secondBlockElement?.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					button: 0,
				}),
			);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
