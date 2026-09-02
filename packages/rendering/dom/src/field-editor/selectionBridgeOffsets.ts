import { findEmptyBlockPlaceholder } from "./emptyBlockPlaceholder";
import {
	findLogicalDOMPoint,
	getInlineAtomPointerOffset,
	getLogicalNodeLength,
} from "./inlineAtomDom";
import {
	findInlineContentElement,
	queryBlockElement,
} from "./selectionDomQueries";
import {
	domPointToOffset,
	type DirectionalSelectionOffsets,
	type SelectionPoint,
} from "./selectionBridge";

function isNodeWithinOrEqual(container: HTMLElement, node: Node): boolean {
	return node === container || container.contains(node);
}

/**
 * Set DOM selection from editor (blockId, offset) pairs.
 */
export function editorSelectionToDOM(
	root: HTMLElement,
	anchor: SelectionPoint,
	focus: SelectionPoint,
): void {
	const anchorResult = findDOMPoint(root, anchor.blockId, anchor.offset);
	const focusResult = findDOMPoint(root, focus.blockId, focus.offset);
	if (!anchorResult || !focusResult) return;

	const sel = window.getSelection();
	if (!sel) return;

	setDOMSelection(sel, anchorResult, focusResult);
}

export function getSelectionPointRect(
	root: HTMLElement,
	point: SelectionPoint,
): DOMRect | null {
	const domPoint = findDOMPoint(root, point.blockId, point.offset);
	if (!domPoint) return null;

	const blockEl = queryBlockElement(root, point.blockId);
	const inlineEl = blockEl ? findInlineContentElement(blockEl) : null;
	if (!inlineEl) return null;

	const doc = root.ownerDocument;
	if (!doc) return null;

	const range = doc.createRange();
	range.setStart(domPoint.node, domPoint.offset);
	range.collapse(true);

	const rangeRectGetter = (
		range as Range & { getBoundingClientRect?: () => DOMRect }
	).getBoundingClientRect;
	if (typeof rangeRectGetter === "function") {
		const rect = rangeRectGetter.call(range);
		if (rect.height > 0 || rect.width > 0) {
			return rect;
		}
	}

	return getInlineCaretRectFromOffset(inlineEl, point.offset);
}

export function getTextSelectionClientRects(
	root: HTMLElement,
	selection: {
		anchor: SelectionPoint;
		focus: SelectionPoint;
	},
): DOMRect[] {
	const doc = root.ownerDocument;
	if (!doc) {
		return [];
	}

	const anchorPoint = findDOMPoint(
		root,
		selection.anchor.blockId,
		selection.anchor.offset,
	);
	const focusPoint = findDOMPoint(
		root,
		selection.focus.blockId,
		selection.focus.offset,
	);
	if (!anchorPoint || !focusPoint) {
		return [];
	}

	const range = doc.createRange();
	try {
		range.setStart(anchorPoint.node, anchorPoint.offset);
		range.setEnd(focusPoint.node, focusPoint.offset);
	} catch {
		// reversed endpoints; try the swapped range.
		range.setStart(focusPoint.node, focusPoint.offset);
		range.setEnd(anchorPoint.node, anchorPoint.offset);
	}

	const rangeClientRectGetter = (
		range as Range & { getClientRects?: () => DOMRectList | DOMRect[] }
	).getClientRects;
	const clientRects =
		typeof rangeClientRectGetter === "function"
			? Array.from(rangeClientRectGetter.call(range))
			: [];
	if (clientRects.length > 0) {
		return clientRects.filter((rect) => rect.width > 0 || rect.height > 0);
	}

	const rangeRectGetter = (
		range as Range & { getBoundingClientRect?: () => DOMRect }
	).getBoundingClientRect;
	if (typeof rangeRectGetter !== "function") {
		return [];
	}

	const boundingRect = rangeRectGetter.call(range);
	return boundingRect.width > 0 || boundingRect.height > 0
		? [boundingRect]
		: [];
}

/**
 * Find the DOM text node and offset for a given (blockId, characterOffset).
 */
