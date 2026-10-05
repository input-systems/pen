import { usesInlineTextSelection } from "@input/pen-core";
import type {
	Editor,
	FieldEditorFocusOptions,
	Point,
	SelectionOrigin,
} from "@input/pen-types";
import {
	getBlockBoundaryPoint,
	pointToEditorSelectionPoint,
} from "../field-editor/selectionBridge";
import { isInlineAtomChipNode } from "../field-editor/inlineAtomDom";
import { findInlineContentElement } from "../field-editor/selectionDomQueries";
import { getEditorBlockSelectionLength } from "../utils/blockSelectionSemantics";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { getPreorderBlockIds } from "../utils/documentPreorder";
import { normalizeSelectionFormation } from "../utils/selectionFormation";
import { closestDomElement, isDomHTMLElement } from "../utils/domNodes";

export interface FieldEditorPointerTarget {
	getSnapshot(): {
		isEditing: boolean;
		focusBlockId: string | null;
	};
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	attachElement(element: HTMLElement): void;
	/** A cross-block text range; a shift-click into another block extends through it. */
	applyDocumentTextSelection?(
		anchor: Point,
		focus: Point,
		origin: SelectionOrigin,
	): void;
}

export interface FieldEditorPointerActivateOptions {
	event: MouseEvent;
	editor: Editor;
	fieldEditor: FieldEditorPointerTarget;
	root: HTMLElement;
	blocksHost: HTMLElement;
	readonly?: boolean;
}

export function handleFieldEditorPointerActivate(
	options: FieldEditorPointerActivateOptions,
): boolean {
	const { event, editor, fieldEditor, root, blocksHost, readonly } = options;
	if (readonly === true || event.button !== 0) {
		return false;
	}

	const target = closestDomElement(event.target);
	if (!target) {
		return false;
	}
	const isHostChrome = isEditorHostChrome(target, root, blocksHost);
	if (!isHostChrome && !blocksHost.contains(target)) {
		return false;
	}
	if (target.closest(`[${DATA_ATTRS.ignorePointerGesture}]`)) {
		return false;
	}

	const owningRoot = target.closest(`[${DATA_ATTRS.editorRoot}]`);
	if (owningRoot && owningRoot !== root) {
		return false;
	}

	const clickedBlock = target.closest(`[${DATA_ATTRS.editorBlock}]`);
	const hostFallback =
		isDomHTMLElement(clickedBlock) && blocksHost.contains(clickedBlock)
			? null
			: resolveHostChromeFallbackBlock(event, editor, root, blocksHost);
	const blockElement =
		hostFallback?.element ??
		(isDomHTMLElement(clickedBlock) && blocksHost.contains(clickedBlock)
			? clickedBlock
			: null);
	if (!blockElement) {
		return false;
	}

	const blockId = blockElement.getAttribute(DATA_ATTRS.blockId);
	if (!blockId) {
		return false;
	}

	// A shift-click extends from the anchor whatever the clicked block is
	// (T5): on a block with no text position of its own (a divider, an
	// image) the focus is its edge, as the React content gestures form it.
	if (
		event.shiftKey &&
		!hostFallback &&
		extendSelectionToPointer({ event, editor, fieldEditor, root, blockId })
	) {
		event.preventDefault();
		return true;
	}

	const block = editor.getBlock(blockId);
	const schema = block ? editor.schema.resolve(block.type) : null;
	if (!usesInlineTextSelection(schema)) {
		return false;
	}

	const snapshot = fieldEditor.getSnapshot();
	if (snapshot.isEditing && snapshot.focusBlockId === blockId) {
		return activateInlineAtomSide({
			event,
			fieldEditor,
			root,
			blockId,
			target,
		});
	}

	event.preventDefault();
	if (hostFallback) {
		fieldEditor.activateTextSelection(
			blockId,
			hostFallback.offset,
			hostFallback.offset,
			{ origin: "pointer" },
		);
	} else {
		const point = pointToEditorSelectionPoint(
			root,
			event.clientX,
			event.clientY,
		);
		if (point && point.blockId === blockId) {
			fieldEditor.activateTextSelection(
				point.blockId,
				point.offset,
				point.offset,
				{ origin: "pointer" },
			);
		} else {
			const offset = block?.length() ?? 0;
			fieldEditor.activateTextSelection(blockId, offset, offset, {
				origin: "pointer",
			});
		}
	}

	const inline =
		target.closest(`[${DATA_ATTRS.inlineContent}]`) ??
		findInlineContentElement(blockElement);
	if (isDomHTMLElement(inline)) {
		fieldEditor.attachElement(inline);
	}
	return true;
}

/**
 * A shift-click in another block extends the selection from its anchor to
 * the logical offset under the pointer, the point a plain click there
 * collapses to (T5): the same range the React content gestures form
 * (`contentGesturesPointerSelection`). A click inside an inline atom takes
 * the side of the half it lands on (O1). Where geometry resolves no point in
 * the clicked block, the focus is that block's far edge in the nested
 * document walk. A shift-click in the anchor's own block stays the
 * browser's native extend.
 */
