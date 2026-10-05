// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { domSelectionToEditor } from "@input/pen-dom/field-editor/selectionBridge";
import { defaultSchema } from "@input/pen-schema";
import { Pen } from "../primitives/index";
import {
	createEditor,
	flushAnimationFrames,
	getFieldEditor,
} from "./utils/selectionDeletionTestHelpers";

describe("@input/pen-react field editor focus()", () => {
	it("S1: focus() without a caret in the field commits one to the authority and projects it", async () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
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

		await act(async () => {
			fieldEditor.activate(blockId);
			editor.setSelection(null);
			await flushAnimationFrames(2);
		});
		let focused = false;
		await act(async () => {
			focused = fieldEditor.focus();
			await flushAnimationFrames(2);
		});

		expect(focused).toBe(true);
		const caret = { blockId, offset: 5 };
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: caret,
			focus: caret,
		});
		const editorRoot = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement;
		expect(domSelectionToEditor(editorRoot)).toEqual({
			anchor: caret,
			focus: caret,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
