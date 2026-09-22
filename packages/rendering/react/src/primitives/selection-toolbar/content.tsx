import React, { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { isCollapsed, resolveEditorMessage } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { useSelectionToolbarContext } from "./root";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeRefs } from "../../utils/composeRefs";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import { getAttachedFieldEditor } from "../../utils/fieldEditor";
import { resolveSelectionToolbarRect } from "../../hooks/useSelectionToolbar";
import { useIsomorphicLayoutEffect } from "../../hooks/useIsomorphicLayoutEffect";

type Side = "top" | "bottom";
type HorizontalAlign = "left" | "center" | "right";

/**
 * Floating formatting surface for the current text selection.
 *
 * AX3 detached surface: `role="toolbar"` (hosts may render `role="menu"`
 * via `asChild`). Escape closes the surface and restores focus to the
 * editing position. Pointer interaction does not steal editor focus —
 * this primitive never auto-focuses itself.
 */
export interface SelectionToolbarContentProps extends AsChildProps {
	/**
	 * Preferred placement side relative to the selection.
	 * @default "top"
	 */
	side?: Side;
	/**
	 * Horizontal alignment relative to the selection.
	 * @default "center"
	 */
	horizontalAlign?: HorizontalAlign;
	/** Gap in px between the selection and the toolbar. @default 8 */
	sideOffset?: number;
	ref?: React.Ref<HTMLElement>;
}

const TOOLBAR_VIEWPORT_PADDING = 8;

export function SelectionToolbarContent(props: SelectionToolbarContentProps) {
	const {
		side: preferredSide = "top",
		horizontalAlign = "center",
		sideOffset = 8,
		ref,
		...rest
	} = props;
	const { editor, selectionToolbar } = useSelectionToolbarContext();
	const contentRef = useRef<HTMLElement | null>(null);
	const [dismissed, setDismissed] = useState(false);
	const [position, setPosition] = useState<{
		top: number;
		left: number;
		side: Side;
	} | null>(null);

	const { isOpen, selectionRect } = selectionToolbar;
	const selectionKey = textSelectionKey(editor);

	useIsomorphicLayoutEffect(() => {
		setDismissed(false);
	}, [selectionKey]);

	useIsomorphicLayoutEffect(() => {
		const el = contentRef.current;
		if (!isOpen || !selectionRect || !el) {
			setPosition(null);
			return;
		}

		const liveSelectionRect =
			resolveSelectionToolbarRect(editor) ?? selectionRect;
		const elRect = el.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		let side = preferredSide;
		let top: number;

		if (side === "top") {
			top = liveSelectionRect.top - sideOffset - elRect.height;
			if (top < TOOLBAR_VIEWPORT_PADDING) {
				side = "bottom";
				top = liveSelectionRect.bottom + sideOffset;
			}
		} else {
			top = liveSelectionRect.bottom + sideOffset;
			if (
				top + elRect.height >
				viewportHeight - TOOLBAR_VIEWPORT_PADDING
			) {
				side = "top";
				top = liveSelectionRect.top - sideOffset - elRect.height;
			}
		}

		let left: number;
		if (horizontalAlign === "left") {
			left = liveSelectionRect.left;
		} else if (horizontalAlign === "right") {
			left = liveSelectionRect.right - elRect.width;
		} else {
			left =
				liveSelectionRect.left +
				liveSelectionRect.width / 2 -
				elRect.width / 2;
		}

		left = Math.max(
			TOOLBAR_VIEWPORT_PADDING,
			Math.min(
				left,
				viewportWidth - elRect.width - TOOLBAR_VIEWPORT_PADDING,
			),
		);

		setPosition({ top, left, side });
	}, [
		editor,
		isOpen,
		selectionRect,
		preferredSide,
		horizontalAlign,
		sideOffset,
	]);

	if (!isOpen || !selectionRect || dismissed) {
		return null;
	}

	const handlePointerDown = (event: React.PointerEvent) => {
		event.preventDefault();
	};

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key !== "Escape") {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const target = resolveEditorFocusTarget(editor, contentRef.current);
		flushSync(() => {
			setDismissed(true);
		});
		restoreEditorFocus(editor, target);
	};

	const primitiveProps: Record<string, unknown> = {
		"data-pen-selection-toolbar-content": "",
		"data-side": position?.side ?? preferredSide,
		role: "toolbar",
		"aria-label": resolveEditorMessage(editor, "pen.toolbar.formatting"),
		onPointerDown: handlePointerDown,
		onKeyDown: handleKeyDown,
		style: {
			position: "fixed" as const,
			top: 0,
			left: 0,
			transform: position
				? `translate3d(${Math.round(position.left)}px, ${Math.round(position.top)}px, 0)`
				: undefined,
			willChange: "transform",
			zIndex: 50,
			visibility: position ? ("visible" as const) : ("hidden" as const),
		},
	};

	return renderAsChild(
		{ ...rest, ref: composeRefs(ref, contentRef) },
		"div",
		primitiveProps,
	);
}

function textSelectionKey(editor: Editor): string | null {
	const selection = editor.selection;
	if (!selection || selection.type !== "text" || isCollapsed(selection)) {
		return null;
	}
	return [
		selection.anchor.blockId,
		selection.anchor.offset,
		selection.focus.blockId,
		selection.focus.offset,
	].join(":");
}

function resolveEditorFocusTarget(
	editor: Editor,
	from: HTMLElement | null,
): HTMLElement | null {
	const ownerDocument = from?.ownerDocument ?? document;
	return (
		from?.closest<HTMLElement>(`[${DATA_ATTRS.editorRoot}]`) ??
		ownerDocument.querySelector<HTMLElement>(
			`[${DATA_ATTRS.editorRoot}][${DATA_ATTRS.viewId}="${editor.internals.viewId}"]`,
		) ??
		ownerDocument.querySelector<HTMLElement>(`[${DATA_ATTRS.editorRoot}]`)
	);
}

function restoreEditorFocus(editor: Editor, target: HTMLElement | null): void {
	const fieldEditor = getAttachedFieldEditor(editor);
	if (fieldEditor?.focus({ reason: "keyboard", domFocus: true })) {
		const active =
			target?.ownerDocument.activeElement ?? document.activeElement;
		if (active instanceof Node && target?.contains(active)) {
			return;
		}
	}
	target?.focus({ preventScroll: true });
}