function findDOMPoint(
	root: HTMLElement,
	blockId: string,
	charOffset: number,
): { node: Node; offset: number } | null {
	const blockEl = queryBlockElement(root, blockId);
	if (!blockEl) return null;

	const inlineEl = findInlineContentElement(blockEl);
	if (!inlineEl) return findBlockUnitDOMPoint(blockEl, charOffset);

	return findLogicalDOMPoint(inlineEl, charOffset);
}

/**
 * A block with no inline content — divider, image, a host's sealed region —
 * holds no text position, so its `0..1` unit extent (N2) maps to the DOM
 * points around the element instead of a point inside it.
 */
function findBlockUnitDOMPoint(
	blockEl: HTMLElement,
	charOffset: number,
): { node: Node; offset: number } | null {
	const parent = blockEl.parentNode;
	if (!parent) return null;

	const index = [...parent.childNodes].indexOf(blockEl);
	if (index < 0) return null;

	return { node: parent, offset: charOffset <= 0 ? index : index + 1 };
}

/**
 * Get the current selection as character offsets within the active inline content.
 * Used by DIRECT_HANDLERS to know the selection range for editing operations.
 */
export function getDirectionalSelectionOffsets(
	inlineElement: HTMLElement,
): DirectionalSelectionOffsets | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	if (!sel.anchorNode || !sel.focusNode) return null;
	if (
		!isNodeWithinOrEqual(inlineElement, sel.anchorNode) ||
		!isNodeWithinOrEqual(inlineElement, sel.focusNode)
	) {
		return null;
	}

	const anchor = domPointToOffset(
		inlineElement,
		sel.anchorNode,
		sel.anchorOffset,
	);
	const focus = domPointToOffset(
		inlineElement,
		sel.focusNode,
		sel.focusOffset,
	);

	return {
		anchor,
		focus,
		start: Math.min(anchor, focus),
		end: Math.max(anchor, focus),
	};
}

export function getSelectionOffsets(
	inlineElement: HTMLElement,
): { start: number; end: number } | null {
	const offsets = getDirectionalSelectionOffsets(inlineElement);
	if (!offsets) return null;

	return { start: offsets.start, end: offsets.end };
}

/**
 * Get the caret offset (collapsed cursor position) within an inline element.
 */
export function getCaretOffset(inlineElement: HTMLElement): number {
	const offsets = getSelectionOffsets(inlineElement);
	return offsets?.start ?? 0;
}

function resolveWritableDOMPoint(point: { node: Node; offset: number }): {
	node: Node;
	offset: number;
} {
	if (point.node.nodeType !== Node.ELEMENT_NODE) {
		return point;
	}

	const childAtOffset = point.node.childNodes[point.offset];
	if (childAtOffset?.nodeType === Node.TEXT_NODE) {
		return { node: childAtOffset, offset: 0 };
	}

	if (point.offset > 0) {
		const previousChild = point.node.childNodes[point.offset - 1];
		if (previousChild?.nodeType === Node.TEXT_NODE) {
			return {
				node: previousChild,
				offset: previousChild.textContent?.length ?? 0,
			};
		}
	}

	return point;
}

function selectionHasEndpoints(
	selection: Selection,
	anchor: { node: Node; offset: number },
	focus: { node: Node; offset: number },
): boolean {
	return (
		selection.rangeCount > 0 &&
		selection.anchorNode === anchor.node &&
		selection.anchorOffset === anchor.offset &&
		selection.focusNode === focus.node &&
		selection.focusOffset === focus.offset
	);
}

