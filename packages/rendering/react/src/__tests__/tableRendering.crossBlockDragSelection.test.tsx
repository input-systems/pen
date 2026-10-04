// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import {
	createEditor,
	createMouseEvent,
	createSelectAllEvent,
	flushAnimationFrames,
	getFieldEditor,
} from "./utils/tableRenderingTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react table rendering: cross-block drag selection", () => {
	it("escalates cmd+a from a selected cell to top-level BlockSelection in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t8-cell",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t8-cell",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "Alpha",
			},
			{
				type: "splice-text",
				blockId: "t8-cell",
				cell: { row: 0, col: 1 },
				from: 0,
				to: 0,
				insert: "Bravo",
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
		const secondCellSurface = container.querySelector(
			`[data-block-id="t8-cell"] [data-cell-row="0"][data-cell-col="1"] [data-pen-field-editor-surface]`,
		) as HTMLElement | null;
		expect(secondCellSurface).not.toBeNull();

		await act(async () => {
			editor.selectCell("t8-cell", 0, 1);
			fieldEditor.activateCellFromElement?.(
				"t8-cell",
				0,
				1,
				secondCellSurface!,
			);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		const firstBlockId = editor.firstBlock()!.id;
		expect(editor.selection).toEqual({
			type: "block",
			blockIds: [firstBlockId, "t8-cell", paragraphId],
			head: paragraphId,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("creates a canonical cross-block selection when dragging from a table into text in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t9",
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

		const firstCell = container.querySelector(
			`[data-block-id="t9"] [data-pen-table-cell][data-cell-row="0"][data-cell-col="0"]`,
		) as HTMLElement | null;
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		expect(firstCell).not.toBeNull();
		expect(paragraphInline).not.toBeNull();

		const docWithCaretRange = document as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const originalCaretRangeFromPoint =
			docWithCaretRange.caretRangeFromPoint;
		docWithCaretRange.caretRangeFromPoint = () => {
			const range = document.createRange();
			range.setStart(paragraphInline!.firstChild ?? paragraphInline!, 2);
			range.setEnd(paragraphInline!.firstChild ?? paragraphInline!, 2);
			return range;
		};

		await act(async () => {
			firstCell?.dispatchEvent(
				createMouseEvent("mousedown", {
					detail: 1,
					clientX: 10,
					clientY: 10,
				}),
			);
			paragraphInline?.dispatchEvent(
				createMouseEvent("mouseup", {
					detail: 1,
					clientX: 60,
					clientY: 40,
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: "t9", offset: 0 },
			focus: { blockId: paragraphId, offset: 2 },
		});

		docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps a T2 multi-block text selection when dragging from a table into text in structured documents", async () => {
		const editor = createEditor();
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t9-structured",
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

		const tableCell = container.querySelector(
			`[data-block-id="t9-structured"] [data-pen-table-cell][data-cell-row="0"][data-cell-col="0"]`,
		) as HTMLElement | null;
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		expect(tableCell).not.toBeNull();
		expect(paragraphInline).not.toBeNull();

		const docWithCaretRange = document as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const originalCaretRangeFromPoint =
			docWithCaretRange.caretRangeFromPoint;
		docWithCaretRange.caretRangeFromPoint = () => {
			const range = document.createRange();
			range.setStart(paragraphInline!.firstChild ?? paragraphInline!, 2);
			range.setEnd(paragraphInline!.firstChild ?? paragraphInline!, 2);
			return range;
		};

		await act(async () => {
			tableCell?.dispatchEvent(
				createMouseEvent("mousedown", {
					detail: 1,
					clientX: 10,
					clientY: 10,
				}),
			);
			paragraphInline?.dispatchEvent(
				createMouseEvent("mouseup", {
					detail: 1,
					clientX: 60,
					clientY: 40,
				}),
			);
			await flushAnimationFrames(2);
		});

		// T2 / §4.2: pointer reads never escalate by block type. Profile
		// does not modulate that — structured matches the flow sibling.
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: "t9-structured", offset: 0 },
			focus: { blockId: paragraphId, offset: 2 },
		});

		docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
