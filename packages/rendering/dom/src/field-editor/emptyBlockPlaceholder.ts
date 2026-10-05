import { DATA_ATTRS } from "../utils/dataAttributes";
import { isDomHTMLElement } from "../utils/domNodes";

/** Created in `doc`, the field's own document (an iframe's when mounted there). */
export function createEmptyBlockPlaceholder(
	doc: Document = document,
): HTMLElement {
	const br = doc.createElement("br");
	br.setAttribute(DATA_ATTRS.emptyBlock, "");
	return br;
}

export function isEmptyBlockPlaceholder(
	node: Node | null,
): node is HTMLElement {
	return (
		isDomHTMLElement(node) &&
		node.tagName === "BR" &&
		node.hasAttribute(DATA_ATTRS.emptyBlock)
	);
}

export function findEmptyBlockPlaceholder(
	element: HTMLElement,
): HTMLElement | null {
	for (const child of Array.from(element.childNodes)) {
		if (isEmptyBlockPlaceholder(child)) {
			return child;
		}
	}
	return null;
}

function fieldHasOnlyPlaceholder(element: HTMLElement): boolean {
	return (
		element.childNodes.length === 1 &&
		isEmptyBlockPlaceholder(element.firstChild)
	);
}

export function clearEmptyBlockPlaceholder(element: HTMLElement): void {
	if (fieldHasOnlyPlaceholder(element) && element.firstChild) {
		element.removeChild(element.firstChild);
	}
}

export function ensureEmptyBlockPlaceholder(element: HTMLElement): void {
	if (fieldHasNonPlaceholderContent(element)) {
		return;
	}
	if (fieldHasOnlyPlaceholder(element)) {
		return;
	}
	while (element.firstChild) {
		element.removeChild(element.firstChild);
	}
	element.appendChild(createEmptyBlockPlaceholder(element.ownerDocument));
}

function fieldHasNonPlaceholderContent(element: HTMLElement): boolean {
	if (element.querySelector(`[${DATA_ATTRS.inlineAtom}]`)) {
		return true;
	}
	for (const child of Array.from(element.childNodes)) {
		if (isEmptyBlockPlaceholder(child)) {
			continue;
		}
		if (child.nodeType === Node.TEXT_NODE) {
			if ((child.textContent ?? "").length > 0) {
				return true;
			}
			continue;
		}
		if (isDomHTMLElement(child)) {
			return true;
		}
	}
	return false;
}
