import {
	findEmptyBlockPlaceholder,
} from "../field-editor/emptyBlockPlaceholder";
import {
	findLogicalDOMPoint,
	getLogicalNodeLength,
	getLogicalTextContent,
	isInlineAtomHostNode,
	isInlineAtomNode,
} from "../field-editor/inlineAtomDom";
import { clampOffset } from "../utils/clampOffset";
import { getTextSelectionClientRects } from "../field-editor/selectionBridgeOffsets";
import {
	findInlineContentElement,
	queryBlockElement,
	queryInlineElement,
} from "../field-editor/selectionDomQueries";
import { DATA_ATTRS } from "../utils/dataAttributes";
import type { Affinity, Point, Rect } from "./types";
import {
	collapsedRect,
	isInkRect,
	isUsefulRect,
	rectFromDOMRect,
	unionRects,
} from "./types";
import { isDomHTMLElement } from "../utils/domNodes";

export const LINE_TOP_EPSILON = 1;

export function snapToLogicalOffset(root: HTMLElement, point: Point): Point {
	const blockEl = queryBlockElement(root, point.blockId);
	const inlineEl = blockEl ? findInlineContentElement(blockEl) : null;
	if (!inlineEl) {
		return { blockId: point.blockId, offset: 0 };
	}
	return {
		blockId: point.blockId,
		offset: clampOffset(
			point.offset,
			getLogicalTextContent(inlineEl).length,
		),
	};
}

export function measureCaretRect(
	root: HTMLElement,
	point: Point,
	affinity: Affinity,
): Rect | null {
	const blockEl = queryBlockElement(root, point.blockId);
	if (!blockEl) {
		return null;
	}

	const inlineEl =
		findInlineContentElement(blockEl) ??
		queryInlineElement(root, point.blockId);
	if (!inlineEl) {
		return caretFromElementRect(blockEl, affinity);
	}

	const length = getLogicalNodeLength(inlineEl);
	if (length <= 0) {
		const placeholder = findEmptyBlockPlaceholder(inlineEl);
		return caretFromElementRect(placeholder ?? inlineEl, affinity);
	}

	const offset = clampOffset(point.offset, length);
	const domPoint = findLogicalDOMPoint(inlineEl, offset);
	const atomHost = findAtomHost(domPoint.node);
	if (atomHost) {
		return caretFromElementRect(atomHost, affinity);
	}

	const collapsed = clientRectsAtPoint(root, domPoint);
	if (collapsed.length > 0 && offset > 0 && offset < length) {
		return collapsedCaretFromRects(collapsed, affinity);
	}

	const previous =
		offset > 0 ? characterRect(root, inlineEl, offset - 1) : null;
	const next = offset < length ? characterRect(root, inlineEl, offset) : null;
	const fromAffinity = caretFromAffinity(previous, next, affinity);
	if (fromAffinity) {
		return fromAffinity;
	}
	if (collapsed.length > 0) {
		return collapsedCaretFromRects(collapsed, affinity);
	}
	return caretFromElementRect(inlineEl, affinity);
}

/**
 * Whether `point` resolves into an inline atom's host (a caret on either
 * side of a chip). Read phase only.
 */
export function isPointBesideAtom(root: HTMLElement, point: Point): boolean {
	const blockEl = queryBlockElement(root, point.blockId);
	const inlineEl = blockEl
		? (findInlineContentElement(blockEl) ??
			queryInlineElement(root, point.blockId))
		: null;
	if (!inlineEl) {
		return false;
	}
	const length = getLogicalNodeLength(inlineEl);
	if (length <= 0) {
		return false;
	}
	const domPoint = findLogicalDOMPoint(inlineEl, clampOffset(point.offset, length));
	return findAtomHost(domPoint.node) !== null;
}

export function measureRangeRects(
	root: HTMLElement,
	range: { anchor: Point; focus: Point },
): readonly Rect[] {
	return getTextSelectionClientRects(root, range).map(rectFromDOMRect);
}

export function measureRangeSlice(
	root: HTMLElement,
	blockId: string,
	start: number,
	end: number,
): Rect | null {
	const blockEl = queryBlockElement(root, blockId);
	const inlineEl = blockEl
		? (findInlineContentElement(blockEl) ??
			queryInlineElement(root, blockId))
		: null;
	if (!inlineEl) {
		return null;
	}
	return measureLogicalRange(root, inlineEl, start, end);
}

