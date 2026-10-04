// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import { Pen } from "../primitives/index";
import {
	createPresetEditor,
	dispatchPointerEvent,
	flushAnimationFrames,
	seedInlineAtomDocument,
} from "./utils/inlineAtomTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Pen inline atom editing: destructure and drag", () => {
	it("fires onAfterDestructure once after a successful wrapper double-click destructure", async () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const onAfterDestructure = vi.fn();

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inlineAtomInteractions={{
							destructure: {
								mention: (atom) =>
									`${atom.props.label as string} <ada@example.com>`,
							},
							onAfterDestructure,
						}}
					>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
				await flushAnimationFrames(2);
			});

			const atom = container.querySelector(
				`[${DATA_ATTRS.inlineAtom}]`,
			) as HTMLElement | null;
			expect(atom).not.toBeNull();

			await act(async () => {
				atom!.dispatchEvent(
					new MouseEvent("dblclick", {
						bubbles: true,
						cancelable: true,
					}),
				);
				await flushAnimationFrames(2);
			});

			expect(onAfterDestructure).toHaveBeenCalledTimes(1);
			expect(onAfterDestructure).toHaveBeenCalledWith({
				editor,
				atom: expect.objectContaining({
					blockId,
					offset: 1,
					type: "mention",
				}),
				blockId,
				startOffset: 1,
				endOffset: 22,
				text: "Ada <ada@example.com>",
			});
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("destructures inline atoms from the Pen wrapper double-click handler", async () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inlineAtomInteractions={{
							destructure: {
								mention: (atom) =>
									`${atom.props.label as string} <ada@example.com>`,
							},
						}}
					>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
				await flushAnimationFrames(2);
			});

			const atom = container.querySelector(
				`[${DATA_ATTRS.inlineAtom}]`,
			) as HTMLElement | null;
			expect(atom).not.toBeNull();

			await act(async () => {
				atom!.dispatchEvent(
					new MouseEvent("dblclick", {
						bubbles: true,
						cancelable: true,
					}),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.inlineDeltas()).toEqual([
				{ insert: "AAda <ada@example.com>B" },
			]);
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 22 },
				focus: { blockId, offset: 22 },
			});
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("shows a Pen-owned preview and renderer drag state while dragging an inline atom", async () => {
		const editor = createPresetEditor();
		seedInlineAtomDocument(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const documentWithCaret = document as Document & {
			caretPositionFromPoint?: (
				x: number,
				y: number,
			) => CaretPosition | null;
			elementFromPoint?: (x: number, y: number) => Element | null;
		};
		const originalCaretPositionFromPoint =
			documentWithCaret.caretPositionFromPoint;
		const originalElementFromPoint = documentWithCaret.elementFromPoint;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inlineAtomInteractions={{ drag: true }}
						inlineAtomRenderers={{
							mention: ({ interaction, props, text }) => (
								<span
									data-dragging={
										interaction?.dragging ? "true" : "false"
									}
									data-testid="mention-renderer"
								>
									{props.label as string}:{text}
								</span>
							),
						}}
					>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
				await flushAnimationFrames(2);
			});

			const atom = container.querySelector(
				`[${DATA_ATTRS.inlineAtom}]`,
			) as HTMLElement | null;
			const inlineElement = container.querySelector(
				`[${DATA_ATTRS.inlineContent}]`,
			) as HTMLElement | null;
			const contentElement = container.querySelector(
				`[${DATA_ATTRS.editorContent}]`,
			) as HTMLElement | null;
			const renderedAtom = container.querySelector(
				"[data-testid='mention-renderer']",
			);
			expect(atom).not.toBeNull();
			expect(inlineElement).not.toBeNull();
			expect(contentElement).not.toBeNull();
			expect(renderedAtom?.getAttribute("data-dragging")).toBe("false");

			Object.defineProperty(atom!, "getBoundingClientRect", {
				configurable: true,
				value: () => new DOMRect(10, 10, 80, 24),
			});
			documentWithCaret.elementFromPoint = () => inlineElement;
			documentWithCaret.caretPositionFromPoint = () => ({
				offsetNode: inlineElement!.firstChild ?? inlineElement!,
				offset: 1,
				getClientRect: () => new DOMRect(40, 10, 0, 20),
			});

			await act(async () => {
				dispatchPointerEvent(atom!, "pointerdown", {
					button: 0,
					clientX: 20,
					clientY: 20,
					pointerId: 1,
				});
				dispatchPointerEvent(document, "pointermove", {
					clientX: 50,
					clientY: 24,
					pointerId: 1,
				});
				await flushAnimationFrames(2);
			});

			expect(atom?.hasAttribute(DATA_ATTRS.inlineAtomDragging)).toBe(
				true,
			);
			expect(renderedAtom?.getAttribute("data-dragging")).toBe("true");
			expect(
				document.querySelector(
					"[data-pen-inline-atom-drag-preview-root]",
				),
			).not.toBeNull();
			expect(contentElement?.hasAttribute(DATA_ATTRS.dropTarget)).toBe(
				true,
			);
			const dropCaret = container.querySelector(
				`[${DATA_ATTRS.dropCaret}]`,
			) as HTMLElement | null;
			expect(dropCaret).not.toBeNull();
			expect(dropCaret?.style.position).toBe("fixed");
			expect(dropCaret?.style.width).toBe(
				"var(--pen-drop-caret-width, 1px)",
			);
			expect(dropCaret?.style.background).toBe(
				"var(--pen-drop-caret-color, var(--pen-caret-color, currentColor))",
			);

			await act(async () => {
				dispatchPointerEvent(document, "pointercancel", {
					pointerId: 1,
				});
				await flushAnimationFrames(2);
			});

			expect(atom?.hasAttribute(DATA_ATTRS.inlineAtomDragging)).toBe(
				false,
			);
			expect(renderedAtom?.getAttribute("data-dragging")).toBe("false");
			expect(
				document.querySelector(
					"[data-pen-inline-atom-drag-preview-root]",
				),
			).toBeNull();
			expect(contentElement?.hasAttribute(DATA_ATTRS.dropTarget)).toBe(
				false,
			);
			expect(
				container.querySelector(`[${DATA_ATTRS.dropCaret}]`),
			).toBeNull();
		} finally {
			documentWithCaret.caretPositionFromPoint =
				originalCaretPositionFromPoint;
			documentWithCaret.elementFromPoint = originalElementFromPoint;
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});
