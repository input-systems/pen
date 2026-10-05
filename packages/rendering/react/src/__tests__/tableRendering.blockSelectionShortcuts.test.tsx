// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { handleCopy } from "@input/pen-dom/field-editor/clipboard";
import { Pen } from "../primitives/index";
import {
	createClipboardData,
	createEditor,
	createKeyEvent,
	createSelectAllEvent,
	flushAnimationFrames,
} from "./utils/tableRenderingTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react table rendering: block selection shortcuts", () => {
	it("maps cmd+a from a selected table to top-level BlockSelection in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t8",
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

		const tableBlock = container.querySelector(
			`[data-block-id="t8"]`,
		) as HTMLElement | null;
		expect(tableBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("t8");
			tableBlock?.focus();
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		const firstBlockId = editor.firstBlock()!.id;
		expect(editor.selection).toEqual({
			type: "block",
			blockIds: [firstBlockId, "t8", paragraphId],
			head: paragraphId,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("escalates block-first cmd+a from a selected table to the document BlockSelection", async () => {
		const editor = createEditor();
		const paragraphId = crypto.randomUUID();
		const clipboardData = createClipboardData();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t8-copy-structured",
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
				<Pen.Editor.Root editor={editor} interactionModel="block-first">
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const tableBlock = container.querySelector(
			`[data-block-id="t8-copy-structured"]`,
		) as HTMLElement | null;
		expect(tableBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("t8-copy-structured");
			tableBlock?.focus();
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		const firstBlockId = editor.firstBlock()!.id;
		expect(editor.selection).toEqual({
			type: "block",
			blockIds: [firstBlockId, "t8-copy-structured", paragraphId],
			head: paragraphId,
		});

		handleCopy(editor, { clipboardData } as ClipboardEvent);

		const copied = JSON.parse(
			clipboardData.getData("application/x-pen-blocks"),
		) as { blocks: Array<{ type: string }> };
		const penBlocks = copied.blocks;

		expect(penBlocks.map((block) => block.type)).toEqual([
			"paragraph",
			"table",
			"paragraph",
		]);
		expect(clipboardData.getData("text/plain")).toContain("After");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes cmd+a copy from a selected table to the full document in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const paragraphId = crypto.randomUUID();
		const clipboardData = createClipboardData();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t8-copy-flow",
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

		const tableBlock = container.querySelector(
			`[data-block-id="t8-copy-flow"]`,
		) as HTMLElement | null;
		expect(tableBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("t8-copy-flow");
			tableBlock?.focus();
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		const firstBlockId = editor.firstBlock()!.id;
		expect(editor.selection).toEqual({
			type: "block",
			blockIds: [firstBlockId, "t8-copy-flow", paragraphId],
			head: paragraphId,
		});

		handleCopy(editor, { clipboardData } as ClipboardEvent);

		const copied = JSON.parse(
			clipboardData.getData("application/x-pen-blocks"),
		) as { blocks: Array<{ type: string }> };
		const penBlocks = copied.blocks;

		expect(penBlocks.map((block) => block.type)).toEqual([
			"paragraph",
			"table",
			"paragraph",
		]);
		expect(clipboardData.getData("text/plain")).toContain("After");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("pressing enter on a block-selected table inserts a paragraph after it", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t-enter",
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

		const tableBlock = container.querySelector(
			`[data-block-id="t-enter"]`,
		) as HTMLElement | null;
		expect(tableBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("t-enter");
			tableBlock?.focus();
			document.dispatchEvent(createKeyEvent("Enter"));
			await flushAnimationFrames(2);
		});

		const paragraphAfterTable = editor.lastBlock();
		expect(paragraphAfterTable?.type).toBe("paragraph");
		expect(paragraphAfterTable?.id).not.toBe("t-enter");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
