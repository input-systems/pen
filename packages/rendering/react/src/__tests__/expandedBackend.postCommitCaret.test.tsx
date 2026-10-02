// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import {
	createEditor as createCoreEditor,
	DocumentRangeImpl,
	ensureInlineCompletionController,
	fieldEditorHostFacet,
} from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import type { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import { Pen } from "../primitives/index";
import { domSelectionToEditor } from "@input/pen-dom/field-editor/selectionBridge";
import { projectSelectionToDom } from "./utils/projectSelectionToDom";
import { FakeEditContext } from "./utils/fakeEditContext";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createEditor(options: Parameters<typeof createCoreEditor>[0] = {}) {
	return createCoreEditor({
		schema: defaultSchema,
		...options,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

function createEscapeEvent(): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
	});
}

function createSelectAllEvent(): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key: "a",
		metaKey: true,
		bubbles: true,
		cancelable: true,
	});
}

async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

function getFieldEditor(
	editor: ReturnType<typeof createEditor>,
): FieldEditorImpl {
	const fieldEditor = editor.facet(
		fieldEditorHostFacet,
	) as FieldEditorImpl | null;
	if (!fieldEditor) {
		throw new Error("Missing attached field editor");
	}
	return fieldEditor;
}

function setNativeSelectionRange(
	startElement: HTMLElement,
	startOffset: number,
	endElement: HTMLElement,
	endOffset: number,
): void {
	const selection = document.getSelection();
	const range = document.createRange();
	range.setStart(startElement.firstChild ?? startElement, startOffset);
	range.setEnd(endElement.firstChild ?? endElement, endOffset);
	selection?.removeAllRanges();
	selection?.addRange(range);
}

function createMouseUpEvent(clientX = 40, clientY = 40): MouseEvent {
	return new MouseEvent("mouseup", {
		bubbles: true,
		clientX,
		clientY,
	});
}

describe("@input/pen-react expanded backend: the programmatic post-commit caret", () => {
	it("prevents native drag start on the expanded host", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

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

		expect(blocksHost).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: secondBlockId, offset: 3 },
			);
			await flushAnimationFrames(2);
		});

		const dragStartEvent = new Event("dragstart", {
			bubbles: true,
			cancelable: true,
		});
		const dropEvent = new Event("drop", {
			bubbles: true,
			cancelable: true,
		});

		expect(blocksHost?.dispatchEvent(dragStartEvent)).toBe(false);
		expect(dragStartEvent.defaultPrevented).toBe(true);
		expect(blocksHost?.dispatchEvent(dropEvent)).toBe(false);
		expect(dropEvent.defaultPrevented).toBe(true);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("uses the programmatic post-commit caret when a stale selectionchange arrives before typing", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hel" },
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
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 3, 3);
			fieldEditor.focus();
			fieldEditor.setFocused(true);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			editor.apply(
				[
					{
						type: "splice-text",
						blockId,
						from: 3,
						to: 3,
						insert: "lo world",
					},
				],
				{ origin: "ai" },
			);
			fieldEditor.commitProgrammaticTextSelection(blockId, 11, 11);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			setNativeSelectionRange(inlineElement!, 11, inlineElement!, 11);
			document.dispatchEvent(new Event("selectionchange"));
			setNativeSelectionRange(inlineElement!, 3, inlineElement!, 3);
			document.dispatchEvent(new Event("selectionchange"));
			inlineElement?.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "!",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world!");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 12 },
			focus: { blockId, offset: 12 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("uses the accepted inline completion caret for immediate enter with stale EditContext state", async () => {
		const originalEditContext = (
			globalThis as typeof globalThis & {
				EditContext?: typeof FakeEditContext;
			}
		).EditContext;
		(
			globalThis as typeof globalThis & {
				EditContext?: typeof FakeEditContext;
			}
		).EditContext = FakeEditContext;

		try {
			const editor = createEditor();
			const blockId = editor.firstBlock()!.id;
			const { controller: inlineCompletion } =
				ensureInlineCompletionController(editor);

			editor.apply([
				{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hel" },
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
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as (HTMLElement & { editContext?: FakeEditContext }) | null;

			expect(inlineElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 3, 3);
				await flushAnimationFrames(2);
			});

			await act(async () => {
				inlineElement?.editContext?.emit("textupdate", {
					updateRangeStart: 3,
					updateRangeEnd: 3,
					text: "",
					selectionStart: 3,
					selectionEnd: 3,
				});
				inlineCompletion.showSuggestion({
					id: "suggestion-1",
					blockId,
					offset: 3,
					text: "lo world",
					type: "inline",
				});
				const activeInlineElement = container.querySelector(
					"[data-pen-inline-content]",
				) as HTMLElement | null;
				expect(activeInlineElement).not.toBeNull();
				setNativeSelectionRange(
					activeInlineElement!,
					3,
					activeInlineElement!,
					3,
				);
				expect(inlineCompletion.acceptSuggestion()).toBe(true);
				if (editor.getBlock(blockId)?.textContent() === "Hel") {
					editor.apply([
						{
							type: "splice-text",
							blockId,
							from: 3,
							to: 3,
							insert: "lo world",
						},
					]);
				}
				fieldEditor.commitProgrammaticTextSelection(blockId, 11, 11);
				await flushAnimationFrames(2);
				setNativeSelectionRange(
					activeInlineElement!,
					11,
					activeInlineElement!,
					11,
				);
				activeInlineElement?.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					}),
				);
			});

			if (editor.getBlock(blockId)?.textContent() === "Hel") {
				editor.apply([
					{
						type: "splice-text",
						blockId,
						from: 3,
						to: 3,
						insert: "lo world",
					},
				]);
			}
			expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world");

			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		} finally {
			(
				globalThis as typeof globalThis & {
					EditContext?: typeof FakeEditContext;
				}
			).EditContext = originalEditContext;
		}
	});
});
