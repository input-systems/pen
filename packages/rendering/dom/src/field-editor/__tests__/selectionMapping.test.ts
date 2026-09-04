// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import * as selectionBridge from "../selectionBridge";
import { pointToEditorSelectionPoint } from "../selectionBridge";
import {
	domPointToOffset,
	domSelectionToEditor,
	getBlockBoundaryPoint,
} from "../selectionMapping";

const BRIDGE_VALUE_EXPORTS = [
	"computeTextDiff",
	"domPointToOffset",
	"domSelectionToEditor",
	"editorSelectionToDOM",
	"extractTextFromDOM",
	"findBlockElement",
	"findInlineContentElement",
	"getBlockBoundaryPoint",
	"getCaretOffset",
	"getClosestBlockElementFromPoint",
	"getDirectionalSelectionOffsets",
	"getSelectionOffsets",
	"getSelectionPointForBlockAtPointer",
	"getTextSelectionClientRects",
	"pointToEditorSelectionPoint",
	"queryBlockElement",
	"queryInlineElement",
] as const;

const SELECTION_POINT_RECT = ["get", "Selection", "Point", "Rect"].join("");

interface BlockOptions {
	blockId: string;
	text?: string;
	blockType?: string;
	surfaceRole?: string;
	includeInline?: boolean;
}

function appendBlock(
	root: HTMLElement,
	options: BlockOptions,
): { block: HTMLElement; inline: HTMLElement | null } {
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, options.blockId);
	if (options.blockType) {
		block.setAttribute(DATA_ATTRS.blockType, options.blockType);
	}
	if (options.surfaceRole) {
		block.setAttribute(DATA_ATTRS.surfaceRole, options.surfaceRole);
	}
	let inline: HTMLElement | null = null;
	if (options.includeInline !== false) {
		inline = document.createElement("span");
		inline.setAttribute(DATA_ATTRS.inlineContent, "");
		inline.textContent = options.text ?? "";
		block.append(inline);
	} else if (options.text) {
		block.textContent = options.text;
	}
	root.append(block);
	return { block, inline };
}

function mountBlock(options: BlockOptions): {
	root: HTMLElement;
	block: HTMLElement;
	inline: HTMLElement | null;
} {
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	const { block, inline } = appendBlock(root, options);
	document.body.append(root);
	return { root, block, inline };
}

describe("selectionBridge published value exports", () => {
	it("keeps the same value-export names and re-exports mapping by identity", () => {
		expect(Object.keys(selectionBridge).sort()).toEqual(
			[...BRIDGE_VALUE_EXPORTS, SELECTION_POINT_RECT].sort(),
		);
		expect(selectionBridge.domPointToOffset).toBe(domPointToOffset);
		expect(selectionBridge.getBlockBoundaryPoint).toBe(
			getBlockBoundaryPoint,
		);
		expect(selectionBridge.domSelectionToEditor).toBe(domSelectionToEditor);
	});
});

describe("domPointToOffset", () => {
	it("maps a text-node endpoint to a character offset", () => {
		const { root, inline } = mountBlock({
			blockId: "p1",
			text: "Hello",
		});
		try {
			const text = inline!.firstChild as Text;
			expect(domPointToOffset(inline!, text, 0)).toBe(0);
			expect(domPointToOffset(inline!, text, 5)).toBe(5);
			expect(domPointToOffset(inline!, text, 2)).toBe(2);
		} finally {
			root.remove();
		}
	});

	it("maps a child-index point on the inline container", () => {
		const { root, inline } = mountBlock({
			blockId: "p1",
			text: "Hi",
		});
		try {
			expect(domPointToOffset(inline!, inline!, 0)).toBe(0);
			expect(domPointToOffset(inline!, inline!, 1)).toBe(2);
		} finally {
			root.remove();
		}
	});

	it("still resolves when the target node is outside the container", () => {
		const { root, inline } = mountBlock({
			blockId: "p1",
			text: "Hello",
		});
		const outsider = document.createTextNode("x");
		document.body.append(outsider);
		try {
			expect(domPointToOffset(inline!, outsider, 0)).toBe(
				inline!.textContent?.length ?? 0,
			);
		} finally {
			outsider.remove();
			root.remove();
		}
	});

	it("maps a mark-wrapper endpoint the same as the enclosed text node", () => {
		const { root, inline } = mountBlock({
			blockId: "p1",
			text: "",
		});
		try {
			const mark = document.createElement("strong");
			const text = document.createTextNode("ab");
			mark.append(text);
			inline!.append(mark);
			expect(domPointToOffset(inline!, mark, 0)).toBe(0);
			expect(domPointToOffset(inline!, mark, 1)).toBe(2);
			expect(domPointToOffset(inline!, text, 1)).toBe(1);
		} finally {
			root.remove();
		}
	});
});

