// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createDecorationSet } from "@input/pen-core";
import { defineExtension } from "@input/pen-core";
import { domSelectionToEditor } from "@input/pen-dom/field-editor/selectionBridge";
import { Pen } from "../primitives/index";
import { FakeEditContext } from "./utils/fakeEditContext";
import { defaultSchema } from "@input/pen-schema";
import {
	createEditor,
	createKeyEvent,
	createSelectAllEvent,
	createUndoSelectionDeletionEditor,
	flushAnimationFrames,
	getFieldEditor,
	setNativeSelectionRange,
	SLOW_BEFOREINPUT_TEST_TIMEOUT_MS,
} from "./utils/selectionDeletionTestHelpers";
describe("@input/pen-react click gestures: collapsing after a triple click", () => {
	it("collapses an immediate fourth click after triple-click paragraph selection", async () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hello world",
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
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();
		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		const originalCaretRangeFromPoint = (
			document as Document & {
				caretRangeFromPoint?: (x: number, y: number) => Range | null;
			}
		).caretRangeFromPoint;

		try {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 3);
				range.collapse(true);
				return range;
			};

			await act(async () => {
				inlineElement!.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 3,
					}),
				);

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 11);

				// Browsers fire pointerup before mouseup; the reader reads there (D19).
				document.dispatchEvent(new Event("pointerup"));
				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 3,
					}),
				);

				inlineElement!.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 4,
					}),
				);

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 11);

				// Browsers fire pointerup before mouseup; the reader reads there (D19).
				document.dispatchEvent(new Event("pointerup"));
				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 4,
					}),
				);

				inlineElement!.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 4,
					}),
				);

				await flushAnimationFrames(4);
			});
		} finally {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = originalCaretRangeFromPoint;
		}

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("collapses an immediate follow-up single click after triple-click paragraph selection", async () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hello world",
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
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();
		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		const originalCaretRangeFromPoint = (
			document as Document & {
				caretRangeFromPoint?: (x: number, y: number) => Range | null;
			}
		).caretRangeFromPoint;

		try {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 3);
				range.collapse(true);
				return range;
			};

			await act(async () => {
				inlineElement!.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 3,
					}),
				);

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 11);

				// Browsers fire pointerup before mouseup; the reader reads there (D19).
				document.dispatchEvent(new Event("pointerup"));
				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 3,
					}),
				);

				inlineElement!.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 1,
					}),
				);

				const collapsedRange = document.createRange();
				collapsedRange.setStart(
					inlineElement!.firstChild ?? inlineElement!,
					3,
				);
				collapsedRange.collapse(true);
				document.getSelection()?.removeAllRanges();
				document.getSelection()?.addRange(collapsedRange);

				// Browsers fire pointerup before mouseup; the reader reads there (D19).
				document.dispatchEvent(new Event("pointerup"));
				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 1,
					}),
				);

				inlineElement!.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 1,
					}),
				);

				await flushAnimationFrames(4);
			});
		} finally {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = originalCaretRangeFromPoint;
		}

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
