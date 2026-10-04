import React from "react";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeToolbarPress } from "../../utils/toolbarPress";

export interface ToolbarButtonProps extends AsChildProps {
	onAction?: () => void;
	disabled?: boolean;
	/**
	 * Composed with `onAction`, not instead of it. A Slot-style wrapper
	 * (a tooltip trigger, for example) merges its own `onClick` onto this
	 * element; that must not silence the action.
	 */
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

export function ToolbarButton(props: ToolbarButtonProps) {
	const { onAction, disabled, onClick, onMouseDown, ...rest } =
		props;

	const handleClick = (event: React.MouseEvent<HTMLElement>) => {
		onClick?.(event);
		if (disabled || event.defaultPrevented) {
			return;
		}
		onAction?.();
	};

	const primitiveProps: Record<string, unknown> = {
		"data-pen-toolbar-button": "",
		role: "button",
		"aria-disabled": disabled || undefined,
		onClick: handleClick,
		onMouseDown: composeToolbarPress(onMouseDown),
	};

	return renderAsChild(rest, "button", primitiveProps);
}
