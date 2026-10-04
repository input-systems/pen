import {
	nextGraphemeBoundary,
	previousGraphemeBoundary,
} from "@input/pen-core";
import { findEmptyBlockPlaceholder } from "./emptyBlockPlaceholder";
import {
	findLogicalDOMPoint,
	getInlineAtomPointerOffset,
	getLogicalNodeLength,
	getLogicalTextContent,
} from "./inlineAtomDom";
import {
	findInlineContentElement,
	queryBlockElement,
} from "./selectionDomQueries";
import type { SelectionPoint } from "./selectionBridge";
import { getBlockSurfaceRole } from "./selectionMapping";
import { getDistanceToRect } from "../geometry/types";

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
export function findDOMPoint(
	root: HTMLElement,
	blockId: string,
	charOffset: number,
): { node: Node; offset: number } | null {
	const blockEl = queryBlockElement(root, blockId);
	if (!blockEl) return null;

	const inlineEl = findInlineContentElement(blockEl);
	if (!inlineEl || getBlockSurfaceRole(blockEl) !== "editable-inline") {
		return findBlockUnitDOMPoint(blockEl, charOffset);
	}

	return findLogicalDOMPoint(inlineEl, charOffset);
}

/**
 * A block with no text position of its own — divider, image, a host's
 * sealed region, a table, whose cells are not its offsets — maps its `0..1`
 * unit extent (N2) to the DOM points around the element instead of a point
 * inside it. Inside the expanded host such a block is not editable, and
 * WebKit moves a native endpoint inside it to the nearest editable position.
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

/** UAX #29 grapheme clusters, as `normalPosition.ts`; locale does not change them. */
const GRAPHEME_LOCALE = "und";
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
		return caretRect(inlineRect.left, inlineRect.top, inlineRect.height);
	}

	if (offset <= 0) {
		const firstRect = getCharacterRectAtOffset(inlineEl, 0);
		return caretRect(
			firstRect?.left ?? inlineRect.left,
			firstRect?.top ?? inlineRect.top,
			firstRect?.height ?? inlineRect.height,
		);
	}

	if (offset >= textLength) {
		const lastRect = getCharacterRectAtOffset(inlineEl, textLength - 1);
		return caretRect(
			lastRect?.right ?? inlineRect.right,
			lastRect?.top ?? inlineRect.top,
			lastRect?.height ?? inlineRect.height,
		);
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

	return caretRect(left, sourceRect.top, sourceRect.height);
}

/** A zero-width caret box at `left`, `top`. */
function caretRect(left: number, top: number, height: number): DOMRect {
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

	const previousMetrics = getDistanceToRect(
		previousRect,
		clientX,
		clientY,
	);
	const candidateMetrics = getDistanceToRect(
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

/**
 * G4: a pointer offset is a normal position. The geometric scan measures
 * every code unit, so a point over a cluster (a ZWJ emoji, a surrogate
 * pair) can land inside it; take the nearer of the cluster's two edges.
 */
function snapToGraphemeBoundary(
	inlineEl: HTMLElement,
	offset: number,
	scoreAt: (offset: number) => number,
): number {
	const text = getLogicalTextContent(inlineEl);
	const previous = previousGraphemeBoundary(text, offset, GRAPHEME_LOCALE);
	const next = nextGraphemeBoundary(text, previous, GRAPHEME_LOCALE);
	if (next === offset || previous === offset) {
		return offset;
	}
	return scoreAt(previous) <= scoreAt(next) ? previous : next;
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

	const scoreAt = (offset: number): number => {
		const rect = getInlineCaretRectFromOffset(inlineEl, offset);
		const { dx, dy } = getDistanceToRect(rect, clientX, clientY);
		return dy * 1000 + dx;
	};
	for (let offset = 0; offset <= textLength; offset++) {
		const score = scoreAt(offset);
		if (score < bestScore) {
			bestScore = score;
			bestOffset = offset;
		}
	}

	return stabilizeWrappedLineOffset(
		inlineEl,
		snapToGraphemeBoundary(inlineEl, bestOffset, scoreAt),
		clientX,
		clientY,
		previousOffset,
	);
}