function setDOMSelection(
	selection: Selection,
	rawAnchor: { node: Node; offset: number },
	rawFocus: { node: Node; offset: number },
): void {
	const anchor = resolveWritableDOMPoint(rawAnchor);
	const focus = resolveWritableDOMPoint(rawFocus);
	const intendedRange =
		anchor.node !== focus.node || anchor.offset !== focus.offset;

	const setBaseAndExtent = (
		selection as Selection & {
			setBaseAndExtent?: (
				anchorNode: Node,
				anchorOffset: number,
				focusNode: Node,
				focusOffset: number,
			) => void;
		}
	).setBaseAndExtent;
	if (typeof setBaseAndExtent === "function") {
		try {
			setBaseAndExtent.call(
				selection,
				anchor.node,
				anchor.offset,
				focus.node,
				focus.offset,
			);
			// Firefox accepts the call for mixed element/text points but
			// leaves a caret; only trust the write when the endpoints stuck
			if (
				!intendedRange ||
				selectionHasEndpoints(selection, anchor, focus)
			) {
				return;
			}
		} catch {
			// Fall back to the range-based path in test environments like jsdom.
		}
	}

	selection.removeAllRanges();

	const collapseRange = document.createRange();
	collapseRange.setStart(anchor.node, anchor.offset);
	collapseRange.collapse(true);
	selection.addRange(collapseRange);

	if (intendedRange && typeof selection.extend === "function") {
		try {
			selection.extend(focus.node, focus.offset);
			if (
				selectionHasEndpoints(selection, anchor, focus) ||
				!selection.isCollapsed
			) {
				return;
			}
		} catch {
			// Fall through to an ordered addRange.
		}
	}

	if (!intendedRange) {
		return;
	}

	selection.removeAllRanges();
	const orderedRange = document.createRange();
	if (compareDOMPoints(anchor, focus) <= 0) {
		orderedRange.setStart(anchor.node, anchor.offset);
		orderedRange.setEnd(focus.node, focus.offset);
	} else {
		orderedRange.setStart(focus.node, focus.offset);
		orderedRange.setEnd(anchor.node, anchor.offset);
	}
	selection.addRange(orderedRange);
}

const WRAPPED_LINE_HYSTERESIS_PX = 6;
const WRAPPED_LINE_HORIZONTAL_SLACK_PX = 12;
const WRAPPED_LINE_DELTA_PX = 1;

function getCharacterRectAtOffset(
	container: HTMLElement,
	charOffset: number,
): DOMRect | null {
	const domPoint = findLogicalDOMPoint(container, charOffset);
	const range = document.createRange();
	try {
		range.setStart(domPoint.node, domPoint.offset);
		range.setEnd(domPoint.node, domPoint.offset);
	} catch {
		// detached or out-of-range DOM point.
		return null;
	}
	const rangeRectGetter = (
		range as Range & { getBoundingClientRect?: () => DOMRect }
	).getBoundingClientRect;
	if (typeof rangeRectGetter === "function") {
		const rect = rangeRectGetter.call(range);
		if (rect.width > 0 || rect.height > 0) {
			return rect;
		}
	}

	return null;
}

function getInlineCaretRectFromOffset(
	inlineEl: HTMLElement,
	offset: number,
): DOMRect {
	const textLength = getLogicalNodeLength(inlineEl);
	const placeholder = findEmptyBlockPlaceholder(inlineEl);
	const inlineRect = (placeholder ?? inlineEl).getBoundingClientRect();
	if (textLength <= 0) {
		return {
			x: inlineRect.left,
			y: inlineRect.top,
			left: inlineRect.left,
			top: inlineRect.top,
			right: inlineRect.left,
			bottom: inlineRect.bottom,
			width: 0,
			height: inlineRect.height,
			toJSON() {
				return {};
			},
		} as DOMRect;
	}

	if (offset <= 0) {
		const firstRect = getCharacterRectAtOffset(inlineEl, 0);
		const left = firstRect?.left ?? inlineRect.left;
		const top = firstRect?.top ?? inlineRect.top;
		const height = firstRect?.height ?? inlineRect.height;
		return {
			x: left,
			y: top,
			left,
			top,
			right: left,
			bottom: top + height,
			width: 0,
			height,
			toJSON() {
				return {};
			},
		} as DOMRect;
	}

	if (offset >= textLength) {
		const lastRect = getCharacterRectAtOffset(inlineEl, textLength - 1);
		const left = lastRect?.right ?? inlineRect.right;
		const top = lastRect?.top ?? inlineRect.top;
		const height = lastRect?.height ?? inlineRect.height;
		return {
			x: left,
			y: top,
			left,
			top,
			right: left,
			bottom: top + height,
			width: 0,
			height,
			toJSON() {
				return {};
			},
		} as DOMRect;
	}

	const previousRect = getCharacterRectAtOffset(inlineEl, offset - 1);
	const nextRect = getCharacterRectAtOffset(inlineEl, offset);
	const useNextRect =
		previousRect && nextRect && nextRect.top > previousRect.top + 1;
	const sourceRect = useNextRect
		? nextRect
		: (previousRect ?? nextRect ?? inlineRect);
	const left = useNextRect
		? (nextRect?.left ?? inlineRect.left)
		: (previousRect?.right ?? nextRect?.left ?? inlineRect.left);

	return {
		x: left,
		y: sourceRect.top,
		left,
		top: sourceRect.top,
		right: left,
		bottom: sourceRect.top + sourceRect.height,
		width: 0,
		height: sourceRect.height,
		toJSON() {
			return {};
		},
	} as DOMRect;
}

