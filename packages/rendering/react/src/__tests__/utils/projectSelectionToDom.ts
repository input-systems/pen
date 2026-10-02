import {
	findDOMPoint,
	type SelectionPoint,
} from "@input/pen-dom/field-editor/selectionBridge";

/**
 * Test-side DOM selection writer. Production code writes the selection only
 * through the field editor's projector (S1); tests that simulate a user or
 * browser placing the native range use this instead.
 */
export function projectSelectionToDom(
	root: HTMLElement,
	anchor: SelectionPoint,
	focus: SelectionPoint,
): void {
	const anchorPoint = findDOMPoint(root, anchor.blockId, anchor.offset);
	const focusPoint = findDOMPoint(root, focus.blockId, focus.offset);
	const selection = root.ownerDocument.defaultView?.getSelection();
	if (!anchorPoint || !focusPoint || !selection) return;
	const writableAnchor = textPoint(anchorPoint);
	const writableFocus = textPoint(focusPoint);
	selection.setBaseAndExtent(
		writableAnchor.node,
		writableAnchor.offset,
		writableFocus.node,
		writableFocus.offset,
	);
}

/** Moves an element point onto the adjacent text node, as the projector does. */
function textPoint(point: { node: Node; offset: number }): {
	node: Node;
	offset: number;
} {
	if (point.node.nodeType !== Node.ELEMENT_NODE) return point;
	const childAtOffset = point.node.childNodes[point.offset];
	if (childAtOffset?.nodeType === Node.TEXT_NODE) {
		return { node: childAtOffset, offset: 0 };
	}
	const previousChild = point.node.childNodes[point.offset - 1];
	if (point.offset > 0 && previousChild?.nodeType === Node.TEXT_NODE) {
		return {
			node: previousChild,
			offset: previousChild.textContent?.length ?? 0,
		};
	}
	return point;
}