export function measureLogicalRange(
	root: HTMLElement,
	inlineEl: HTMLElement,
	from: number,
	to: number,
): Rect | null {
	if (from >= to) {
		return null;
	}
	const start = findLogicalDOMPoint(inlineEl, from);
	const end = findLogicalDOMPoint(inlineEl, to);
	const doc = root.ownerDocument;
	const range = doc.createRange();
	try {
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);
	} catch {
		// detached or out-of-range DOM points.
		return null;
	}
	const rects = readInkRects(range);
	if (rects.length === 0) {
		return null;
	}
	return unionRects(rects.map(rectFromDOMRect));
}

export function measureBlockRect(
	root: HTMLElement,
	blockId: string,
): Rect | null {
	const blockEl = queryBlockElement(root, blockId);
	return blockEl ? measureBlockElementRect(blockEl) : null;
}

/** A block element's box, or its inline surface's when the block has none. */
export function measureBlockElementRect(blockEl: HTMLElement): Rect {
	const rect = elementRect(blockEl);
	if (isUsefulRect(rect)) {
		return rect;
	}
	const inlineEl = findInlineContentElement(blockEl);
	return inlineEl ? elementRect(inlineEl) : rect;
}

/**
 * O3: the box of one grid cell, `[data-pen-table-cell][data-cell-row][data-cell-col]`
 * inside the table block. Read phase only. Null when the block or the cell
 * is not mounted (the vanilla path renders no table cells, RI5).
 */
export function measureCellRect(
	root: HTMLElement,
	blockId: string,
	row: number,
	col: number,
): Rect | null {
	const blockEl = queryBlockElement(root, blockId);
	if (!blockEl) {
		return null;
	}
	const cell = blockEl.querySelector<HTMLElement>(
		`[${DATA_ATTRS.tableCell}][${DATA_ATTRS.tableCellRow}="${row}"][${DATA_ATTRS.tableCellCol}="${col}"]`,
	);
	return cell ? elementRect(cell) : null;
}

export function characterRect(
	root: HTMLElement,
	inlineEl: HTMLElement,
	charOffset: number,
): Rect | null {
	const start = findLogicalDOMPoint(inlineEl, charOffset);
	const end = findLogicalDOMPoint(inlineEl, charOffset + 1);
	const atomHost = findAtomHost(start.node) ?? findAtomHost(end.node);
	if (atomHost) {
		return elementRect(atomHost);
	}
	return firstClientRect(root, start, end);
}

function clientRectsAtPoint(
	root: HTMLElement,
	domPoint: { node: Node; offset: number },
): DOMRect[] {
	const doc = root.ownerDocument;
	const range = doc.createRange();
	try {
		range.setStart(domPoint.node, domPoint.offset);
		range.collapse(true);
	} catch {
		// detached or out-of-range caret point.
		return [];
	}
	return readClientRects(range);
}

function firstClientRect(
	root: HTMLElement,
	start: { node: Node; offset: number },
	end: { node: Node; offset: number },
): Rect | null {
	const doc = root.ownerDocument;
	const range = doc.createRange();
	try {
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);
	} catch {
		// detached or out-of-range DOM points.
		return null;
	}
	const rects = readClientRects(range);
	const first = rects[0];
	return first ? rectFromDOMRect(first) : null;
}

function readClientRects(range: Range): DOMRect[] {
	const getter = (
		range as Range & { getClientRects?: () => DOMRectList | DOMRect[] }
	).getClientRects;
	if (typeof getter !== "function") {
		return [];
	}
	return Array.from(getter.call(range)).filter(isUsefulRect);
}

function readInkRects(range: Range): DOMRect[] {
	return readClientRects(range).filter(isInkRect);
}

/**
 * Ink rects plus one zero-width rect per line that has no ink. A blank line
 * inside a text node (`"a\n\nb"`) only reports a zero-width rect for its
 * `\n`; dropping it with the ghosts leaves the line without a box, so
 * vertical motion steps over it. Zero-width rects on a line that has ink are
 * still ghosts (G3).
 */