function getCaretDistanceMetrics(
	rect: DOMRect,
	clientX: number,
	clientY: number,
): {
	dx: number;
	dy: number;
} {
	return {
		dx: Math.abs(clientX - rect.left),
		dy:
			clientY < rect.top
				? rect.top - clientY
				: clientY > rect.bottom
					? clientY - rect.bottom
					: 0,
	};
}

function stabilizeWrappedLineOffset(
	inlineEl: HTMLElement,
	candidateOffset: number,
	clientX: number,
	clientY: number,
	previousOffset: number | null | undefined,
): number {
	if (previousOffset == null || previousOffset === candidateOffset) {
		return candidateOffset;
	}

	const previousRect = getInlineCaretRectFromOffset(inlineEl, previousOffset);
	const candidateRect = getInlineCaretRectFromOffset(
		inlineEl,
		candidateOffset,
	);
	if (
		Math.abs(previousRect.top - candidateRect.top) <= WRAPPED_LINE_DELTA_PX
	) {
		return candidateOffset;
	}

	const previousMetrics = getCaretDistanceMetrics(
		previousRect,
		clientX,
		clientY,
	);
	const candidateMetrics = getCaretDistanceMetrics(
		candidateRect,
		clientX,
		clientY,
	);
	const isNearWrappedBoundary =
		previousMetrics.dy <= WRAPPED_LINE_HYSTERESIS_PX &&
		candidateMetrics.dy <= WRAPPED_LINE_HYSTERESIS_PX;
	if (!isNearWrappedBoundary) {
		return candidateOffset;
	}

	const shouldPreservePreviousLine =
		previousMetrics.dx <=
			candidateMetrics.dx + WRAPPED_LINE_HORIZONTAL_SLACK_PX &&
		previousMetrics.dy <= candidateMetrics.dy + WRAPPED_LINE_DELTA_PX;
	return shouldPreservePreviousLine ? previousOffset : candidateOffset;
}

export function approximateInlineOffsetFromPoint(
	inlineEl: HTMLElement,
	clientX: number,
	clientY: number,
	previousOffset?: number | null,
): number {
	const textLength = getLogicalNodeLength(inlineEl);
	if (textLength <= 0) return 0;
	const inlineAtomOffset = getInlineAtomPointerOffset(
		inlineEl,
		clientX,
		clientY,
	);
	if (inlineAtomOffset !== null) {
		return inlineAtomOffset;
	}

	let bestOffset = 0;
	let bestScore = Number.POSITIVE_INFINITY;

	for (let offset = 0; offset <= textLength; offset++) {
		const rect = getInlineCaretRectFromOffset(inlineEl, offset);
		const { dx, dy } = getCaretDistanceMetrics(rect, clientX, clientY);
		const score = dy * 1000 + dx;
		if (score < bestScore) {
			bestScore = score;
			bestOffset = offset;
		}
	}

	return stabilizeWrappedLineOffset(
		inlineEl,
		bestOffset,
		clientX,
		clientY,
		previousOffset,
	);
}

function compareDOMPoints(
	left: { node: Node; offset: number },
	right: { node: Node; offset: number },
): number {
	if (left.node === right.node) {
		return left.offset - right.offset;
	}

	const leftRange = document.createRange();
	leftRange.setStart(left.node, left.offset);
	leftRange.collapse(true);

	const rightRange = document.createRange();
	rightRange.setStart(right.node, right.offset);
	rightRange.collapse(true);

	return leftRange.compareBoundaryPoints(Range.START_TO_START, rightRange);
}
