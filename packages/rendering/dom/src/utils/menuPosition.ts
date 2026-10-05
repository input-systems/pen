import type { Editor } from "@input/pen-types";
import { measureWithRoot } from "../geometry/rootGeometry";
import type { GeometryReader, Rect } from "../geometry/types";
import { DATA_ATTRS } from "./dataAttributes";
import { isDomHTMLElement } from "./domNodes";
import { resolveEditorDocument } from "./editorDocument";

export type MenuPlacementSide = "top" | "bottom";

export interface MenuAnchorTarget {
	blockId: string;
	startOffset: number;
	endOffset: number;
}

export interface AnchoredMenuPosition {
	top: number;
	left: number;
	maxHeight: number;
	side: MenuPlacementSide;
}

export function resolveAnchoredMenuPosition(options: {
	alignOffset: number;
	editor: Editor;
	element: HTMLElement | null;
	fallbackWidth?: number;
	minHeight: number;
	preferredSide: MenuPlacementSide;
	sideOffset: number;
	target: MenuAnchorTarget | null;
	viewportPadding: number;
}): AnchoredMenuPosition | null {
	const {
		alignOffset,
		editor,
		element,
		fallbackWidth = 320,
		minHeight,
		preferredSide,
		sideOffset,
		target,
		viewportPadding,
	} = options;

	if (typeof window === "undefined") {
		return null;
	}

	const rootElement = resolveEditorRoot(element, editor);
	if (!rootElement) {
		return null;
	}

	return measureWithRoot(rootElement, ({ reader }) => {
		const anchorRect = getAnchorRect(reader, editor, target);
		if (!anchorRect) {
			return null;
		}

		const elementRect = element?.getBoundingClientRect();
		const menuWidth = elementRect?.width || fallbackWidth;
		const menuHeight = elementRect?.height || minHeight;
		// the root's own viewport: an iframe's when the host mounts there
		const view = rootElement.ownerDocument.defaultView ?? window;
		const viewportWidth = view.innerWidth;
		const viewportHeight = view.innerHeight;

		let side = preferredSide;
		let top =
			side === "top"
				? anchorRect.top - sideOffset - menuHeight
				: anchorRect.bottom + sideOffset;

		if (
			side === "bottom" &&
			top + menuHeight > viewportHeight - viewportPadding
		) {
			side = "top";
			top = anchorRect.top - sideOffset - menuHeight;
		}

		if (side === "top" && top < viewportPadding) {
			side = "bottom";
			top = anchorRect.bottom + sideOffset;
		}

		const left = clamp(
			anchorRect.left - alignOffset,
			viewportPadding,
			viewportWidth - menuWidth - viewportPadding,
		);
		const availableHeight =
			side === "bottom"
				? viewportHeight - top - viewportPadding
				: anchorRect.top - sideOffset - viewportPadding;

		return {
			top: Math.max(viewportPadding, top),
			left,
			maxHeight: Math.max(minHeight, availableHeight),
			side,
		};
	});
}

function resolveEditorRoot(
	element: HTMLElement | null,
	editor: Editor,
): HTMLElement | null {
	const fromElement = element?.closest(`[${DATA_ATTRS.editorRoot}]`);
	if (isDomHTMLElement(fromElement)) {
		return fromElement;
	}

	const blockId = blockIdFromEditor(editor);
	if (!blockId) {
		return null;
	}

	const blockElement = resolveEditorDocument(editor)?.querySelector<HTMLElement>(
		`[data-block-id="${escapeCssAttributeValue(blockId)}"]`,
	);
	const fromBlock = blockElement?.closest(`[${DATA_ATTRS.editorRoot}]`);
	return isDomHTMLElement(fromBlock) ? fromBlock : null;
}

function blockIdFromEditor(editor: Editor): string | null {
	const selection = editor.selection;
	if (!selection) {
		return null;
	}
	switch (selection.type) {
		case "text":
			return selection.anchor.blockId;
		case "block":
			return selection.blockIds[0] ?? null;
		case "cell":
			return selection.blockId;
		case "app":
			return null;
		default: {
			const _exhaustive: never = selection;
			return _exhaustive;
		}
	}
}

function getAnchorRect(
	reader: GeometryReader,
	editor: Editor,
	target: MenuAnchorTarget | null,
): Rect | null {
	if (target) {
		const startRect = reader.caretRect(
			{ blockId: target.blockId, offset: target.startOffset },
			"downstream",
		);
		const endRect = reader.caretRect(
			{ blockId: target.blockId, offset: target.endOffset },
			"downstream",
		);
		if (startRect && endRect) {
			return mergeTriggerHorizontalWithCaretLine(startRect, endRect);
		}
		if (startRect) {
			return startRect;
		}
	}

	const editorSelection = editor.selection;
	if (editorSelection?.type === "text") {
		const focusRect = reader.caretRect(editorSelection.focus, "downstream");
		if (focusRect && (focusRect.width > 0 || focusRect.height > 0)) {
			return focusRect;
		}
		return reader.blockRect(editorSelection.anchor.blockId);
	}

	return null;
}

function mergeTriggerHorizontalWithCaretLine(
	startRect: Rect,
	endRect: Rect,
): Rect {
	const verticalRect = isSameVisualLine(startRect, endRect)
		? startRect
		: endRect;
	return {
		x: startRect.left,
		y: verticalRect.top,
		left: startRect.left,
		right: startRect.left,
		top: verticalRect.top,
		bottom: verticalRect.bottom,
		width: 0,
		height: verticalRect.height,
	};
}

function isSameVisualLine(left: Rect, right: Rect): boolean {
	const threshold = Math.max(4, Math.min(left.height, right.height) / 2);
	return Math.abs(left.top - right.top) <= threshold;
}

function escapeCssAttributeValue(value: string): string {
	return value.replace(/["\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number): number {
	if (max < min) {
		return min;
	}
	return Math.min(Math.max(value, min), max);
}
