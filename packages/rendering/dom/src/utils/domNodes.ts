/**
 * Realm-safe node guards. `instanceof Node` uses the constructors of the
 * window this module was loaded in, so it is false for a node owned by an
 * iframe's document. A host that mounts the editor into an iframe hands us
 * exactly such nodes (`activeElement`, event targets, mutation targets).
 */

const ELEMENT_NODE = 1;
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** `value instanceof Node`, for a node from any window. */
export function isDomNode(value: unknown): value is Node {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { nodeType?: unknown }).nodeType === "number"
	);
}

/** `value instanceof Element`, for an element from any window. */
export function isDomElement(value: unknown): value is Element {
	return isDomNode(value) && value.nodeType === ELEMENT_NODE;
}

/** `value instanceof HTMLElement`, for an element from any window. */
export function isDomHTMLElement(value: unknown): value is HTMLElement {
	return isDomElement(value) && value.namespaceURI === XHTML_NAMESPACE;
}

/** The element `target` is, or the parent element of a non-element node. */
export function closestDomElement(target: unknown): Element | null {
	if (isDomElement(target)) {
		return target;
	}
	return isDomNode(target) ? target.parentElement : null;
}
