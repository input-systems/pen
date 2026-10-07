import type { Unsubscribe } from "@input/pen-types";
import { isDomNode } from "../utils/domNodes";

/** Callbacks for {@link bindEditorRootFocus}. */
export interface EditorRootFocusHandlers {
	/** Focus entered the root or moved within it, after `onFocusChange(true)`. */
	onFocusIn?(event: FocusEvent): void;
	/** Whether the root holds focus in an active window; called on bind and every change signal. */
	onFocusChange(focused: boolean): void;
}

/**
 * Whether focus is inside `root` and its window is the active one (O5).
 * Switching windows leaves `document.activeElement` where it was, so the
 * active element alone would keep an alt-tabbed editor focused.
 *
 * @param root - An editor root element.
 */
export function isEditorRootFocused(root: HTMLElement): boolean {
	const ownerDocument = root.ownerDocument;
	const activeElement = ownerDocument.activeElement;
	return (
		isDomNode(activeElement) &&
		root.contains(activeElement) &&
		ownerDocument.hasFocus()
	);
}

/**
 * Track whether an editor root holds focus (O5), for the vanilla mount and
 * the framework bindings alike: `focusin` and `focusout` on the root, plus
 * the window's `blur` and `focus`, because an inactive window leaves the
 * active element inside the root and fires no `focusout` the root can trust.
 * Reports the current state on bind without replaying focus entry.
 *
 * @param root - An editor root element.
 * @param handlers - Focus entry and focus-state callbacks.
 * @returns Removes every listener.
 */
export function bindEditorRootFocus(
	root: HTMLElement,
	handlers: EditorRootFocusHandlers,
): Unsubscribe {
	const view = root.ownerDocument.defaultView;
	const handleFocusIn = (event: FocusEvent): void => {
		handlers.onFocusChange(true);
		handlers.onFocusIn?.(event);
	};
	const handleFocusOut = (): void => {
		handlers.onFocusChange(isEditorRootFocused(root));
	};
	const handleWindowBlur = (): void => {
		handlers.onFocusChange(false);
	};
	const handleWindowFocus = (): void => {
		handlers.onFocusChange(isEditorRootFocused(root));
	};
	root.addEventListener("focusin", handleFocusIn);
	root.addEventListener("focusout", handleFocusOut);
	view?.addEventListener("blur", handleWindowBlur);
	view?.addEventListener("focus", handleWindowFocus);
	handlers.onFocusChange(isEditorRootFocused(root));
	return () => {
		root.removeEventListener("focusin", handleFocusIn);
		root.removeEventListener("focusout", handleFocusOut);
		view?.removeEventListener("blur", handleWindowBlur);
		view?.removeEventListener("focus", handleWindowFocus);
	};
}