export function readLineRects(range: Range): DOMRect[] {
	const rects = readClientRects(range);
	const lineTops = rects.filter(isInkRect).map((rect) => rect.top);
	const kept: DOMRect[] = [];
	for (const rect of rects) {
		if (isInkRect(rect)) {
			kept.push(rect);
			continue;
		}
		const ownsLine = lineTops.every(
			(top) => Math.abs(top - rect.top) > LINE_TOP_EPSILON,
		);
		if (ownsLine) {
			kept.push(rect);
			lineTops.push(rect.top);
		}
	}
	return kept;
}

function caretFromAffinity(
	previous: Rect | null,
	next: Rect | null,
	affinity: Affinity,
): Rect | null {
	const wrapped = Boolean(
		previous && next && next.top > previous.top + LINE_TOP_EPSILON,
	);
	if (wrapped) {
		switch (affinity) {
			case "downstream":
				return next
					? collapsedRect(next.left, next.top, next.height)
					: null;
			case "upstream":
				return previous
					? collapsedRect(
							previous.right,
							previous.top,
							previous.height,
						)
					: null;
			default: {
				const _exhaustive: never = affinity;
				return _exhaustive;
			}
		}
	}

	switch (affinity) {
		case "upstream":
			if (previous) {
				return collapsedRect(
					previous.right,
					previous.top,
					previous.height,
				);
			}
			return next
				? collapsedRect(next.left, next.top, next.height)
				: null;
		case "downstream":
			if (next) {
				return collapsedRect(next.left, next.top, next.height);
			}
			return previous
				? collapsedRect(previous.right, previous.top, previous.height)
				: null;
		default: {
			const _exhaustive: never = affinity;
			return _exhaustive;
		}
	}
}

function collapsedCaretFromRects(
	rects: readonly DOMRect[],
	affinity: Affinity,
): Rect {
	const chosen = pickAffinityRect(rects, affinity);
	return collapsedRect(chosen.left, chosen.top, chosen.height);
}

function pickAffinityRect(
	rects: readonly DOMRect[],
	affinity: Affinity,
): DOMRect {
	const first = rects[0];
	const last = rects[rects.length - 1];
	if (!first) {
		return {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			toJSON() {
				return {};
			},
		} as DOMRect;
	}
	switch (affinity) {
		case "upstream":
			return first;
		case "downstream":
			return last ?? first;
		default: {
			const _exhaustive: never = affinity;
			return _exhaustive;
		}
	}
}

function caretFromElementRect(element: HTMLElement, affinity: Affinity): Rect {
	const rect = element.getBoundingClientRect();
	const x = affinity === "upstream" ? rect.right : rect.left;
	return collapsedRect(x, rect.top, rect.height);
}

export function elementRect(element: HTMLElement): Rect {
	return rectFromDOMRect(element.getBoundingClientRect());
}

/** Viewport pixels per CSS pixel along each axis inside an element. */
export type ElementScale = { readonly x: number; readonly y: number };

/**
 * Viewport pixels per CSS pixel inside `element`: every ancestor
 * `transform: scale()` and CSS `zoom`, and the element's own, read as its
 * border box (`rect`, already measured by the caller) over its layout size.
 * An axis whose two sizes agree to within `offsetWidth`'s integer rounding
 * is 1, so an unscaled element measures exactly 1; an axis with no layout
 * size borrows the other axis.
 */
export function elementScale(element: HTMLElement, rect: Rect): ElementScale {
	const x = axisScale(rect.width, element.offsetWidth);
	const y = axisScale(rect.height, element.offsetHeight);
	return { x: x ?? y ?? 1, y: y ?? x ?? 1 };
}

function axisScale(viewport: number, layout: number): number | null {
	if (layout <= 0 || viewport <= 0) {
		return null;
	}
	return Math.abs(viewport - layout) < 1 ? 1 : viewport / layout;
}

export function findAtomHost(node: Node): HTMLElement | null {
	let current: Node | null = node;
	while (current) {
		if (isInlineAtomHostNode(current)) {
			return current;
		}
		if (isInlineAtomNode(current)) {
			const host = current.closest(`[${DATA_ATTRS.inlineAtomHost}]`);
			return isDomHTMLElement(host) ? host : current;
		}
		current = current.parentNode;
	}
	return null;
}