describe("getBlockBoundaryPoint", () => {
	it("returns start and end offsets for an editable-inline block", () => {
		const { root } = mountBlock({
			blockId: "p1",
			text: "Hello",
			blockType: "paragraph",
		});
		try {
			expect(getBlockBoundaryPoint(root, "p1", "start")).toEqual({
				blockId: "p1",
				offset: 0,
			});
			expect(getBlockBoundaryPoint(root, "p1", "end")).toEqual({
				blockId: "p1",
				offset: 5,
			});
		} finally {
			root.remove();
		}
	});

	it("returns null when the block is missing", () => {
		const { root } = mountBlock({
			blockId: "p1",
			text: "Hello",
		});
		try {
			expect(getBlockBoundaryPoint(root, "missing", "start")).toBeNull();
		} finally {
			root.remove();
		}
	});

	it("clamps structural blocks to the 0..1 selection length", () => {
		const { root } = mountBlock({
			blockId: "d1",
			blockType: "divider",
			includeInline: false,
		});
		try {
			expect(getBlockBoundaryPoint(root, "d1", "start")).toEqual({
				blockId: "d1",
				offset: 0,
			});
			expect(getBlockBoundaryPoint(root, "d1", "end")).toEqual({
				blockId: "d1",
				offset: 1,
			});
		} finally {
			root.remove();
		}
	});

	it("does not treat a DOM U+200B as the empty-block sentinel", () => {
		const { root } = mountBlock({
			blockId: "p1",
			text: "\u200B",
			blockType: "paragraph",
		});
		try {
			expect(getBlockBoundaryPoint(root, "p1", "end")).toEqual({
				blockId: "p1",
				offset: 1,
			});
		} finally {
			root.remove();
		}
	});
});

describe("pointToEditorSelectionPoint", () => {
	function stubRect(element: HTMLElement, top: number, bottom: number): void {
		element.getBoundingClientRect = () =>
			({
				top,
				bottom,
				left: 0,
				right: 200,
				width: 200,
				height: bottom - top,
				x: 0,
				y: top,
			}) as DOMRect;
	}

	function mountTwoBlocks(): { root: HTMLElement } {
		const { root, block: first } = mountBlock({
			blockId: "p1",
			text: "Hello",
			blockType: "paragraph",
		});
		const { block: last } = appendBlock(root, {
			blockId: "p2",
			text: "World",
			blockType: "paragraph",
		});
		stubRect(first, 100, 120);
		stubRect(last, 130, 150);
		return { root };
	}

	it("snaps a point above the document to the first block start (G4)", () => {
		const { root } = mountTwoBlocks();
		try {
			expect(pointToEditorSelectionPoint(root, 150, 40)).toEqual({
				blockId: "p1",
				offset: 0,
			});
		} finally {
			root.remove();
		}
	});

	it("snaps a point below the document to the last block end (G4)", () => {
		const { root } = mountTwoBlocks();
		try {
			expect(pointToEditorSelectionPoint(root, 150, 400)).toEqual({
				blockId: "p2",
				offset: 5,
			});
		} finally {
			root.remove();
		}
	});

	it("keeps x-based resolution for a point between two blocks", () => {
		const { root } = mountTwoBlocks();
		try {
			const point = pointToEditorSelectionPoint(root, 0, 125);
			expect(point?.blockId).toBe("p1");
			expect(point?.offset).not.toBe(5);
		} finally {
			root.remove();
		}
	});
});

