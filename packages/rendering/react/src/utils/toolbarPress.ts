import type React from "react";

const PRIMARY_BUTTON = 0;

/**
 * AX3 (D15): a primary-button press on a toolbar control never takes focus
 * from the field, so the default is prevented on `mousedown`, the event
 * whose default moves focus. `pointerdown` is left alone: cancelling it
 * suppresses the compatibility mouse events, so no `mousedown` would reach
 * a host's handler, a document outside-press listener, or a Radix-style
 * trigger composed onto the control. Composed after the host's own handler,
 * the same way `onClick` is, so a Slot-style wrapper keeps its handler.
 */
export function composeToolbarPress(
	hostHandler: React.MouseEventHandler<HTMLElement> | undefined,
): React.MouseEventHandler<HTMLElement> {
	return (event) => {
		hostHandler?.(event);
		if (event.button === PRIMARY_BUTTON) {
			event.preventDefault();
		}
	};
}
