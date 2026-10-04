// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import {
	createEditor,
	flushAnimationFrames,
	getFieldEditor,
} from "./utils/selectionDeletionTestHelpers";

describe("Pen.Editor.Root under React.StrictMode (HB2)", () => {
	it("keeps a live field editor through mount, cleanup, and remount", async () => {
		const editor = createEditor();
		const first = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId: first,
				from: 0,
				to: 0,
				insert: "one",
			},
			{
				type: "insert-block",
				blockId: "second",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "second",
				from: 0,
				to: 0,
				insert: "two",
			},
		]);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<React.StrictMode>
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>
				</React.StrictMode>,
			);
		});
		const fieldEditor = getFieldEditor(editor);

		const firstInline = container.querySelector(
			`[data-block-id="${first}"] [data-pen-inline-content]`,
		);
		await act(async () => {
			fieldEditor.activate(first);
			await flushAnimationFrames(2);
		});

		// P1: an authority write projects into the DOM selection.
		await act(async () => {
			editor.selectText(first, 2, 2, "programmatic");
			await flushAnimationFrames(2);
		});
		const projected = document.getSelection();
		expect(fieldEditor.focusBlockId).toBe(first);
		expect(firstInline?.contains(projected?.anchorNode ?? null)).toBe(true);
		expect(projected?.anchorOffset).toBe(2);

		// A remote edit to the active block reconciles into its DOM.
		await act(async () => {
			editor.apply(
				[
					{
						type: "splice-text",
						blockId: first,
						from: 3,
						to: 3,
						insert: "!",
					},
				],
				{ origin: "collaborator" },
			);
			await flushAnimationFrames(3);
		});
		expect(firstInline?.textContent).toBe("one!");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
