// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { createDefaultSchema } from "@input/pen-schema";
import {
	moveInlineAtom,
	replaceInlineAtomWithText,
} from "@input/pen-dom/field-editor/inlineAtomInteraction";
import {
	getInlineAtomElementData,
	getLogicalTextContent,
	getLogicalNodeLength,
	INLINE_ATOM_REPLACEMENT_TEXT,
	findLogicalDOMPoint,
	isInlineAtomCaretBoundaryNode,
	isInlineAtomHostNode,
} from "@input/pen-dom/field-editor/inlineAtomDom";
import {
	applyDeltaToDOM,
	fullReconcileDeltasToDOM,
} from "@input/pen-dom/field-editor/reconciler";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import {
	domPointToOffset,
	domSelectionToEditor,
	getSelectionOffsets,
	pointToEditorSelectionPoint,
} from "@input/pen-dom/field-editor/selectionBridge";
import { projectSelectionToDom } from "./utils/projectSelectionToDom";
import { handleFieldEditorKeyDown } from "@input/pen-dom/field-editor/keyHandling";
import { Pen } from "../primitives/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

function createPresetEditor() {
	return createEditor({
		schema: createDefaultSchema(),
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

function seedInlineAtomDocument(editor: ReturnType<typeof createPresetEditor>) {
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "A" },
		{
			type: "splice-text",
			blockId,
			from: 1,
			to: 1,
			insert: {
				nodeType: "mention",
				props: { id: "user-1", label: "Ada" },
			},
		},
		{ type: "splice-text", blockId, from: 2, to: 2, insert: "B" },
	]);
	return blockId;
}

function dispatchPointerEvent(
	target: EventTarget,
	type: string,
	options: MouseEventInit & { pointerId?: number } = {},
) {
	const PointerEventCtor = window.PointerEvent ?? MouseEvent;
	target.dispatchEvent(
		new PointerEventCtor(type, {
			bubbles: true,
			cancelable: true,
			...options,
		}) as PointerEvent,
	);
}

function createRect({
	left,
	right,
	top,
	bottom,
}: {
	left: number;
	right: number;
	top: number;
	bottom: number;
}): DOMRect {
	return {
		x: left,
		y: top,
		left,
		right,
		top,
		bottom,
		width: right - left,
		height: bottom - top,
		toJSON() {
			return {};
		},
	} as DOMRect;
}

