import type { FieldEditorTextChangeEvent } from "./crdt";
import {
	findEmptyBlockPlaceholder,
} from "./emptyBlockPlaceholder";
import { findLogicalDOMPoint } from "./inlineAtomDom";

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
			const walker = document.createTreeWalker(
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

export function shouldReplaceEditContextText(
	delta: FieldEditorTextChangeEvent["delta"],
	editContextTextLength: number,
): boolean {
	let offset = 0;
	for (const entry of delta) {
		if (entry.retain != null) {
			offset += entry.retain;
			if (offset > editContextTextLength) return true;
		} else if (typeof entry.insert === "string") {
			if (offset > editContextTextLength) return true;
			offset += entry.insert.length;
		} else if (entry.delete != null) {
			if (offset + entry.delete > editContextTextLength) return true;
		}
	}
	return false;
}

function getCharacterRect(element: HTMLElement, charOffset: number): DOMRect {
	const start = findLogicalDOMPoint(element, Math.max(0, charOffset));
	const end = findLogicalDOMPoint(element, Math.max(0, charOffset + 1));
	const range = document.createRange();
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
