// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
	getInlineAtomElementData,
} from "@input/pen-dom/field-editor/inlineAtomDom";
import {
	fullReconcileDeltasToDOM,
} from "@input/pen-dom/field-editor/reconciler";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import {
	domPointToOffset,
	domSelectionToEditor,
} from "@input/pen-dom/field-editor/selectionBridge";
import { projectSelectionToDom } from "./utils/projectSelectionToDom";
import { Pen } from "../primitives/index";
import {
	createPresetEditor,
	flushAnimationFrames,
	seedInlineAtomDocument,
} from "./utils/inlineAtomTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Pen inline atom DOM operations: metadata and selection offsets", () => {
	it("refreshes inline atom metadata when reconciliation changes atom props", () => {
		const editor = createPresetEditor();
		const element = document.createElement("span");
		const firstDelta = [
			{ insert: "A" },
			{
				insert: {
					type: "mention",
					props: { id: "user-1", label: "Ada" },
				},
			},
			{ insert: "B" },
		];
		const secondDelta = [
			{ insert: "A" },
			{
				insert: {
					type: "mention",
					props: { id: "user-2", label: "Ada" },
				},
			},
			{ insert: "B" },
		];

		fullReconcileDeltasToDOM(firstDelta, element, editor.schema, {
			editor,
		});
		const firstAtom = element.querySelector(
			`[${DATA_ATTRS.inlineAtom}]`,
		) as HTMLElement | null;
		expect(getInlineAtomElementData(firstAtom!)).toEqual({
			type: "mention",
			props: { id: "user-1", label: "Ada" },
			text: "@Ada",
		});

		fullReconcileDeltasToDOM(secondDelta, element, editor.schema, {
			editor,
		});
		const secondAtom = element.querySelector(
			`[${DATA_ATTRS.inlineAtom}]`,
		) as HTMLElement | null;

		expect(secondAtom).not.toBe(firstAtom);
		expect(firstAtom?.isConnected).toBe(false);
		expect(getInlineAtomElementData(secondAtom!)).toEqual({
			type: "mention",
			props: { id: "user-2", label: "Ada" },
			text: "@Ada",
		});

		editor.destroy();
	});

	it("round-trips DOM selection offsets around inline atoms", async () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
				await flushAnimationFrames(2);
			});

			const rootElement = container.querySelector(
				`[${DATA_ATTRS.editorRoot}]`,
			) as HTMLElement | null;
			const inlineElement = container.querySelector(
				`[${DATA_ATTRS.inlineContent}]`,
			) as HTMLElement | null;
			expect(rootElement).not.toBeNull();
			expect(inlineElement).not.toBeNull();
			expect(domPointToOffset(inlineElement!, inlineElement!, 1)).toBe(1);
			expect(domPointToOffset(inlineElement!, inlineElement!, 2)).toBe(2);

			projectSelectionToDom(
				rootElement!,
				{ blockId, offset: 2 },
				{ blockId, offset: 2 },
			);

			expect(domSelectionToEditor(rootElement!)).toEqual({
				anchor: { blockId, offset: 2 },
				focus: { blockId, offset: 2 },
			});
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});
