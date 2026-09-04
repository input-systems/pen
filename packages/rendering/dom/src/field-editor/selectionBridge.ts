/**
 * DOM↔CRDT selection mapping utilities.
 * Converts between browser selection ranges and (blockId, offset) pairs.
 */

import { DATA_ATTRS } from "../utils/dataAttributes";
import { isInlineAtomNode } from "./inlineAtomDom";
import { getDistanceToRect } from "../geometry/types";
import { approximateInlineOffsetFromPoint } from "./selectionBridgeOffsets";
import {
	findBlockElement,
	findInlineContentElement,
} from "./selectionDomQueries";
export {
	findBlockElement,
	findInlineContentElement,
	queryBlockElement,
	queryInlineElement,
} from "./selectionDomQueries";
export {
	computeTextDiff,
	extractTextFromDOM,
	type TextDiffOp,
} from "./textDiff";
export {
	domPointToOffset,
	domSelectionToEditor,
	getBlockBoundaryPoint,
	type DirectionalSelectionOffsets,
	type SelectionBoundary,
	type SelectionPoint,
} from "./selectionMapping";
import {
	getBlockSurfaceRole,
	getBoundaryPointForBlockElement,
	resolveSelectionPoint,
	type ResolveSelectionPointOptions,
	type SelectionBoundary,
	type SelectionPoint,
} from "./selectionMapping";

function isNodeWithinOrEqual(container: HTMLElement, node: Node): boolean {
	return node === container || container.contains(node);
}

interface CaretPositionLike {
	offsetNode: Node;
	offset: number;
}

function resolveBoundarySideFromPointer(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number,
): SelectionBoundary {
	const rect = blockEl.getBoundingClientRect();
	const verticalDelta = clientY - (rect.top + rect.height / 2);
	if (Math.abs(verticalDelta) > 4) {
		return verticalDelta < 0 ? "start" : "end";
	}
	return clientX <= rect.left + rect.width / 2 ? "start" : "end";
}

export function getClosestBlockElementFromPoint(
	root: HTMLElement,
	clientX: number,
	clientY: number,
): HTMLElement | null {
	const doc = root.ownerDocument;
	const hitElement =
		typeof doc.elementFromPoint === "function"
			? doc.elementFromPoint(clientX, clientY)
			: null;
	const hitBlockEl = hitElement?.closest(
		`[${DATA_ATTRS.editorBlock}]`,
	) as HTMLElement | null;
	if (hitBlockEl && root.contains(hitBlockEl)) {
		return hitBlockEl;
	}

	const blockElements = root.querySelectorAll(`[${DATA_ATTRS.editorBlock}]`);
	let closestBlockEl: HTMLElement | null = null;
	let bestScore = Number.POSITIVE_INFINITY;

	for (const blockElement of blockElements) {
		if (!(blockElement instanceof HTMLElement)) continue;
		const rect = blockElement.getBoundingClientRect();
		const { dx, dy } = getDistanceToRect(rect, clientX, clientY);
		const score = dy * 1000 + dx;
		if (score < bestScore) {
			bestScore = score;
			closestBlockEl = blockElement;
		}
	}

	return closestBlockEl;
}

export function getSelectionPointForBlockAtPointer(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number,
	options: ResolveSelectionPointOptions = {},
): SelectionPoint | null {
	const blockId = blockEl.getAttribute("data-block-id");
	if (!blockId) return null;

	const surfaceRole = getBlockSurfaceRole(blockEl);
	if (surfaceRole !== "editable-inline") {
		return getBoundaryPointForBlockElement(
			blockEl,
			options.preferredBoundary ??
				resolveBoundarySideFromPointer(blockEl, clientX, clientY),
		);
	}

	const inlineEl = findInlineContentElement(blockEl);
	if (!inlineEl) {
		return { blockId, offset: 0 };
	}

	return {
		blockId,
		offset: approximateInlineOffsetFromPoint(
			inlineEl,
			clientX,
			clientY,
			options.previousPoint?.blockId === blockId
				? options.previousPoint.offset
				: null,
		),
	};
}

