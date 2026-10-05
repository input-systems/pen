import type { SchemaRegistry } from "@input/pen-types";
import type { UrlPolicy } from "../security/urlPolicy";
import type { FieldEditorDelta } from "./crdt";
import {
	clearEmptyBlockPlaceholder,
	ensureEmptyBlockPlaceholder,
} from "./emptyBlockPlaceholder";
import {
	clearTrailingLineBreak,
	syncTrailingLineBreak,
} from "./trailingLineBreak";
import { getLogicalNodeLength, isInlineAtomNode } from "./inlineAtomDom";
import { createMarkedNode } from "./reconcilerMarks";

export function applyDeltaToDOM(
	delta: readonly FieldEditorDelta[],
	element: HTMLElement,
	registry: SchemaRegistry,
	policy?: UrlPolicy,
): boolean {
	let childIndex = 0;
	let textOffset = 0;
	clearEmptyBlockPlaceholder(element);
	// An insert that lands on the break finds a `<br>` with no text leaf and
	// bails to full reconcile, which is every keystroke at the end of a field
	// whose text ends with `\n`. Clearing it first keeps the fast path.
	clearTrailingLineBreak(element);

	for (const entry of delta) {
		if (entry.retain != null) {
			let remaining = entry.retain;
			while (remaining > 0 && childIndex < element.childNodes.length) {
				const span = element.childNodes[childIndex];
				const available = getLogicalNodeLength(span) - textOffset;

				if (remaining < available) {
					textOffset += remaining;
					remaining = 0;
				} else {
					remaining -= available;
					childIndex++;
					textOffset = 0;
				}
			}
			if (remaining > 0) return false;

			if (entry.attributes != null) {
				return false;
			}
		} else if (typeof entry.insert === "string") {
			const text = entry.insert;

			if (!entry.attributes) {
				const span = element.childNodes[childIndex];
				if (span && span.nodeType === Node.TEXT_NODE) {
					const existing = span.textContent ?? "";
					span.textContent =
						existing.slice(0, textOffset) +
						text +
						existing.slice(textOffset);
					textOffset += text.length;
				} else if (span && span.nodeType === Node.ELEMENT_NODE) {
					if (isInlineAtomNode(span)) {
						if (textOffset !== 0) return false;
						element.insertBefore(
							element.ownerDocument.createTextNode(text),
							span,
						);
						childIndex++;
						textOffset = 0;
						continue;
					}
					const leaf = deepLeafText(span);
					if (!leaf) return false;
					const existing = leaf.textContent ?? "";
					leaf.textContent =
						existing.slice(0, textOffset) +
						text +
						existing.slice(textOffset);
					textOffset += text.length;
				} else {
					element.appendChild(element.ownerDocument.createTextNode(text));
					childIndex = element.childNodes.length - 1;
					textOffset = text.length;
				}
			} else {
				if (textOffset === 0) {
					const node = createMarkedNode(
						text,
						entry.attributes,
						registry,
						policy,
						element.ownerDocument,
					);
					const ref = element.childNodes[childIndex] ?? null;
					element.insertBefore(node, ref);
					childIndex++;
				} else {
					return false;
				}
			}
		} else if (entry.insert != null) {
			return false;
		} else if (entry.delete != null) {
			let remaining = entry.delete;
			while (remaining > 0 && childIndex < element.childNodes.length) {
				const span = element.childNodes[childIndex];
				if (isInlineAtomNode(span)) {
					if (textOffset !== 0) return false;
					element.removeChild(span);
					remaining -= 1;
					continue;
				}
				const leaf =
					span.nodeType === Node.TEXT_NODE
						? span
						: deepLeafText(span);
				if (!leaf) return false;
				const existing = leaf.textContent ?? "";
				const available = getLogicalNodeLength(span) - textOffset;

				if (remaining < available) {
					leaf.textContent =
						existing.slice(0, textOffset) +
						existing.slice(textOffset + remaining);
					remaining = 0;
				} else {
					if (textOffset === 0) {
						element.removeChild(span);
						remaining -= existing.length;
					} else {
						leaf.textContent = existing.slice(0, textOffset);
						remaining -= available;
						childIndex++;
						textOffset = 0;
					}
				}
			}
		}
	}
	ensureEmptyBlockPlaceholder(element);
	syncTrailingLineBreak(element);
	return true;
}

function deepLeafText(node: Node): Text | null {
	if (node.nodeType === Node.TEXT_NODE) return node as Text;
	for (let index = 0; index < node.childNodes.length; index++) {
		const found = deepLeafText(node.childNodes[index]);
		if (found) return found;
	}
	return null;
}
