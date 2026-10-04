// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import {
	createEditor,
	flushAnimationFrames,
	getFieldEditor,
	setNativeSelectionRange,
} from "./utils/crossBlockSelectionTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react cross-block drag: promotion on mousemove", () => {
	it("promotes an unfocused cross-block drag on mousemove before mouseup", async () => {
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
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();

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
			).caretRangeFromPoint = (_x, y) => {
				const range = document.createRange();
				if (y >= 30) {
					range.setStart(
						secondInlineElement!.firstChild ?? secondInlineElement!,
						4,
					);
				} else {
					range.setStart(
						firstInlineElement!.firstChild ?? firstInlineElement!,
						1,
					);
				}
				range.collapse(true);
				return range;
			};

			await act(async () => {
				firstInlineElement?.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 8,
					}),
				);
				setNativeSelectionRange(
					firstInlineElement!,
					1,
					secondInlineElement!,
					4,
				);
				document.dispatchEvent(
					new MouseEvent("mousemove", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 40,
					}),
				);
				await flushAnimationFrames(2);
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
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps the initial pointer anchor when an unfocused cross-block drag has no stable native range", async () => {
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

		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();

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
			).caretRangeFromPoint = (_x, y) => {
				const range = document.createRange();
				if (y >= 30) {
					range.setStart(
						secondInlineElement!.firstChild ?? secondInlineElement!,
						3,
					);
				} else {
					range.setStart(
						firstInlineElement!.firstChild ?? firstInlineElement!,
						1,
					);
				}
				range.collapse(true);
				return range;
			};

			await act(async () => {
				firstInlineElement?.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 8,
					}),
				);
				document.dispatchEvent(
					new MouseEvent("mousemove", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 40,
					}),
				);
				await flushAnimationFrames(2);
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
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 3 },
		});
		expect(getFieldEditor(editor).getSnapshot()).toMatchObject({
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
