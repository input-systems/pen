import React from "react";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";

export interface ToolbarButtonProps extends AsChildProps {
	onAction?: () => void;
	disabled?: boolean;
	/**
	 * Composed with `onAction`, not instead of it. A Slot-style wrapper
	 * (a tooltip trigger, for example) merges its own `onClick` onto this
	 * element; that must not silence the action.
	 */
	onClick?: React.MouseEventHandler<HTMLElement>;
	ref?: React.Ref<HTMLElement>;
}

export function ToolbarButton(props: ToolbarButtonProps) {
	const { onAction, disabled, onClick, ...rest } = props;

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
	};

	return renderAsChild(rest, "button", primitiveProps);
}
