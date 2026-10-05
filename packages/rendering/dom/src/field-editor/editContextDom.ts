import type { SchemaRegistry } from "@input/pen-types";
import type { UrlPolicy } from "../security/urlPolicy";
import type { FieldEditorDelta } from "./crdt";
import {
	findEmptyBlockPlaceholder,
} from "./emptyBlockPlaceholder";
import { findLogicalDOMPoint, getLogicalNodeLength } from "./inlineAtomDom";
import { INLINE_ATOM_REPLACEMENT_TEXT } from "./inlineAtomModel";
import { applyDeltaToDOM } from "./reconciler";
import { isDomText } from "../utils/domNodes";

/**
 * Applies a `Y.Text` delta to the field's logical text (one U+FFFC per
 * inline atom), so the backend can follow `Y.Text` without reading it back.
 */
export function applyDeltaToLogicalText(
	text: string,
	delta: readonly FieldEditorDelta[],
): string {
	let result = "";
	let offset = 0;
	for (const entry of delta) {
		if (entry.retain != null) {
			result += text.slice(offset, offset + entry.retain);
			offset += entry.retain;
		} else if (entry.delete != null) {
			offset += entry.delete;
		} else if (typeof entry.insert === "string") {
			result += entry.insert;
		} else if (entry.insert != null) {
			result += INLINE_ATOM_REPLACEMENT_TEXT;
		}
	}
	return result + text.slice(offset);
}

/**
 * C4: shows one composition edit in the field — `deleteLength` logical
 * characters at `offset` replaced by `text` — without touching `Y.Text`.
 * An edit inside one text node goes through `replaceData`, which leaves a
 * native caret at or before `offset` where it is, so painting raises no
 * `selectionchange` for the reader to take; any other edit goes through the
 * delta reconciler. False when neither could paint it.
 */
export function paintEditContextComposition(
	element: HTMLElement,
	edit: { offset: number; deleteLength: number; text: string },
	registry: SchemaRegistry,
	policy?: UrlPolicy,
): boolean {
	const { offset, deleteLength, text } = edit;
	const point = findLogicalDOMPoint(element, offset);
	if (
		isDomText(point.node) &&
		getLogicalNodeLength(point.node) === point.node.length &&
		point.offset + deleteLength <= point.node.length
	) {
		point.node.replaceData(point.offset, deleteLength, text);
		return true;
	}
	const delta: FieldEditorDelta[] = [];
	if (offset > 0) delta.push({ retain: offset });
	if (deleteLength > 0) delta.push({ delete: deleteLength });
	if (text.length > 0) delta.push({ insert: text });
	return applyDeltaToDOM(delta, element, registry, policy);
}

export type EditContextTextFormat = {
	rangeStart: number;
	rangeEnd: number;
	underlineStyle?: string;
	underlineThickness?: string;
};

export function applyEditContextTextFormats(
	element: HTMLElement,
	ranges: readonly EditContextTextFormat[],
): void {
	for (const fmt of ranges) {
		const { rangeStart, rangeEnd, underlineStyle, underlineThickness } =
			fmt;
		if (!underlineStyle) continue;

		const inlineEls = element.querySelectorAll("[data-pen-inline-content]");
		for (const el of inlineEls) {
			const walker = element.ownerDocument.createTreeWalker(
				el,
				NodeFilter.SHOW_TEXT,
				null,
			);
			let offset = 0;
			let textNode: Text | null;
			while ((textNode = walker.nextNode() as Text | null)) {
				const len = textNode.textContent?.length ?? 0;
				const segStart = offset;
				const segEnd = offset + len;
				if (segEnd > rangeStart && segStart < rangeEnd) {
					const parentEl = textNode.parentElement;
					if (parentEl) {
						parentEl.style.textDecoration = underlineStyle;
						if (underlineThickness) {
							parentEl.style.textDecorationThickness =
								underlineThickness;
						}
					}
				}
				offset += len;
			}
		}
	}
}

export function buildEditContextCharacterBounds(
	element: HTMLElement,
	rangeStart: number,
	rangeEnd: number,
): DOMRect[] {
	const rects: DOMRect[] = [];
	for (let index = rangeStart; index < rangeEnd; index += 1) {
		rects.push(getCharacterRect(element, index));
	}
	return rects;
}

export function findTextPosition(
	container: HTMLElement,
	charOffset: number,
): { node: Node; offset: number } {
	return findLogicalDOMPoint(container, Math.max(0, charOffset));
}

function getCharacterRect(element: HTMLElement, charOffset: number): DOMRect {
	const start = findLogicalDOMPoint(element, Math.max(0, charOffset));
	const end = findLogicalDOMPoint(element, Math.max(0, charOffset + 1));
	const range = element.ownerDocument.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	const rect = range.getBoundingClientRect();
	if (rect.width > 0 || rect.height > 0) {
		return rect;
	}
	const placeholder = findEmptyBlockPlaceholder(element);
	if (placeholder) {
		return placeholder.getBoundingClientRect();
	}
	return element.getBoundingClientRect();
}