describe("editorSelectionToDOM", () => {
	function mountParagraphThenStructural(): {
		root: HTMLElement;
		paragraphText: Text;
		structural: HTMLElement;
	} {
		const root = document.createElement("div");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		const { inline } = appendBlock(root, {
			blockId: "p1",
			text: "Hello",
			blockType: "paragraph",
		});
		const { block: structural } = appendBlock(root, {
			blockId: "d1",
			blockType: "divider",
			includeInline: false,
		});
		document.body.append(root);
		return {
			root,
			paragraphText: inline!.firstChild as Text,
			structural,
		};
	}

	it("spans a structural tail block whose 0..1 extent has no text position", () => {
		const { root, paragraphText, structural } =
			mountParagraphThenStructural();
		try {
			selectionBridge.editorSelectionToDOM(
				root,
				{ blockId: "p1", offset: 0 },
				{ blockId: "d1", offset: 1 },
			);

			const selection = window.getSelection()!;
			expect(selection.rangeCount).toBe(1);
			const range = selection.getRangeAt(0);
			expect(range.collapsed).toBe(false);
			expect(range.startContainer).toBe(paragraphText);
			expect(range.startOffset).toBe(0);
			expect(range.intersectsNode(structural)).toBe(true);
		} finally {
			root.remove();
		}
	});

	it("stops before a structural block selected from its start", () => {
		const { root, structural } = mountParagraphThenStructural();
		try {
			selectionBridge.editorSelectionToDOM(
				root,
				{ blockId: "p1", offset: 0 },
				{ blockId: "d1", offset: 0 },
			);

			const range = window.getSelection()!.getRangeAt(0);
			expect(range.collapsed).toBe(false);
			expect(range.intersectsNode(structural)).toBe(false);
		} finally {
			root.remove();
		}
	});

	function mountParagraphThenOpenedContainer(): {
		root: HTMLElement;
		paragraphText: Text;
		container: HTMLElement;
		nestedBlock: HTMLElement;
		nestedInline: HTMLElement;
		nestedText: Text;
	} {
		const root = document.createElement("div");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		const { inline } = appendBlock(root, {
			blockId: "p1",
			text: "Hello",
			blockType: "paragraph",
		});
		const { block: container } = appendBlock(root, {
			blockId: "quote",
			blockType: "emailQuote",
			includeInline: false,
			surfaceRole: "structural",
		});
		const { block: nestedBlock, inline: nestedInline } = appendBlock(
			container,
			{
				blockId: "q1",
				text: "Quoted",
				blockType: "paragraph",
			},
		);
		document.body.append(root);
		return {
			root,
			paragraphText: inline!.firstChild as Text,
			container,
			nestedBlock,
			nestedInline: nestedInline!,
			nestedText: nestedInline!.firstChild as Text,
		};
	}

	it("spans a container whose only inline lives on a nested child (N2, D6, O4)", () => {
		const { root, paragraphText, container, nestedText } =
			mountParagraphThenOpenedContainer();
		try {
			expect(
				selectionBridge.findInlineContentElement(container),
			).toBeNull();

			selectionBridge.editorSelectionToDOM(
				root,
				{ blockId: "p1", offset: 0 },
				{ blockId: "quote", offset: 1 },
			);

			const range = window.getSelection()!.getRangeAt(0);
			expect(range.collapsed).toBe(false);
			expect(range.startContainer).toBe(paragraphText);
			expect(range.startOffset).toBe(0);
			expect(range.endContainer).not.toBe(nestedText);
			expect(range.intersectsNode(container)).toBe(true);
			expect(range.intersectsNode(nestedText)).toBe(true);
		} finally {
			root.remove();
		}
	});

	it("still maps a nested child's own block into that child's text", () => {
		const { root, nestedBlock, nestedInline, nestedText } =
			mountParagraphThenOpenedContainer();
		try {
			expect(selectionBridge.findInlineContentElement(nestedBlock)).toBe(
				nestedInline,
			);

			selectionBridge.editorSelectionToDOM(
				root,
				{ blockId: "q1", offset: 0 },
				{ blockId: "q1", offset: 6 },
			);

			const range = window.getSelection()!.getRangeAt(0);
			expect(range.startContainer).toBe(nestedText);
			expect(range.startOffset).toBe(0);
			expect(range.endContainer).toBe(nestedText);
			expect(range.endOffset).toBe(6);
		} finally {
			root.remove();
		}
	});
});
