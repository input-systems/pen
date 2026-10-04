// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import {
	createEditor,
	createKeyEvent,
	createMouseEvent,
	flushAnimationFrames,
	getFieldEditor,
} from "./utils/tableRenderingTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react table rendering: cell selection promotion", () => {
	it("does not route printable keys through cell-selection shortcuts while editing a cell", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t5",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t5",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "Hello",
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
		const cellSurface = container.querySelector(
			`[data-block-id="t5"] [data-cell-row="0"][data-cell-col="0"] [data-pen-field-editor-surface]`,
		) as HTMLElement | null;

		expect(cellSurface).not.toBeNull();

		await act(async () => {
			editor.selectCell("t5", 0, 0);
			fieldEditor.activateCellFromElement?.("t5", 0, 0, cellSurface!);
			await flushAnimationFrames(2);
		});

		const event = new KeyboardEvent("keydown", {
			key: "b",
			bubbles: true,
			cancelable: true,
		});

		await act(async () => {
			cellSurface?.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes a repeated click on the same cell to block selection", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t6",
				blockType: "table",
				props: {},
				position: "last",
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

		const firstCell = container.querySelector(
			`[data-block-id="t6"] [data-pen-table-cell][data-cell-row="0"][data-cell-col="0"]`,
		) as HTMLElement | null;
		expect(firstCell).not.toBeNull();

		await act(async () => {
			firstCell?.dispatchEvent(
				createMouseEvent("mousedown", { detail: 1 }),
			);
			firstCell?.dispatchEvent(
				createMouseEvent("mouseup", { detail: 1 }),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "cell",
			blockId: "t6",
			anchor: { row: 0, col: 0 },
			head: { row: 0, col: 0 },
		});

		await act(async () => {
			firstCell?.dispatchEvent(
				createMouseEvent("mousedown", { detail: 1 }),
			);
			firstCell?.dispatchEvent(
				createMouseEvent("mouseup", { detail: 1 }),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["t6"],
			head: "t6",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes backspace at the start of the next block to table block selection", async () => {
		const editor = createEditor();
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t7",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: paragraphId,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: paragraphId,
				from: 0,
				to: 0,
				insert: "After",
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
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		expect(paragraphInline).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(paragraphId, 0, 0);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			paragraphInline?.dispatchEvent(createKeyEvent("Backspace"));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["t7"],
			head: "t7",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes beforeinput backspace into a selected table that can be deleted", async () => {
		const editor = createEditor();
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t7-beforeinput",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: paragraphId,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: paragraphId,
				from: 0,
				to: 0,
				insert: "After",
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
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		const tableBlock = container.querySelector(
			`[data-block-id="t7-beforeinput"]`,
		) as HTMLElement | null;

		expect(paragraphInline).not.toBeNull();
		expect(tableBlock).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(paragraphId, 0, 0);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			paragraphInline?.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "deleteContentBackward",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["t7-beforeinput"],
			head: "t7-beforeinput",
		});
		expect(tableBlock?.getAttribute("data-selected")).toBe("");
		expect(
			tableBlock
				?.querySelector("[data-pen-table-frame]")
				?.getAttribute("data-selected"),
		).toBe("");

		await act(async () => {
			document.dispatchEvent(createKeyEvent("Backspace"));
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock("t7-beforeinput")).toBeNull();
		expect(editor.getBlock(paragraphId)).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
