import {
	domPointToLogicalOffset,
	getLogicalNodeLength,
	getLogicalTextContent,
} from "../field-editor/inlineAtomDom";
import { toLogicalOffset } from "../field-editor/offsetDomain";
import { pointToEditorSelectionPoint } from "../field-editor/selectionBridge";
import {
	findBlockElement,
	findInlineContentElement,
} from "../field-editor/selectionDomQueries";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { snapToLogicalOffset } from "./geometryMeasure";
import type { Point } from "./types";
import { getDistanceToRect } from "./types";

export function measurePointAt(
	root: HTMLElement,
	x: number,
	y: number,
): Point | null {
	if (!isInsideAnyBlock(root, x, y)) {
		return nearestBlockEdge(root, x, y);
	}

	const fromCaret = hitTestCaretFromPoint(root, x, y);
	if (fromCaret) {
		return snapToLogicalOffset(root, fromCaret);
	}

	const fallback = pointToEditorSelectionPoint(root, x, y);
	if (fallback) {
		return snapToLogicalOffset(root, fallback);
	}

	const edge = nearestBlockEdge(root, x, y);
	return edge ? snapToLogicalOffset(root, edge) : null;
}

function hitTestCaretFromPoint(
	root: HTMLElement,
	x: number,
	y: number,
): Point | null {
	const doc = root.ownerDocument as Document & {
		caretPositionFromPoint?: (
			x: number,
			y: number,
		) => { offsetNode: Node; offset: number } | null;
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	};

	const position = doc.caretPositionFromPoint?.(x, y);
	if (position) {
		return domToPoint(root, position.offsetNode, position.offset);
	}

	const range = doc.caretRangeFromPoint?.(x, y);
	if (range) {
		return domToPoint(root, range.startContainer, range.startOffset);
	}

	return null;
}

function domToPoint(
	root: HTMLElement,
	node: Node,
	offset: number,
): Point | null {
	const blockEl = findBlockElement(node, root);
	if (!blockEl) {
		return null;
	}
	const blockId = blockEl.getAttribute(DATA_ATTRS.blockId);
	if (!blockId) {
		return null;
	}
	const inlineEl = findInlineContentElement(blockEl);
	if (!inlineEl) {
		return { blockId, offset: 0 };
	}
	return {
		blockId,
		offset: toLogicalOffset(
			domPointToLogicalOffset(inlineEl, node, offset),
			getLogicalTextContent(inlineEl),
		),
	};
}

function isInsideAnyBlock(root: HTMLElement, x: number, y: number): boolean {
	for (const element of listDomBlockElements(root)) {
		const rect = element.getBoundingClientRect();
		if (
			x >= rect.left &&
			x <= rect.right &&
			y >= rect.top &&
			y <= rect.bottom
		) {
			return true;
		}
	}
	return false;
}

function nearestBlockEdge(
	root: HTMLElement,
	x: number,
	y: number,
): Point | null {
	const blocks = listDomBlockElements(root)
		.map((el) => ({
			el,
			rect: el.getBoundingClientRect(),
			id: el.getAttribute(DATA_ATTRS.blockId),
		}))
		.filter(
			(block): block is { el: HTMLElement; rect: DOMRect; id: string } =>
				Boolean(block.id),
		);
	if (blocks.length === 0) {
		return null;
	}

	const inBand = blocks.filter(
		(block) => y >= block.rect.top && y <= block.rect.bottom,
	);
	const candidates = inBand.length > 0 ? inBand : blocks;

	let best = candidates[0];
	if (!best) {
		return null;
	}
	let bestScore = Number.POSITIVE_INFINITY;
	for (const block of candidates) {
		const { dx, dy } = getDistanceToRect(block.rect, x, y);
		const score = inBand.length > 0 ? dx : dy * 1000 + dx;
		if (score < bestScore) {
			bestScore = score;
			best = block;
		}
	}

	const inline = findInlineContentElement(best.el);
	const length = inline ? getLogicalNodeLength(inline) : 0;
	if (y < best.rect.top) {
		return { blockId: best.id, offset: 0 };
	}
	if (y > best.rect.bottom) {
		return { blockId: best.id, offset: length };
	}
	const midX = best.rect.left + best.rect.width / 2;
	return { blockId: best.id, offset: x <= midX ? 0 : length };
}

export function listDomBlockIds(root: HTMLElement): readonly string[] {
	return listDomBlockElements(root).flatMap((element) => {
		const id = element.getAttribute(DATA_ATTRS.blockId);
		return id ? [id] : [];
	});
}

export function listDomBlockElements(root: HTMLElement): HTMLElement[] {
	return Array.from(
		root.querySelectorAll(`[${DATA_ATTRS.editorBlock}]`),
	).filter(
		(element): element is HTMLElement => element instanceof HTMLElement,
	);
}
