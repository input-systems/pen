import React, { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { isCollapsed, resolveEditorMessage } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { useSelectionToolbarContext } from "./root";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeRefs } from "../../utils/composeRefs";
import { captureFocusReturn, restoreFocusReturn } from "@input/pen-dom";
import { isDomNode } from "@input/pen-dom/utils/domNodes";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { resolveChromeEditorRoot } from "../../utils/aiDomScope";
import { getAttachedFieldEditorSession } from "../../utils/fieldEditor";
import { resolveSelectionToolbarRect } from "../../hooks/useSelectionToolbar";
import { useIsomorphicLayoutEffect } from "../../hooks/useIsomorphicLayoutEffect";

type Side = "top" | "bottom";
type HorizontalAlign = "left" | "center" | "right";

/**
 * Floating formatting surface for the current text selection.
 *
 * AX3 detached surface: `role="toolbar"` (hosts may render `role="menu"`
 * via `asChild`). Pointer interaction does not steal editor focus, and
 * keyboard activation keeps focus on the activated control while the
 * toolbar stays mounted. Escape, or an action that unmounts the toolbar
 * with the selection, returns focus to the editor surface (D15). This
 * primitive never auto-focuses itself.
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
	const fieldEditorContext = useFieldEditorContext();
	const contentRef = useRef<HTMLElement | null>(null);
	const focusWithinRef = useRef(false);
	const [dismissed, setDismissed] = useState(false);
	const [position, setPosition] = useState<{
		top: number;
		left: number;
		side: Side;
	} | null>(null);

	const { isOpen, selectionRect } = selectionToolbar;
	const selectionKey = textSelectionKey(editor);
	const mounted = isOpen && Boolean(selectionRect) && !dismissed;

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

	useIsomorphicLayoutEffect(() => {
		if (!mounted) {
			return;
		}
		const element = contentRef.current;
		const editorRoot = resolveChromeEditorRoot(editor, element);
		return () => {
			// D15: Escape, or an action that takes the toolbar down with the
			// selection, returns focus that was inside it to the editor
			// surface. The element is already detached here, so focus has
			// fallen to the document.
			const hadFocus = focusWithinRef.current;
			focusWithinRef.current = false;
			if (!hadFocus || !editorRoot) {
				return;
			}
			const active = editorRoot.ownerDocument.activeElement;
			const focusFell =
				active === null ||
				active === editorRoot.ownerDocument.body ||
				(element !== null && element.contains(active));
			if (!focusFell) {
				return;
			}
			restoreFocusReturn(
				captureFocusReturn(editorRoot),
				fieldEditorContext ?? getAttachedFieldEditorSession(editor),
				"surface",
			);
		};
	}, [mounted]);

	if (!mounted) {
		return null;
	}

	const handleFocus = () => {
		focusWithinRef.current = true;
	};

	const handleBlur = (event: React.FocusEvent<HTMLElement>) => {
		const next = event.relatedTarget;
		const element = contentRef.current;
		// A blur caused by the toolbar's own removal is not focus leaving it.
		if (!element?.isConnected) {
			return;
		}
		if (!isDomNode(next) || !element.contains(next)) {
			focusWithinRef.current = false;
		}
	};

	const handlePointerDown = (event: React.PointerEvent) => {
		event.preventDefault();
	};

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key !== "Escape") {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		// Unmounting runs the restore above, synchronously.
		flushSync(() => {
			setDismissed(true);
		});
	};

	const primitiveProps: Record<string, unknown> = {
		"data-pen-selection-toolbar-content": "",
		"data-side": position?.side ?? preferredSide,
		role: "toolbar",
		"aria-label": resolveEditorMessage(editor, "pen.toolbar.formatting"),
		onPointerDown: handlePointerDown,
		onKeyDown: handleKeyDown,
		onFocus: handleFocus,
		onBlur: handleBlur,
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
