import { DATA_ATTRS } from "../utils/dataAttributes";
import { isEmptyBlockPlaceholder } from "./emptyBlockPlaceholder";
import { INLINE_ATOM_REPLACEMENT_TEXT } from "./inlineAtomModel";
import {
	isInlineAtomCaretBoundaryNode,
	isInlineAtomChipNode,
	isInlineAtomHostNode,
	isInlineAtomNode,
	type InlineAtomCaretBoundarySide,
} from "./inlineAtomDom";
import { isDomHTMLElement } from "../utils/domNodes";

const VIRTUAL_INLINE_DECORATION_ATTRIBUTE = "data-pen-virtual-inline";

function getInlineAtomHostElement(node: Node): HTMLElement | null {
	if (isInlineAtomHostNode(node)) {
		return node;
	}
	if (isInlineAtomChipNode(node) || isInlineAtomCaretBoundaryNode(node)) {
		const parent = node.parentElement;
		return isInlineAtomHostNode(parent) ? parent : null;
	}
	return null;
}

function getInlineAtomCaretBoundaryElement(
	host: HTMLElement,
	side: InlineAtomCaretBoundarySide,
): HTMLElement | null {
	for (const child of Array.from(host.childNodes)) {
		if (
			isInlineAtomCaretBoundaryNode(child) &&
			child.getAttribute(DATA_ATTRS.inlineAtomCaretSide) === side
		) {
			return child;
		}
	}
	return null;
}

function getInlineAtomCaretBoundaryTextPoint(
	host: HTMLElement,
	side: InlineAtomCaretBoundarySide,
): { node: Node; offset: number } | null {
	const boundary = getInlineAtomCaretBoundaryElement(host, side);
	return boundary ? { node: boundary, offset: 0 } : null;
}

function resolveLogicalInlineAtomUnit(node: HTMLElement): HTMLElement {
	return getInlineAtomHostElement(node) ?? node;
}

export function getLogicalNodeLength(node: Node): number {
	if (isEmptyBlockPlaceholder(node) || isVirtualInlineDecorationNode(node)) {
		return 0;
	}
	if (
		isInlineAtomCaretBoundaryNode(node) ||
		hasInlineAtomCaretBoundaryAncestor(node)
	) {
		return 0;
	}

	if (isInlineAtomHostNode(node)) {
		return 1;
	}

	if (isInlineAtomChipNode(node)) {
		return getInlineAtomHostElement(node) ? 0 : 1;
	}

	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent?.length ?? 0;
	}

	let length = 0;
	for (const child of Array.from(node.childNodes)) {
		length += getLogicalNodeLength(child);
	}
	return length;
}

export function getLogicalTextContent(root: HTMLElement): string {
	let text = "";
	for (const child of Array.from(root.childNodes)) {
		text += getLogicalNodeText(child);
	}
	return text;
}

export function getInlineAtomPointerOffset(
	container: HTMLElement,
	clientX: number,
	clientY: number,
): number | null {
	const atomElements = Array.from(
		container.querySelectorAll(`[${DATA_ATTRS.inlineAtom}]`),
	).filter(
		isDomHTMLElement,
	);
	if (atomElements.length === 0) {
		return null;
	}

	let bestOffset: number | null = null;
	let bestScore = Number.POSITIVE_INFINITY;
	// The half a click lands on is the side it takes (O1): the visual left
	// half is the atom's logical start in left-to-right text, its end in
	// right-to-left text.
	const rtl =
		container.ownerDocument.defaultView?.getComputedStyle(container)
			.direction === "rtl";

	for (const atomElement of atomElements) {
		const rect = atomElement.getBoundingClientRect();
		const dx =
			clientX < rect.left
				? rect.left - clientX
				: clientX > rect.right
					? clientX - rect.right
					: 0;
		const dy =
			clientY < rect.top
				? rect.top - clientY
				: clientY > rect.bottom
					? clientY - rect.bottom
					: 0;
		const score = dy * 1000 + dx;
		if (score >= bestScore) {
			continue;
		}

		const logicalAtom = resolveLogicalInlineAtomUnit(atomElement);
		const atomOffset = getOffsetBeforeNode(container, logicalAtom);
		const inLeftHalf = clientX <= rect.left + rect.width / 2;
		bestOffset = inLeftHalf !== rtl ? atomOffset : atomOffset + 1;
		bestScore = score;
	}

	return bestOffset;
}

