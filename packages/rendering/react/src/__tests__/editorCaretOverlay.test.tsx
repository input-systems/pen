// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor, fieldEditorHostFacet } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { PenEditor } from "../penEditor";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react editor caret overlay", () => {
	it("uses macOS caret defaults when requested", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
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
		let caretStyle: React.CSSProperties | null = null;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.Editor.CaretOverlay
							variant={Pen.Editor.CARET.MACOS}
							renderCaret={(props) => {
								caretStyle = props.caretStyle;
								return (
									<div
										{...props.attributes}
										style={props.caretStyle}
									/>
								);
							}}
						/>
					</Pen.Editor.Root>,
				);
			});

			const fieldEditor = getFieldEditor(editor);
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as HTMLElement | null;
			expect(inlineElement).not.toBeNull();
			if (!inlineElement) {
				throw new Error("Missing inline content element");
			}

			const overlayElement = container.querySelector(
				"[data-pen-editor-caret-overlay]",
			) as HTMLElement | null;
			expect(overlayElement).not.toBeNull();
			if (!overlayElement) {
				throw new Error("Missing caret overlay element");
			}

			Object.defineProperty(inlineElement, "getBoundingClientRect", {
				configurable: true,
				value: () => new DOMRect(24, 32, 240, 24),
			});
			Object.defineProperty(overlayElement, "getBoundingClientRect", {
				configurable: true,
				value: () => new DOMRect(100, 200, 320, 48),
			});

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 2, 2);
				inlineElement.dispatchEvent(
					new Event("focusin", { bubbles: true }),
				);
			});

			const resolvedCaretStyle = caretStyle as React.CSSProperties | null;
			expect(resolvedCaretStyle?.position).toBe("absolute");
			expect(resolvedCaretStyle?.left).toBe("-76px");
			expect(resolvedCaretStyle?.top).toBe("-168px");
			expect(resolvedCaretStyle?.height).toBe("24px");
			expect(resolvedCaretStyle?.width).toBe(
				"var(--pen-editor-caret-width, var(--pen-caret-width, 2px))",
			);
			expect(resolvedCaretStyle?.borderRadius).toBe(
				"var(--pen-editor-caret-radius, var(--pen-caret-radius, 999px))",
			);
			expect(resolvedCaretStyle?.background).toBe(
				"var(--pen-editor-caret-color, var(--pen-caret-color, var(--palette-blue, #0a84ff)))",
			);
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("keeps the convenience PenEditor API opt-in", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
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

		try {
			await act(async () => {
				root.render(<PenEditor editor={editor} />);
			});

			const fieldEditor = getFieldEditor(editor);
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as HTMLElement | null;
			if (!inlineElement) {
				throw new Error("Missing inline content element");
			}

			Object.defineProperty(inlineElement, "getBoundingClientRect", {
				configurable: true,
				value: () => new DOMRect(24, 32, 240, 24),
			});

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 2, 2);
				inlineElement.dispatchEvent(
					new Event("focusin", { bubbles: true }),
				);
			});

			expect(
				container.querySelector("[data-pen-editor-caret]"),
			).toBeNull();

			await act(async () => {
				root.render(<PenEditor editor={editor} customCaret />);
			});

			expect(
				container.querySelector("[data-pen-editor-caret]"),
			).not.toBeNull();
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});

function getFieldEditor(editor: ReturnType<typeof createEditor>) {
	const fieldEditor = editor.facet(fieldEditorHostFacet) as {
		activateTextSelection(
			blockId: string,
			anchorOffset: number,
			focusOffset: number,
		): void;
	} | null;
	if (!fieldEditor) {
		throw new Error("Missing attached field editor");
	}
	return fieldEditor;
}
