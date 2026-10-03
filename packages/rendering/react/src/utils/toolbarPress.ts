import type React from "react";

type PressEvent =
	React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>;

const PRIMARY_BUTTON = 0;

/**
 * AX3 (D15): a primary-button press on a toolbar control never takes focus
 * from the field, so the default is prevented on `pointerdown` and
 * `mousedown` (the event that moves focus). Composed after the host's own
 * handler, the same way `onClick` is, so a Slot-style wrapper keeps its
 * handler.
 */
export function composeToolbarPress<E extends PressEvent>(
	hostHandler: ((event: E) => void) | undefined,
): (event: E) => void {
	return (event) => {
		hostHandler?.(event);
		if (event.button === PRIMARY_BUTTON) {
			event.preventDefault();
		}
	};
}
