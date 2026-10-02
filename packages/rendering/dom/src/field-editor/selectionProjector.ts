import { findLogicalDOMPoint } from "./inlineAtomDom";
import { findDOMPoint } from "./selectionBridgeOffsets";
import type { SelectionPoint } from "./selectionBridge";

/**
 * The selection writer (S1). Every mutation of the DOM selection or of an
 * EditContext's selection in the renderer packages goes through this module;
 * `pen/no-dom-selection-write` reports a write anywhere else. W3 grows this
 * into the projector proper: `project()` with read-back, parking and scroll.
 */

/** Writes `anchor`..`focus` as the native range inside `root`. No-op when either point is unmapped. */
export function writeNativeRange(
	root: HTMLElement,
	anchor: SelectionPoint,
	focus: SelectionPoint,
): void {
	const anchorResult = findDOMPoint(root, anchor.blockId, anchor.offset);
	const focusResult = findDOMPoint(root, focus.blockId, focus.offset);
	if (!anchorResult || !focusResult) return;

	const sel =
		root.ownerDocument.defaultView?.getSelection() ?? window.getSelection();
	if (!sel) return;

	writeNativeRangeAt(sel, anchorResult, focusResult);
}

/**
 * Writes element-local logical offsets into one field (W3.R3, PH1 only). The
 * backends' stamp restores call it with the offsets they resolve today, so
 * the stamp sources can be removed one by one; `source` names the stamp each
 * removal deletes. No read-back. W3.R10 deletes it.
 */
export function writeLegacyFieldRange(
	element: HTMLElement,
	anchorOffset: number,
	focusOffset: number,
	_source: "programmatic" | "edit-context-textupdate" | "user-dom" | "cell",
): void {
	const selection = element.ownerDocument.getSelection();
	if (!selection) return;
	writeNativeRangeAt(
		selection,
		findLogicalDOMPoint(element, Math.max(0, anchorOffset)),
		findLogicalDOMPoint(element, Math.max(0, focusOffset)),
	);
}

/**
 * Collapses the native caret at the end of `element`'s contents. The cell
 * caret is not in the authority yet (W3 step 13), so cell activation writes
 * it here; step 13 projects it from the record instead.
 */
export function writeNativeCaretAtEnd(element: HTMLElement): void {
	const selection = element.ownerDocument.getSelection();
	if (!selection) return;
	const range = element.ownerDocument.createRange();
	range.selectNodeContents(element);
	range.collapse(false);
	replaceNativeRange(selection, range);
}

/** Clears the native range when it lies inside `root`. */
export function clearNativeRangeIn(root: HTMLElement): void {
	const selection = root.ownerDocument.getSelection();
	if (!selection || selection.rangeCount === 0) return;
	if (!selection.anchorNode || !root.contains(selection.anchorNode)) return;
	selection.removeAllRanges();
}

/** Replaces the native selection with `range`. */
export function replaceNativeRange(selection: Selection, range: Range): void {
	selection.removeAllRanges();
	selection.addRange(range);
}

/** Writes an EditContext's selection. */
export function writeEditContextSelection(
	editContext: { updateSelection(start: number, end: number): void },
	start: number,
	end: number,
): void {
	editContext.updateSelection(start, end);
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

type DOMPoint = { node: Node; offset: number };

/** Writes resolved DOM points, falling back where an engine rejects or normalizes the write. */
function writeNativeRangeAt(
	selection: Selection,
	rawAnchor: DOMPoint,
	rawFocus: DOMPoint,
): void {
	const anchor = resolveWritableDOMPoint(rawAnchor);
	const focus = resolveWritableDOMPoint(rawFocus);
	const intendedRange =
		anchor.node !== focus.node || anchor.offset !== focus.offset;

	if (trySetBaseAndExtent(selection, anchor, focus, intendedRange)) return;

	const collapseRange = document.createRange();
	collapseRange.setStart(anchor.node, anchor.offset);
	collapseRange.collapse(true);
	replaceNativeRange(selection, collapseRange);

	if (!intendedRange || tryExtend(selection, anchor, focus)) return;

	replaceNativeRange(selection, orderedRange(anchor, focus));
}

/** True when `setBaseAndExtent` exists and the endpoints stuck. */
function trySetBaseAndExtent(
	selection: Selection,
	anchor: DOMPoint,
	focus: DOMPoint,
	intendedRange: boolean,
): boolean {
	if (typeof selection.setBaseAndExtent !== "function") return false;
	try {
		selection.setBaseAndExtent(
			anchor.node,
			anchor.offset,
			focus.node,
			focus.offset,
		);
	} catch {
		// Fall back to the range-based path in test environments like jsdom.
		return false;
	}
	// Firefox accepts the call for mixed element/text points but leaves a
	// caret; only trust the write when the endpoints stuck.
	return !intendedRange || selectionHasEndpoints(selection, anchor, focus);
}

/** Extends a collapsed selection at `anchor` to `focus`; true when it took. */
function tryExtend(
	selection: Selection,
	anchor: DOMPoint,
	focus: DOMPoint,
): boolean {
	if (typeof selection.extend !== "function") return false;
	try {
		selection.extend(focus.node, focus.offset);
	} catch {
		// Fall through to an ordered addRange.
		return false;
	}
	return (
		selectionHasEndpoints(selection, anchor, focus) ||
		!selection.isCollapsed
	);
}

function orderedRange(anchor: DOMPoint, focus: DOMPoint): Range {
	const [start, end] =
		compareDOMPoints(anchor, focus) <= 0
			? [anchor, focus]
			: [focus, anchor];
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	return range;
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
