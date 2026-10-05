import { DATA_ATTRS } from "../utils/dataAttributes";
import { isDomHTMLElement } from "../utils/domNodes";
import { isEmptyBlockPlaceholder } from "./emptyBlockPlaceholder";
import { getLogicalNodeText } from "./inlineAtomLogicalDom";

/** Created in `doc`, the field's own document (an iframe's when mounted there). */
export function createTrailingLineBreak(doc: Document = document): HTMLElement {
	const br = doc.createElement("br");
	br.setAttribute(DATA_ATTRS.trailingBreak, "");
	return br;
}

export function isTrailingLineBreak(node: Node | null): node is HTMLElement {
	return (
		isDomHTMLElement(node) &&
		node.tagName === "BR" &&
		node.hasAttribute(DATA_ATTRS.trailingBreak)
	);
}

export function clearTrailingLineBreak(element: HTMLElement): void {
	const last = element.lastChild;
	if (isTrailingLineBreak(last)) {
		element.removeChild(last);
	}
}

/**
 * RI5: a field whose text ends with `\n` needs a `<br>` after it. `white-space:
 * pre-wrap` honors interior newlines but gives a trailing one no line box, so
 * the last line is invisible and the caret has nowhere to land. The element
 * carries no logical length or text, so offset mapping and the DOM/Y.Text
 * watchdog read straight through it.
 */
export function syncTrailingLineBreak(element: HTMLElement): void {
	const present = isTrailingLineBreak(element.lastChild);
	const needed = endsWithNewline(element);
	if (needed === present) {
		return;
	}
	if (needed) {
		element.appendChild(createTrailingLineBreak(element.ownerDocument));
		return;
	}
	clearTrailingLineBreak(element);
}

/**
 * Reads the last content node rather than the field's whole logical text: this
 * runs on every incremental delta apply, so it stays off the typing path's
 * length budget.
 */
function endsWithNewline(element: HTMLElement): boolean {
	for (let index = element.childNodes.length - 1; index >= 0; index--) {
		const child = element.childNodes[index];
		if (isTrailingLineBreak(child) || isEmptyBlockPlaceholder(child)) {
			continue;
		}
		return getLogicalNodeText(child).endsWith("\n");
	}
	return false;
}
