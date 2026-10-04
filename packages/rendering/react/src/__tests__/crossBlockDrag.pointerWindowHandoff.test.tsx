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

describe("@input/pen-react cross-block drag: pointer window handoff", () => {
	it("hands off drag updates to native selection after expansion", async () => {
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
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;
		const secondBlockElement = blockElements[1] as HTMLElement | undefined;

		expect(rootElement).not.toBeNull();
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

		await act(async () => {
			fieldEditor.notifyGestureEvent("pointerdown");
			setNativeSelectionRange(
				firstInlineElement!,
				1,
				secondInlineElement!,
				4,
			);
			document.dispatchEvent(new Event("selectionchange"));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes a native cross-block drag while the pointer window is open, and expands on mouseup", async () => {
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
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;
		const secondBlockElement = blockElements[1] as HTMLElement | undefined;

		expect(rootElement).not.toBeNull();
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
			await flushAnimationFrames(1);
		});

		await act(async () => {
			setNativeSelectionRange(
				firstInlineElement!,
				1,
				secondInlineElement!,
				4,
			);
			expect(domSelectionToEditor(rootElement!)).toMatchObject({
				anchor: { blockId: firstBlockId, offset: 1 },
				focus: { blockId: secondBlockId, offset: 4 },
			});
		});

		// The native range has to reach the authority through selectionchange, so
		// settle before reading it. Asserting straight after setNativeSelectionRange
		// races that path: it wins in isolation and lost 3 of 4 full-suite runs.
		await act(async () => {
			await flushAnimationFrames(2);
		});

		// mousedown opened a pointer gesture window, and a proposal spanning two
		// text blocks becomes a multi-block TextSelection while it is open
		// (spec/rules/selection.md §4.2 step 5). This assertion used to expect the
		// single-block range to survive until mouseup, which was v1's
		// _pointerSelectionDepth deferral — since deleted.
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
		});

		await act(async () => {
			// Browsers fire pointerup before mouseup; the reader reads there (D19).
			document.dispatchEvent(new Event("pointerup"));
			document.dispatchEvent(createMouseUpEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
