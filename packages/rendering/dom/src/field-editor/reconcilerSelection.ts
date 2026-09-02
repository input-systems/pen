import { domPointToLogicalOffset, findLogicalDOMPoint } from "./inlineAtomDom";

export interface SavedSelection {
	anchorOffset: number;
	focusOffset: number;
}

export function saveSelection(element: HTMLElement): SavedSelection | null {
	const sel = typeof window !== "undefined" ? window.getSelection() : null;
	if (!sel || sel.rangeCount === 0) return null;
	// element-local offsets cannot describe an endpoint outside the element;
	// restoring them would collapse a cross-block range into this block.
	if (
		!sel.anchorNode ||
		!sel.focusNode ||
		!element.contains(sel.anchorNode) ||
		!element.contains(sel.focusNode)
	) {
		return null;
	}

	const anchorOffset = computeCharacterOffset(
		element,
		sel.anchorNode,
		sel.anchorOffset,
	);
	const focusOffset = computeCharacterOffset(
		element,
		sel.focusNode,
		sel.focusOffset,
	);

	return { anchorOffset, focusOffset };
}

export function restoreSelection(
	element: HTMLElement,
	saved: SavedSelection | null,
): void {
	if (!saved) return;
	try {
		const sel = window.getSelection();
		if (!sel) return;

		const anchor = findPositionInDOM(element, saved.anchorOffset);
		const focus = findPositionInDOM(element, saved.focusOffset);
		if (!anchor || !focus) return;

		sel.setBaseAndExtent(
			anchor.node,
			anchor.offset,
			focus.node,
			focus.offset,
		);
	} catch {
		// Selection restoration can fail if DOM structure changed
	}
}

function computeCharacterOffset(
	root: HTMLElement,
	node: Node | null,
	offset: number,
): number {
	if (!node) return 0;
	return domPointToLogicalOffset(root, node, offset);
}

function findPositionInDOM(
	root: HTMLElement,
	charOffset: number,
): { node: Node; offset: number } | null {
	return findLogicalDOMPoint(root, charOffset);
}
