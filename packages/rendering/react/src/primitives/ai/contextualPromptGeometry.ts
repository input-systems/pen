import type { Editor } from "@input/pen-types";
import type { AIContextualPromptAnchor, AISession } from "@input/pen-ai";
import {
	measureWithRoot,
	type GeometryReader,
	type Rect,
} from "@input/pen-dom";
import {
	getTextSelectionClientRects,
	queryBlockElement,
} from "@input/pen-dom/field-editor/selectionBridge";
import { resolveSelectionRect } from "@input/pen-dom/utils/selectionPlacement";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import {
	queryEditorBlockElement,
	resolveEditorContentElement,
} from "../../utils/aiDomScope";
import type { ContextualPromptPlacement } from "./contextualPromptTypes";
import { isDomHTMLElement } from "@input/pen-dom/utils/domNodes";

export function resolveAnchorRect(
	hostElement: HTMLElement,
	anchor: AIContextualPromptAnchor,
): DOMRect | null {
	return measureWithRoot(geometryRoot(hostElement), ({ reader }) => {
		if (anchor.selectionSnapshot?.blockRange.length) {
			const blockRects = readBlockDomRects(
				reader,
				anchor.selectionSnapshot.blockRange,
			);
			if (blockRects.length > 0) {
				return mergeDomRects(blockRects);
			}
		}
		if (anchor.focusBlockId) {
			return rectToDomRect(reader.blockRect(anchor.focusBlockId));
		}
		return null;
	});
}

export function resolveInsertedAnchorRect(
	hostElement: HTMLElement,
	anchor: AIContextualPromptAnchor,
): DOMRect | null {
	const focusBlockId = anchor.focusBlockId;
	if (!focusBlockId) {
		return resolveFallbackRect(anchor.lastResolvedRect);
	}

	return measureWithRoot(geometryRoot(hostElement), ({ reader }) => {
		return (
			rectToDomRect(reader.blockRect(focusBlockId)) ??
			resolveFallbackRect(anchor.lastResolvedRect)
		);
	});
}

export function resolvePromptSelectionRects(
	hostElement: HTMLElement,
	session: AISession,
): readonly DOMRect[] {
	const selectionSnapshot =
		session.contextualPrompt?.anchor.selectionSnapshot;
	if (selectionSnapshot) {
		const selectionRects = getTextSelectionClientRects(hostElement, {
			anchor: selectionSnapshot.anchor,
			focus: selectionSnapshot.focus,
		});
		if (selectionRects.length > 0) {
			return selectionRects;
		}
	}

	const fallbackRect = resolveFallbackRect(
		session.contextualPrompt?.anchor.lastResolvedRect ?? null,
	);
	if (fallbackRect) {
		return [fallbackRect];
	}

	if (selectionSnapshot?.blockRange.length) {
		const blockRects = measureWithRoot(
			geometryRoot(hostElement),
			({ reader }) =>
				readBlockDomRects(reader, selectionSnapshot.blockRange),
		);
		if (blockRects.length > 0) {
			return blockRects;
		}
	}

	return [];
}

/**
 * The rect of the selection the prompt was opened on, while the editor's
 * selection is still that selection. Measured from the authority through the
 * geometry reader (W3.R5), never from the live range.
 */
export function resolveLiveSelectionRect(
	editor: Editor,
	hostElement: HTMLElement,
	selectionSnapshot: AIContextualPromptAnchor["selectionSnapshot"],
): DOMRect | null {
	const selection = editor.selection;
	if (selection?.type !== "text") {
		return null;
	}
	if (
		selectionSnapshot &&
		!selectionMatchesSnapshot(selection, selectionSnapshot)
	) {
		return null;
	}
	if (
		!queryBlockElement(hostElement, selection.anchor.blockId) ||
		!queryBlockElement(hostElement, selection.focus.blockId)
	) {
		return null;
	}
	return resolveSelectionRect(geometryRoot(hostElement), selection);
}

export function resolvePromptHostElement(
	editor: Editor,
	session: AISession,
): HTMLElement | null {
	const selectionSnapshot =
		session.contextualPrompt?.anchor.selectionSnapshot;
	const anchorBlockId =
		selectionSnapshot?.blockRange[0] ??
		selectionSnapshot?.anchor.blockId ??
		session.contextualPrompt?.anchor.focusBlockId ??
		null;
	if (anchorBlockId) {
		const anchorBlock = queryEditorBlockElement(editor, anchorBlockId);
		const rootElement =
			anchorBlock?.closest("[data-pen-ai-root]") ??
			anchorBlock?.closest("[data-pen-editor-root]");
		const hostElement =
			rootElement?.querySelector("[data-pen-editor-content]") ??
			(anchorBlock?.closest(
				"[data-pen-editor-content]",
			) as HTMLElement | null);
		if (isDomHTMLElement(hostElement)) {
			return hostElement;
		}
	}

	return resolveEditorContentElement(editor);
}

