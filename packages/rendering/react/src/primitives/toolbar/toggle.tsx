import React from "react";
import { useToolbarContext } from "../../context/toolbarContext";
import { useEditorContext } from "../../context/editorContext";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeToolbarPress } from "../../utils/toolbarPress";
import { toggleInlineMark } from "@input/pen-dom/field-editor/commands";

export interface ToolbarToggleProps extends AsChildProps {
	format: string;
	/** Composed with the toggle, not instead of it; see `ToolbarButtonProps.onClick`. */
	onClick?: React.MouseEventHandler<HTMLElement>;
	/**
	 * Passed through. The primitive does not cancel `pointerdown`: that would
	 * suppress the compatibility mouse events (AX3).
	 */
	onPointerDown?: React.PointerEventHandler<HTMLElement>;
	/**
	 * Composed: the primitive prevents the primary-button `mousedown` default
	 * afterwards, so a click never takes focus from the field (AX3).
	 * `pointerdown` is not cancelled, so compatibility mouse events still
	 * fire.
	 */
	onMouseDown?: React.MouseEventHandler<HTMLElement>;
	ref?: React.Ref<HTMLElement>;
}

export function ToolbarToggle(props: ToolbarToggleProps) {
	const { format, onClick, onMouseDown, ...rest } = props;
	const { editor, state } = useToolbarContext();
	const { readonly } = useEditorContext();

	const isActive = format in state.activeMarks;

	const handleClick = (event: React.MouseEvent<HTMLElement>) => {
		onClick?.(event);
		if (readonly || event.defaultPrevented) return;
		toggleInlineMark(editor, format);
	};

	const primitiveProps: Record<string, unknown> = {
		"data-pen-toolbar-toggle": "",
		"data-active": isActive ? "" : undefined,
		"data-format": format,
		role: "button",
		"aria-pressed": isActive,
		onClick: handleClick,
		onMouseDown: composeToolbarPress(onMouseDown),
	};

	return renderAsChild(rest, "button", primitiveProps);
}