export function domPointToLogicalOffset(
	container: HTMLElement,
	targetNode: Node,
	targetOffset: number,
): number {
	const boundaryAncestor = findAncestorWithin(
		targetNode,
		container,
		isInlineAtomCaretBoundaryNode,
	);
	if (boundaryAncestor) {
		const side = boundaryAncestor.getAttribute(
			DATA_ATTRS.inlineAtomCaretSide,
		) as InlineAtomCaretBoundarySide | null;
		const host = getInlineAtomHostElement(boundaryAncestor);
		if (host && (side === "before" || side === "after")) {
			const hostOffset = getOffsetBeforeNode(container, host);
			return side === "before" ? hostOffset : hostOffset + 1;
		}
	}

	const atomAncestor = findAncestorWithin(targetNode, container, isInlineAtomNode);
	if (atomAncestor) {
		const logicalAtom = resolveLogicalInlineAtomUnit(atomAncestor);
		const atomOffset = getOffsetBeforeNode(container, logicalAtom);
		if (logicalAtom === targetNode || isInlineAtomChipNode(atomAncestor)) {
			return targetOffset <= 0 ? atomOffset : atomOffset + 1;
		}
		return atomOffset + 1;
	}

	const resolved = resolveLogicalOffset(container, targetNode, targetOffset);
	return resolved ?? getLogicalNodeLength(container);
}

export function findLogicalDOMPoint(
	container: HTMLElement,
	offset: number,
): { node: Node; offset: number } {
	return findLogicalDOMPointInElement(container, Math.max(0, offset));
}

export function getLogicalNodeText(node: Node): string {
	if (isEmptyBlockPlaceholder(node) || isVirtualInlineDecorationNode(node)) {
		return "";
	}
	if (
		isInlineAtomCaretBoundaryNode(node) ||
		hasInlineAtomCaretBoundaryAncestor(node)
	) {
		return "";
	}

	if (isInlineAtomHostNode(node)) {
		return INLINE_ATOM_REPLACEMENT_TEXT;
	}

	if (isInlineAtomChipNode(node)) {
		return getInlineAtomHostElement(node)
			? ""
			: INLINE_ATOM_REPLACEMENT_TEXT;
	}

	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent ?? "";
	}

	let text = "";
	for (const child of Array.from(node.childNodes)) {
		text += getLogicalNodeText(child);
	}
	return text;
}

function isVirtualInlineDecorationNode(node: Node | null): node is HTMLElement {
	return (
		isDomHTMLElement(node) &&
		node.hasAttribute(VIRTUAL_INLINE_DECORATION_ATTRIBUTE)
	);
}

/** `node` or its nearest ancestor below `container` that `matches`. */
function findAncestorWithin(
	node: Node,
	container: HTMLElement,
	matches: (node: Node) => node is HTMLElement,
): HTMLElement | null {
	let current: Node | null = node;
	while (current && current !== container) {
		if (matches(current)) {
			return current;
		}
		current = current.parentNode;
	}
	return null;
}

function hasInlineAtomCaretBoundaryAncestor(node: Node): boolean {
	let current: Node | null = node.parentNode;
	while (current) {
		if (isInlineAtomCaretBoundaryNode(current)) {
			return true;
		}
		if (isInlineAtomHostNode(current)) {
			return false;
		}
		current = current.parentNode;
	}
	return false;
}

