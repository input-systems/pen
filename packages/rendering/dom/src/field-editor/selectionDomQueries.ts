import { DATA_ATTRS } from "../utils/dataAttributes";

/**
 * Safely query a block element by ID, escaping special characters to prevent
 * selector injection from untrusted CRDT data.
 */
export function queryBlockElement(
	root: HTMLElement,
	blockId: string,
): HTMLElement | null {
	const escaped =
		typeof CSS !== "undefined" && CSS.escape
			? CSS.escape(blockId)
			: blockId.replace(/(["\]\\])/g, "\\$1");
	return root.querySelector(
		`[${DATA_ATTRS.blockId}="${escaped}"]`,
	) as HTMLElement | null;
}

/**
 * Find the inline content element for a given block.
 */
export function queryInlineElement(
	root: HTMLElement,
	blockId: string,
): HTMLElement | null {
	const blockEl = queryBlockElement(root, blockId);
	return blockEl ? findInlineContentElement(blockEl) : null;
}

/**
 * Find the ancestor block element for a given DOM node.
 */
export function findBlockElement(
	node: Node,
	root: HTMLElement,
): HTMLElement | null {
	let current: Node | null = node;
	while (current && current !== root) {
		if (
			current instanceof HTMLElement &&
			current.hasAttribute(DATA_ATTRS.editorBlock)
		) {
			return current;
		}
		current = current.parentNode;
	}
	return null;
}

/**
 * Find this block's own inline content element.
 * A descendant `querySelector` would steal a nested child's inline from a
 * container that has none of its own (opened `emailQuote`), mapping the
 * container's 0..1 extent (N2) into that child's text.
 */
export function findInlineContentElement(
	blockEl: HTMLElement,
): HTMLElement | null {
	for (const candidate of blockEl.querySelectorAll(
		`[${DATA_ATTRS.inlineContent}]`,
	)) {
		if (!(candidate instanceof HTMLElement)) {
			continue;
		}
		if (candidate.closest(`[${DATA_ATTRS.editorBlock}]`) === blockEl) {
			return candidate;
		}
	}
	return null;
}