describe("Pen inline atom editing: focus policy and selection projection", () => {
	it("maps atom-only pointer positions by chip geometry", () => {
		const root = document.createElement("div");
		const block = document.createElement("div");
		const inline = document.createElement("span");
		const atom = document.createElement("span");
		const originalElementFromPoint = document.elementFromPoint;

		block.setAttribute(DATA_ATTRS.editorBlock, "");
		block.setAttribute(DATA_ATTRS.blockId, "block-1");
		block.setAttribute(DATA_ATTRS.blockType, "paragraph");
		inline.setAttribute(DATA_ATTRS.inlineContent, "");
		atom.setAttribute(DATA_ATTRS.inlineAtom, "");
		atom.textContent = "Ada";
		inline.appendChild(atom);
		block.appendChild(inline);
		root.appendChild(block);
		document.body.appendChild(root);

		inline.getBoundingClientRect = () =>
			createRect({ left: 0, right: 120, top: 0, bottom: 24 });
		atom.getBoundingClientRect = () =>
			createRect({ left: 20, right: 80, top: 0, bottom: 24 });
		document.elementFromPoint = vi.fn(() => atom);

		try {
			expect(pointToEditorSelectionPoint(root, 25, 12)).toEqual({
				blockId: "block-1",
				offset: 0,
			});
			expect(pointToEditorSelectionPoint(root, 76, 12)).toEqual({
				blockId: "block-1",
				offset: 1,
			});
		} finally {
			document.elementFromPoint = originalElementFromPoint;
			root.remove();
		}
	});

	it("denies backend attachment when the focus policy rejects activation", () => {
		const editor = createPresetEditor();
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = new FieldEditorImpl(editor, {
			focusPolicy: {
				decide: (request) =>
					request.action === "attach-backend"
						? { type: "deny" }
						: { type: "allow" },
			},
		});
		const root = document.createElement("div");
		const block = document.createElement("div");
		const inline = document.createElement("span");
		const focusSpy = vi.spyOn(inline, "focus");

		block.setAttribute(DATA_ATTRS.editorBlock, "");
		block.setAttribute(DATA_ATTRS.blockId, blockId);
		block.setAttribute(DATA_ATTRS.blockType, "paragraph");
		inline.setAttribute(DATA_ATTRS.inlineContent, "");
		block.appendChild(inline);
		root.appendChild(block);
		document.body.appendChild(root);
		fieldEditor.setRootElement(root);

		try {
			fieldEditor.activate(blockId);

			expect(
				(
					fieldEditor as unknown as {
						_attachedElement: HTMLElement | null;
					}
				)._attachedElement,
			).toBeNull();
			expect(focusSpy).not.toHaveBeenCalled();
		} finally {
			fieldEditor.destroy();
			root.remove();
			editor.destroy();
		}
	});

	it("uses focusPolicy decisions for passive selection projection", () => {
		const editor = createPresetEditor();
		const blockId = editor.firstBlock()!.id;
		const decide = vi.fn(() => ({ type: "allow-passive" as const }));
		const fieldEditor = new FieldEditorImpl(editor, {
			focusPolicy: {
				decide,
			},
		});
		const root = document.createElement("div");
		const block = document.createElement("div");
		const inline = document.createElement("span");
		const focusSpy = vi.spyOn(inline, "focus");

		block.setAttribute(DATA_ATTRS.editorBlock, "");
		block.setAttribute(DATA_ATTRS.blockId, blockId);
		block.setAttribute(DATA_ATTRS.blockType, "paragraph");
		inline.setAttribute(DATA_ATTRS.inlineContent, "");
		block.appendChild(inline);
		root.appendChild(block);
		document.body.appendChild(root);
		fieldEditor.setRootElement(root);

		try {
			fieldEditor.activate(blockId);
			expect(
				fieldEditor.requestDomFocus(inline, "selection-project"),
			).toBe(true);
			expect(focusSpy).not.toHaveBeenCalled();
			expect(decide).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "attach-backend",
					blockId,
				}),
			);
			expect(decide).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "project-selection",
					blockId,
				}),
			);
		} finally {
			fieldEditor.destroy();
			root.remove();
			editor.destroy();
		}
	});

	it("does not let a stale pending programmatic caret hide a newer user caret", async () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const fieldEditor = new FieldEditorImpl(editor);
		const block = editor.getBlock(blockId)!;
		const endOffset = block.length();

		try {
			fieldEditor.commitProgrammaticTextSelection(blockId, 0, 0);
			fieldEditor.applyDomTextSelection(
				{ blockId, offset: endOffset },
				{ blockId, offset: endOffset },
			);

			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: endOffset },
				focus: { blockId, offset: endOffset },
			});
			await flushAnimationFrames(1);
		} finally {
			fieldEditor.destroy();
			editor.destroy();
		}
	});

	it("projects activated text selections before the next input event can use a stale DOM range", () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const fieldEditor = new FieldEditorImpl(editor);
		const block = editor.getBlock(blockId)!;
		const endOffset = block.length();
		const root = document.createElement("div");
		const blockElement = document.createElement("div");
		const inlineElement = document.createElement("span");

		root.setAttribute(DATA_ATTRS.editorRoot, "");
		blockElement.setAttribute(DATA_ATTRS.editorBlock, "");
		blockElement.setAttribute(DATA_ATTRS.blockId, blockId);
		blockElement.setAttribute(DATA_ATTRS.blockType, "paragraph");
		inlineElement.setAttribute(DATA_ATTRS.inlineContent, "");
		fullReconcileDeltasToDOM(
			block.inlineDeltas() as unknown as Parameters<
				typeof fullReconcileDeltasToDOM
			>[0],
			inlineElement,
			editor.schema,
			{ editor },
		);
		blockElement.appendChild(inlineElement);
		root.appendChild(blockElement);
		document.body.appendChild(root);
		fieldEditor.setRootElement(root);

		try {
			fieldEditor.activate(blockId);
			projectSelectionToDom(
				root,
				{ blockId, offset: 0 },
				{ blockId, offset: 0 },
			);
			expect(getSelectionOffsets(inlineElement)).toEqual({
				start: 0,
				end: 0,
			});

			fieldEditor.activateTextSelection(blockId, endOffset, endOffset);

			expect(getSelectionOffsets(inlineElement)).toEqual({
				start: endOffset,
				end: endOffset,
			});
		} finally {
			fieldEditor.destroy();
			root.remove();
			editor.destroy();
		}
	});

	it("projects activated inline atom range selections synchronously", () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const fieldEditor = new FieldEditorImpl(editor);
		const block = editor.getBlock(blockId)!;
		const root = document.createElement("div");
		const blockElement = document.createElement("div");
		const inlineElement = document.createElement("span");

		root.setAttribute(DATA_ATTRS.editorRoot, "");
		blockElement.setAttribute(DATA_ATTRS.editorBlock, "");
		blockElement.setAttribute(DATA_ATTRS.blockId, blockId);
		blockElement.setAttribute(DATA_ATTRS.blockType, "paragraph");
		inlineElement.setAttribute(DATA_ATTRS.inlineContent, "");
		fullReconcileDeltasToDOM(
			block.inlineDeltas() as unknown as Parameters<
				typeof fullReconcileDeltasToDOM
			>[0],
			inlineElement,
			editor.schema,
			{ editor },
		);
		blockElement.appendChild(inlineElement);
		root.appendChild(blockElement);
		document.body.appendChild(root);
		fieldEditor.setRootElement(root);

		try {
			fieldEditor.activate(blockId);
			fieldEditor.activateTextSelection(blockId, 1, 2);

			expect(getSelectionOffsets(inlineElement)).toEqual({
				start: 1,
				end: 2,
			});
		} finally {
			fieldEditor.destroy();
			root.remove();
			editor.destroy();
		}
	});

	it("keeps programmatic focus after native focus reports a start caret", async () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const fieldEditor = new FieldEditorImpl(editor);
		const block = editor.getBlock(blockId)!;
		const root = document.createElement("div");
		const blockElement = document.createElement("div");
		const inlineElement = document.createElement("span");

		root.setAttribute(DATA_ATTRS.editorRoot, "");
		blockElement.setAttribute(DATA_ATTRS.editorBlock, "");
		blockElement.setAttribute(DATA_ATTRS.blockId, blockId);
		blockElement.setAttribute(DATA_ATTRS.blockType, "paragraph");
		inlineElement.setAttribute(DATA_ATTRS.inlineContent, "");
		fullReconcileDeltasToDOM(
			block.inlineDeltas() as unknown as Parameters<
				typeof fullReconcileDeltasToDOM
			>[0],
			inlineElement,
			editor.schema,
			{ editor },
		);
		blockElement.appendChild(inlineElement);
		root.appendChild(blockElement);
		document.body.appendChild(root);
		fieldEditor.setRootElement(root);

		try {
			await fieldEditor.focusTextSelection(blockId, 2, 2);
			projectSelectionToDom(
				root,
				{ blockId, offset: 0 },
				{ blockId, offset: 0 },
			);
			document.dispatchEvent(new Event("selectionchange"));
			await flushAnimationFrames(2);

			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 2 },
				focus: { blockId, offset: 2 },
			});
			expect(getSelectionOffsets(inlineElement)).toEqual({
				start: 2,
				end: 2,
			});
		} finally {
			fieldEditor.destroy();
			root.remove();
			editor.destroy();
		}
	});
});