function geometryRoot(hostElement: HTMLElement): HTMLElement {
	const root = hostElement.closest(`[${DATA_ATTRS.editorRoot}]`);
	return isDomHTMLElement(root) ? root : hostElement;
}

function readBlockDomRects(
	reader: GeometryReader,
	blockIds: readonly string[],
): DOMRect[] {
	const rects: DOMRect[] = [];
	for (const blockId of blockIds) {
		const rect = rectToDomRect(reader.blockRect(blockId));
		if (rect) {
			rects.push(rect);
		}
	}
	return rects;
}

function rectToDomRect(rect: Rect | null): DOMRect | null {
	return rect
		? createDomRect(rect.top, rect.left, rect.width, rect.height)
		: null;
}

function mergeDomRects(rects: readonly DOMRect[]): DOMRect | null {
	if (rects.length === 0) {
		return null;
	}
	const top = Math.min(...rects.map((rect) => rect.top));
	const left = Math.min(...rects.map((rect) => rect.left));
	const right = Math.max(...rects.map((rect) => rect.right));
	const bottom = Math.max(...rects.map((rect) => rect.bottom));
	return createDomRect(top, left, right - left, bottom - top);
}

export function areContextualPromptLayoutsEqual(
	previous: ContextualPromptPlacement | null,
	next: ContextualPromptPlacement | null,
): boolean {
	if (previous === next) {
		return true;
	}
	if (!previous || !next) {
		return false;
	}
	return (
		previous.anchorBlockId === next.anchorBlockId &&
		previous.side === next.side &&
		previous.top === next.top &&
		previous.left === next.left &&
		previous.anchorRect.top === next.anchorRect.top &&
		previous.anchorRect.left === next.anchorRect.left &&
		previous.anchorRect.width === next.anchorRect.width &&
		previous.anchorRect.height === next.anchorRect.height
	);
}

export function areRectListsEqual(
	previous: readonly DOMRect[],
	next: readonly DOMRect[],
): boolean {
	if (previous === next) {
		return true;
	}
	if (previous.length !== next.length) {
		return false;
	}
	return previous.every((rect, index) => {
		const nextRect = next[index];
		return (
			rect.top === nextRect.top &&
			rect.left === nextRect.left &&
			rect.width === nextRect.width &&
			rect.height === nextRect.height
		);
	});
}

export function resolveFallbackRect(
	rect: AIContextualPromptAnchor["lastResolvedRect"],
): DOMRect | null {
	if (!rect) {
		return null;
	}
	return createDomRect(rect.top, rect.left, rect.width, rect.height);
}

export function areRectsEqual(
	previous: AIContextualPromptAnchor["lastResolvedRect"],
	next: DOMRect,
): boolean {
	if (!previous) {
		return false;
	}
	return (
		previous.top === next.top &&
		previous.left === next.left &&
		previous.width === next.width &&
		previous.height === next.height
	);
}

function createDomRect(
	top: number,
	left: number,
	width: number,
	height: number,
): DOMRect {
	if (typeof DOMRect !== "undefined") {
		if (typeof DOMRect.fromRect === "function") {
			return DOMRect.fromRect({ x: left, y: top, width, height });
		}
		return new DOMRect(left, top, width, height);
	}
	return {
		top,
		left,
		width,
		height,
		right: left + width,
		bottom: top + height,
		x: left,
		y: top,
		toJSON() {
			return { top, left, width, height };
		},
	} as DOMRect;
}

export function selectionMatchesSnapshot(
	selection: {
		anchor: { blockId: string; offset: number };
		focus: { blockId: string; offset: number };
	} | null,
	snapshot: NonNullable<AIContextualPromptAnchor["selectionSnapshot"]>,
): boolean {
	if (!selection) {
		return false;
	}
	return (
		selection.anchor.blockId === snapshot.anchor.blockId &&
		selection.anchor.offset === snapshot.anchor.offset &&
		selection.focus.blockId === snapshot.focus.blockId &&
		selection.focus.offset === snapshot.focus.offset
	);
}