function extendSelectionToPointer(options: {
	event: MouseEvent;
	editor: Editor;
	fieldEditor: FieldEditorPointerTarget;
	root: HTMLElement;
	blockId: string;
}): boolean {
	const { event, editor, fieldEditor, root, blockId } = options;
	if (!fieldEditor.applyDocumentTextSelection) {
		return false;
	}
	const anchor = resolveShiftAnchor(editor, fieldEditor, root);
	if (!anchor || anchor.blockId === blockId) {
		return false;
	}
	const order = getPreorderBlockIds(editor);
	const anchorIndex = order.indexOf(anchor.blockId);
	const targetIndex = order.indexOf(blockId);
	if (anchorIndex < 0 || targetIndex < 0) {
		return false;
	}
	const pointerPoint = pointToEditorSelectionPoint(
		root,
		event.clientX,
		event.clientY,
	);
	const focus =
		pointerPoint?.blockId === blockId
			? { blockId, offset: pointerPoint.offset }
			: blockBoundaryPoint(
					editor,
					root,
					blockId,
					anchorIndex < targetIndex ? "end" : "start",
				);
	const formed = normalizeSelectionFormation(editor, { anchor, focus });
	fieldEditor.applyDocumentTextSelection(
		formed.anchor,
		formed.focus,
		"pointer",
	);
	return true;
}

function resolveShiftAnchor(
	editor: Editor,
	fieldEditor: FieldEditorPointerTarget,
	root: HTMLElement,
): Point | null {
	const selection = editor.selection;
	if (selection?.type === "text") {
		return selection.anchor;
	}
	if (selection?.type === "block" && selection.blockIds[0]) {
		return blockBoundaryPoint(editor, root, selection.blockIds[0], "start");
	}
	const focusBlockId = fieldEditor.getSnapshot().focusBlockId;
	return focusBlockId
		? blockBoundaryPoint(editor, root, focusBlockId, "start")
		: null;
}

function blockBoundaryPoint(
	editor: Editor,
	root: HTMLElement,
	blockId: string,
	side: "start" | "end",
): Point {
	return (
		getBlockBoundaryPoint(root, blockId, side) ?? {
			blockId,
			offset:
				side === "start"
					? 0
					: getEditorBlockSelectionLength(editor, blockId),
		}
	);
}

/**
 * A plain click on an inline chip in the field that is already editing.
 * The chip is `contenteditable="false"`, so the browser's own mousedown puts
 * the DOM caret inside the chip's text, which the reader can only map to
 * one side of the atom. The side is the half of the chip the pointer is
 * on (O1, W35.R16), resolved from geometry like an activating click. A
 * double click or a shift-extend stays the browser's.
 */
function activateInlineAtomSide(options: {
	event: MouseEvent;
	fieldEditor: FieldEditorPointerTarget;
	root: HTMLElement;
	blockId: string;
	target: Element;
}): boolean {
	const { event, fieldEditor, root, blockId, target } = options;
	if (event.detail > 1 || event.shiftKey) {
		return false;
	}
	const chip = target.closest(`[${DATA_ATTRS.inlineAtom}]`);
	if (!isInlineAtomChipNode(chip)) {
		return false;
	}
	const point = pointToEditorSelectionPoint(
		root,
		event.clientX,
		event.clientY,
	);
	if (!point || point.blockId !== blockId) {
		return false;
	}
	event.preventDefault();
	fieldEditor.activateTextSelection(blockId, point.offset, point.offset, {
		origin: "pointer",
	});
	return true;
}

function isEditorHostChrome(
	target: Element,
	root: HTMLElement,
	blocksHost: HTMLElement,
): boolean {
	return (
		target === root ||
		target === blocksHost ||
		target === blocksHost.parentElement ||
		isOwnListGroup(target, root, blocksHost)
	);
}

/** An AX1 list group wrapper of this root is host chrome, like the blocks host (W6.R6). */
function isOwnListGroup(
	target: Element,
	root: HTMLElement,
	blocksHost: HTMLElement,
): boolean {
	return (
		target.hasAttribute(DATA_ATTRS.listGroup) &&
		blocksHost.contains(target) &&
		target.closest(`[${DATA_ATTRS.editorRoot}]`) === root
	);
}

function resolveHostChromeFallbackBlock(
	event: MouseEvent,
	editor: Editor,
	root: HTMLElement,
	blocksHost: HTMLElement,
): { element: HTMLElement; offset: number } | null {
	const textBlocks = collectHostTextBlocks(editor, root, blocksHost);
	if (textBlocks.length === 0) {
		return null;
	}

	let first: HTMLElement | null = null;
	let last: HTMLElement | null = null;
	let firstTop = Infinity;
	let lastBottom = -Infinity;
	for (const block of textBlocks) {
		const rect = block.getBoundingClientRect();
		if (rect.top < firstTop) {
			firstTop = rect.top;
			first = block;
		}
		if (rect.bottom > lastBottom) {
			lastBottom = rect.bottom;
			last = block;
		}
	}

	// strict compare keeps the zero-rect host-gap case inactive in jsdom
	if (last && event.clientY > lastBottom) {
		const blockId = last.getAttribute(DATA_ATTRS.blockId);
		const length = blockId ? (editor.getBlock(blockId)?.length() ?? 0) : 0;
		return { element: last, offset: length };
	}
	if (first && event.clientY < firstTop) {
		return { element: first, offset: 0 };
	}
	return null;
}

export function collectHostTextBlocks(
	editor: Editor,
	root: HTMLElement,
	blocksHost: HTMLElement,
): HTMLElement[] {
	const textBlocks: HTMLElement[] = [];
	for (const element of blocksHost.querySelectorAll(
		`[${DATA_ATTRS.editorBlock}]`,
	)) {
		if (!isDomHTMLElement(element) || !blocksHost.contains(element)) {
			continue;
		}
		const owningRoot = element.closest(`[${DATA_ATTRS.editorRoot}]`);
		if (owningRoot && owningRoot !== root) {
			continue;
		}
		const blockId = element.getAttribute(DATA_ATTRS.blockId);
		if (!blockId) {
			continue;
		}
		const block = editor.getBlock(blockId);
		const schema = block ? editor.schema.resolve(block.type) : null;
		if (!usesInlineTextSelection(schema)) {
			continue;
		}
		textBlocks.push(element);
	}
	return textBlocks;
}