function getOffsetBeforeNode(container: HTMLElement, target: Node): number {
	let offset = 0;
	let found = false;

	const visit = (node: Node) => {
		if (found) {
			return;
		}
		if (node === target) {
			found = true;
			return;
		}
		if (node !== container) {
			offset += getLogicalNodeLength(node);
			return;
		}
		for (const child of Array.from(node.childNodes)) {
			visit(child);
			if (found) {
				return;
			}
		}
	};

	visit(container);
	return offset;
}

function resolveLogicalOffset(
	current: Node,
	targetNode: Node,
	targetOffset: number,
): number | null {
	if (isVirtualInlineDecorationNode(current)) {
		return current === targetNode || current.contains(targetNode)
			? 0
			: null;
	}
	if (current === targetNode) {
		if (isEmptyBlockPlaceholder(current)) {
			return 0;
		}

		if (isInlineAtomHostNode(current)) {
			return targetOffset <= 0 ? 0 : 1;
		}

		if (isInlineAtomChipNode(current)) {
			return getInlineAtomHostElement(current)
				? null
				: targetOffset <= 0
					? 0
					: 1;
		}

		if (isInlineAtomCaretBoundaryNode(current)) {
			return 0;
		}

		if (current.nodeType === Node.TEXT_NODE) {
			return Math.min(targetOffset, current.textContent?.length ?? 0);
		}

		let offset = 0;
		const children = Array.from(current.childNodes);
		for (
			let index = 0;
			index < targetOffset && index < children.length;
			index += 1
		) {
			offset += getLogicalNodeLength(children[index]);
		}
		return offset;
	}

	if (
		current.nodeType === Node.TEXT_NODE ||
		isInlineAtomHostNode(current) ||
		isInlineAtomChipNode(current) ||
		isInlineAtomCaretBoundaryNode(current)
	) {
		return null;
	}

	let offset = 0;
	for (const child of Array.from(current.childNodes)) {
		const childOffset = resolveLogicalOffset(
			child,
			targetNode,
			targetOffset,
		);
		if (childOffset !== null) {
			return offset + childOffset;
		}
		offset += getLogicalNodeLength(child);
	}

	return null;
}

function findLogicalDOMPointInElement(
	element: HTMLElement,
	offset: number,
): { node: Node; offset: number } {
	let remaining = offset;
	const children = Array.from(element.childNodes);

	for (let index = 0; index < children.length; index += 1) {
		const child = children[index];
		const length = getLogicalNodeLength(child);

		if (remaining === 0) {
			if (isInlineAtomHostNode(child)) {
				const boundaryPoint = getInlineAtomCaretBoundaryTextPoint(
					child,
					"before",
				);
				if (boundaryPoint) {
					return boundaryPoint;
				}
			}
			if (child.nodeType === Node.TEXT_NODE) {
				return { node: child, offset: 0 };
			}
			return { node: element, offset: index };
		}

		if (child.nodeType === Node.TEXT_NODE) {
			if (remaining <= length) {
				return { node: child, offset: remaining };
			}
			remaining -= length;
			continue;
		}

		if (isInlineAtomHostNode(child)) {
			if (remaining <= 1) {
				const boundaryPoint = getInlineAtomCaretBoundaryTextPoint(
					child,
					remaining === 0 ? "before" : "after",
				);
				if (boundaryPoint) {
					return boundaryPoint;
				}
				return { node: element, offset: index + 1 };
			}
			remaining -= 1;
			continue;
		}

		if (isInlineAtomChipNode(child)) {
			if (remaining <= 1) {
				return { node: element, offset: index + 1 };
			}
			remaining -= 1;
			continue;
		}

		if (
			isInlineAtomCaretBoundaryNode(child) ||
			isEmptyBlockPlaceholder(child)
		) {
			continue;
		}

		if (remaining <= length && isDomHTMLElement(child)) {
			return findLogicalDOMPointInElement(child, remaining);
		}

		remaining -= length;
	}

	return { node: element, offset: children.length };
}
