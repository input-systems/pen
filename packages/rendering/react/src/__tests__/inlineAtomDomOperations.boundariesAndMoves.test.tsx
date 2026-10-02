// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
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
	INLINE_ATOM_REPLACEMENT_TEXT,
} from "@input/pen-dom/field-editor/inlineAtomDom";
import {
	applyDeltaToDOM,
	fullReconcileDeltasToDOM,
} from "@input/pen-dom/field-editor/reconciler";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import {
	domPointToOffset,
	domSelectionToEditor,
	pointToEditorSelectionPoint,
} from "@input/pen-dom/field-editor/selectionBridge";
import { projectSelectionToDom } from "./utils/projectSelectionToDom";
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

describe("Pen inline atom DOM operations: boundaries and moves", () => {
	it("applies text deltas around inline atoms at logical boundaries", () => {
		const editor = createPresetEditor();
		const element = document.createElement("span");

		fullReconcileDeltasToDOM(
			[
				{ insert: "A" },
				{
					insert: {
						type: "mention",
						props: { id: "user-1", label: "Ada" },
					},
				},
				{ insert: "B" },
			],
			element,
			editor.schema,
			{ editor },
		);

		const atom = element.querySelector(
			`[${DATA_ATTRS.inlineAtom}]`,
		) as HTMLElement | null;
		expect(atom).not.toBeNull();

		expect(
			applyDeltaToDOM(
				[{ retain: 2 }, { insert: "C" }],
				element,
				editor.schema,
			),
		).toBe(true);
		expect(getLogicalTextContent(element)).toBe(
			`A${INLINE_ATOM_REPLACEMENT_TEXT}CB`,
		);
		expect(getInlineAtomElementData(atom!)).toEqual({
			type: "mention",
			props: { id: "user-1", label: "Ada" },
			text: "@Ada",
		});
		expect(atom?.textContent).toBe("@Ada");

		expect(
			applyDeltaToDOM(
				[{ retain: 1 }, { delete: 1 }],
				element,
				editor.schema,
			),
		).toBe(true);
		expect(getLogicalTextContent(element)).toBe("ACB");
		expect(atom?.isConnected).toBe(false);

		editor.destroy();
	});

	it("resolves inline-container tail clicks after an atom to the logical end", () => {
		const blockId = "atom-block";
		const container = document.createElement("div");
		container.setAttribute(DATA_ATTRS.editorRoot, "");
		const block = document.createElement("div");
		block.setAttribute(DATA_ATTRS.editorBlock, "");
		block.setAttribute(DATA_ATTRS.blockId, blockId);
		block.setAttribute(DATA_ATTRS.blockType, "paragraph");
		const inlineElement = document.createElement("span");
		inlineElement.setAttribute(DATA_ATTRS.inlineContent, "");
		const atom = document.createElement("span");
		atom.setAttribute(DATA_ATTRS.inlineAtom, "");
		atom.setAttribute(DATA_ATTRS.inlineAtomType, "mention");
		atom.contentEditable = "false";
		atom.textContent = "Ada";

		inlineElement.appendChild(atom);
		block.appendChild(inlineElement);
		container.appendChild(block);
		document.body.appendChild(container);

		Object.defineProperty(inlineElement, "getBoundingClientRect", {
			configurable: true,
			value: () => new DOMRect(0, 0, 200, 20),
		});

		const documentWithCaret = document as Document & {
			caretPositionFromPoint?: (
				x: number,
				y: number,
			) => CaretPosition | null;
		};
		const originalCaretPositionFromPoint =
			documentWithCaret.caretPositionFromPoint;
		const originalCreateRange = document.createRange.bind(document);

		documentWithCaret.caretPositionFromPoint = () => ({
			offsetNode: inlineElement,
			offset: 0,
			getClientRect: () => new DOMRect(0, 0, 0, 20),
		});
		document.createRange = () => {
			const range = originalCreateRange();
			const originalSetStart = range.setStart.bind(range);
			let startContainer: Node | null = null;
			let startOffset = 0;
			range.setStart = (node: Node, offset: number) => {
				startContainer = node;
				startOffset = offset;
				originalSetStart(node, offset);
			};
			(
				range as Range & { getBoundingClientRect: () => DOMRect }
			).getBoundingClientRect = () => {
				if (startContainer === inlineElement && startOffset === 0) {
					return new DOMRect(0, 0, 80, 20);
				}
				return new DOMRect(80, 0, 0, 20);
			};
			return range;
		};

		try {
			expect(pointToEditorSelectionPoint(container, 160, 10)).toEqual({
				blockId,
				offset: 1,
			});
		} finally {
			documentWithCaret.caretPositionFromPoint =
				originalCaretPositionFromPoint;
			document.createRange = originalCreateRange;
			container.remove();
		}
	});

	it("resolves inline-wrapper tail clicks after an atom to the logical end", () => {
		const blockId = "atom-block";
		const container = document.createElement("div");
		container.setAttribute(DATA_ATTRS.editorRoot, "");
		const block = document.createElement("div");
		block.setAttribute(DATA_ATTRS.editorBlock, "");
		block.setAttribute(DATA_ATTRS.blockId, blockId);
		block.setAttribute(DATA_ATTRS.blockType, "paragraph");
		const wrapper = document.createElement("div");
		wrapper.setAttribute(DATA_ATTRS.blockType, "paragraph");
		const inlineElement = document.createElement("span");
		inlineElement.setAttribute(DATA_ATTRS.inlineContent, "");
		const atom = document.createElement("span");
		atom.setAttribute(DATA_ATTRS.inlineAtom, "");
		atom.setAttribute(DATA_ATTRS.inlineAtomType, "mention");
		atom.contentEditable = "false";
		atom.textContent = "Ada";

		inlineElement.appendChild(atom);
		wrapper.appendChild(inlineElement);
		block.appendChild(wrapper);
		container.appendChild(block);
		document.body.appendChild(container);

		Object.defineProperty(inlineElement, "getBoundingClientRect", {
			configurable: true,
			value: () => new DOMRect(0, 0, 200, 20),
		});

		const documentWithCaret = document as Document & {
			caretPositionFromPoint?: (
				x: number,
				y: number,
			) => CaretPosition | null;
		};
		const originalCaretPositionFromPoint =
			documentWithCaret.caretPositionFromPoint;
		const originalCreateRange = document.createRange.bind(document);

		documentWithCaret.caretPositionFromPoint = () => ({
			offsetNode: wrapper,
			offset: 0,
			getClientRect: () => new DOMRect(0, 0, 0, 20),
		});
		document.createRange = () => {
			const range = originalCreateRange();
			const originalSetStart = range.setStart.bind(range);
			let startContainer: Node | null = null;
			let startOffset = 0;
			range.setStart = (node: Node, offset: number) => {
				startContainer = node;
				startOffset = offset;
				originalSetStart(node, offset);
			};
			(
				range as Range & { getBoundingClientRect: () => DOMRect }
			).getBoundingClientRect = () => {
				if (startContainer === inlineElement && startOffset === 0) {
					return new DOMRect(0, 0, 80, 20);
				}
				return new DOMRect(80, 0, 0, 20);
			};
			return range;
		};

		try {
			expect(pointToEditorSelectionPoint(container, 160, 10)).toEqual({
				blockId,
				offset: 1,
			});
		} finally {
			documentWithCaret.caretPositionFromPoint =
				originalCaretPositionFromPoint;
			document.createRange = originalCreateRange;
			container.remove();
		}
	});

	it("moves an inline atom within one editor", () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);

		try {
			expect(
				moveInlineAtom({
					source: { editor, blockId, offset: 1 },
					target: { editor, blockId, offset: 3 },
				}),
			).toBe(true);
			expect(editor.getBlock(blockId)?.inlineDeltas()).toEqual([
				{ insert: "AB" },
				{
					insert: {
						type: "mention",
						props: { id: "user-1", label: "Ada" },
					},
				},
			]);
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 3 },
			});
		} finally {
			editor.destroy();
		}
	});

	it("moves an inline atom between compatible editors", () => {
		const sourceEditor = createPresetEditor();
		const targetEditor = createPresetEditor();
		const sourceBlockId = seedInlineAtomDocument(sourceEditor);
		const targetBlockId = targetEditor.firstBlock()!.id;
		targetEditor.apply([
			{
				type: "splice-text",
				blockId: targetBlockId,
				from: 0,
				to: 0,
				insert: "Z",
			},
		]);

		try {
			expect(
				moveInlineAtom({
					source: {
						editor: sourceEditor,
						blockId: sourceBlockId,
						offset: 1,
					},
					target: {
						editor: targetEditor,
						blockId: targetBlockId,
						offset: 1,
					},
				}),
			).toBe(true);
			expect(
				sourceEditor.getBlock(sourceBlockId)?.inlineDeltas(),
			).toEqual([{ insert: "AB" }]);
			expect(
				targetEditor.getBlock(targetBlockId)?.inlineDeltas(),
			).toEqual([
				{ insert: "Z" },
				{
					insert: {
						type: "mention",
						props: { id: "user-1", label: "Ada" },
					},
				},
			]);
			expect(targetEditor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: targetBlockId, offset: 2 },
			});
		} finally {
			sourceEditor.destroy();
			targetEditor.destroy();
		}
	});

	it("rejects cross-editor moves when the target schema does not support the atom", () => {
		const sourceEditor = createPresetEditor();
		const targetEditor = createEditor({
			schema: createDefaultSchema().without(["mention"]),
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const sourceBlockId = seedInlineAtomDocument(sourceEditor);
		const targetBlockId = targetEditor.firstBlock()!.id;

		try {
			expect(
				moveInlineAtom({
					source: {
						editor: sourceEditor,
						blockId: sourceBlockId,
						offset: 1,
					},
					target: {
						editor: targetEditor,
						blockId: targetBlockId,
						offset: 0,
					},
				}),
			).toBe(false);
			expect(
				sourceEditor.getBlock(sourceBlockId)?.inlineDeltas(),
			).toEqual([
				{ insert: "A" },
				{
					insert: {
						type: "mention",
						props: { id: "user-1", label: "Ada" },
					},
				},
				{ insert: "B" },
			]);
			expect(
				targetEditor.getBlock(targetBlockId)?.inlineDeltas(),
			).toEqual([]);
		} finally {
			sourceEditor.destroy();
			targetEditor.destroy();
		}
	});

	it("destructures an inline atom into selected editable text", () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);

		try {
			expect(
				replaceInlineAtomWithText({
					source: { editor, blockId, offset: 1 },
					text: "Ada Lovelace <ada@example.com>",
					selection: "all",
				}),
			).toBe(true);
			expect(editor.getBlock(blockId)?.inlineDeltas()).toEqual([
				{ insert: "AAda Lovelace <ada@example.com>B" },
			]);
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 1 },
				focus: { blockId, offset: 31 },
			});
		} finally {
			editor.destroy();
		}
	});
});
