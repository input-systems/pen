import type { SyntheticEvent } from "react";

/**
 * Pressing a control must not move DOM focus, or the editor caret disappears
 * and the action lands nowhere. Put it on `onMouseDown` or `onPointerDown` of
 * anything that acts on the document: format toggles, the block-type select,
 * the review buttons. Input does the same at its toolbar call sites.
 */
export function keepCaret(event: SyntheticEvent): void {
	event.preventDefault();
}