export function pointToEditorSelectionPoint(
	root: HTMLElement,
	clientX: number,
	clientY: number,
	options: ResolveSelectionPointOptions = {},
): SelectionPoint | null {
	const doc = root.ownerDocument;
	if (!doc) return null;
	const atomPoint = resolveInlineAtomPoint(root, clientX, clientY, options);
	if (atomPoint) return atomPoint;
	const caretFromPoint = doc as Document & {
		caretPositionFromPoint?: (
			x: number,
			y: number,
		) => CaretPositionLike | null;
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	};

	const position = caretFromPoint.caretPositionFromPoint?.(clientX, clientY);
	if (position) {
		const inlineBoundaryPoint = resolveInlineContainerBoundaryPoint(
			root,
			position.offsetNode,
			position.offset,
			clientX,
			clientY,
			options,
		);
		if (inlineBoundaryPoint) return inlineBoundaryPoint;

		const resolved = resolveSelectionPoint(
			root,
			position.offsetNode,
			position.offset,
			options,
		);
		if (resolved) return resolved;
	}

	const range = caretFromPoint.caretRangeFromPoint?.(clientX, clientY);
	if (range) {
		const inlineBoundaryPoint = resolveInlineContainerBoundaryPoint(
			root,
			range.startContainer,
			range.startOffset,
			clientX,
			clientY,
			options,
		);
		if (inlineBoundaryPoint) return inlineBoundaryPoint;

		const resolved = resolveSelectionPoint(
			root,
			range.startContainer,
			range.startOffset,
			options,
		);
		if (resolved) return resolved;
	}

	const hoveredBlockEl = getClosestBlockElementFromPoint(
		root,
		clientX,
		clientY,
	);
	if (!hoveredBlockEl) return null;
	// G4: past the top or bottom of the document the point is the edge of
	// the outer block, not the x-nearest offset in it. This is also where
	// the browser's native drag clamps its extent (the editing host's first
	// or last position), so a Pen-owned drag leaving the root writes the
	// same range as the browser and the two stop overwriting each other.
	const documentEdge = resolveDocumentEdgeSide(
		root,
		hoveredBlockEl,
		clientY,
	);
	if (documentEdge) {
		return getBoundaryPointForBlockElement(hoveredBlockEl, documentEdge);
	}
	return getSelectionPointForBlockAtPointer(
		hoveredBlockEl,
		clientX,
		clientY,
		options,
	);
}

function resolveDocumentEdgeSide(
	root: HTMLElement,
	blockEl: HTMLElement,
	clientY: number,
): SelectionBoundary | null {
	const blockElements = root.querySelectorAll(`[${DATA_ATTRS.editorBlock}]`);
	const rect = blockEl.getBoundingClientRect();
	if (clientY < rect.top && blockElements[0] === blockEl) {
		return "start";
	}
	if (
		clientY > rect.bottom &&
		blockElements[blockElements.length - 1] === blockEl
	) {
		return "end";
	}
	return null;
}

function resolveInlineAtomPoint(
	root: HTMLElement,
	clientX: number,
	clientY: number,
	options: ResolveSelectionPointOptions,
): SelectionPoint | null {
	const hitElement =
		typeof root.ownerDocument.elementFromPoint === "function"
			? root.ownerDocument.elementFromPoint(clientX, clientY)
			: null;
	if (!hitElement || !root.contains(hitElement)) {
		return null;
	}

	const atomElement = findInlineAtomElement(hitElement, root);
	if (!atomElement) {
		return null;
	}

	const blockEl = findBlockElement(atomElement, root);
	if (!blockEl || getBlockSurfaceRole(blockEl) !== "editable-inline") {
		return null;
	}

	return getSelectionPointForBlockAtPointer(
		blockEl,
		clientX,
		clientY,
		options,
	);
}

function findInlineAtomElement(
	element: Element,
	root: HTMLElement,
): HTMLElement | null {
	let current: Element | null = element;
	while (current && current !== root) {
		if (isInlineAtomNode(current)) {
			return current;
		}
		current = current.parentElement;
	}
	return null;
}

function resolveInlineContainerBoundaryPoint(
	root: HTMLElement,
	node: Node,
	offset: number,
	clientX: number,
	clientY: number,
	options: ResolveSelectionPointOptions,
): SelectionPoint | null {
	const blockEl = findBlockElement(node, root);
	if (!blockEl || getBlockSurfaceRole(blockEl) !== "editable-inline") {
		return null;
	}

	const inlineEl = findInlineContentElement(blockEl);
	if (!inlineEl || !isInlineBoundaryFallbackPoint(inlineEl, node, offset)) {
		return null;
	}

	const geometricPoint = getSelectionPointForBlockAtPointer(
		blockEl,
		clientX,
		clientY,
		options,
	);
	return geometricPoint && geometricPoint.offset > 0 ? geometricPoint : null;
}

function isInlineBoundaryFallbackPoint(
	inlineEl: HTMLElement,
	node: Node,
	offset: number,
): boolean {
	if (node === inlineEl) {
		return offset === 0;
	}

	return node instanceof HTMLElement && node.contains(inlineEl);
}

export {
	editorSelectionToDOM,
	getCaretOffset,
	getDirectionalSelectionOffsets,
	getSelectionOffsets,
	getSelectionPointRect,
	getTextSelectionClientRects,
} from "./selectionBridgeOffsets";
