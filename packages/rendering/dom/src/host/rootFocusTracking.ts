import type { Unsubscribe } from "@input/pen-types";
import { isDomNode } from "../utils/domNodes";

/** Callbacks for {@link bindEditorRootFocus}. */
export interface EditorRootFocusHandlers {
	/** Focus entered the root or moved within it, after `onFocusChange(true)`. */
	onFocusIn?(event: FocusEvent): void;
	/** Whether the root holds focus in an active window; called on bind and every change signal. */
	onFocusChange(focused: boolean): void;
}

/** Whether `node` is inside `root`, for a node from any window. */
function isInsideRoot(root: HTMLElement, node: unknown): boolean {
	return isDomNode(node) && root.contains(node);
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
	return (
		isInsideRoot(root, ownerDocument.activeElement) &&
		ownerDocument.hasFocus()
	);
}

/**
 * Track whether focus is within an editor root whatever the window's state
 * (COL7). A window switch blurs the focused element without moving it, so
 * it reads as no change, where O5 counts it as a blur. Reports the current
 * state on bind.
 *
 * @param root - An editor root element.
 * @param onChange - Called on bind and on every focus entry or exit signal.
 * @returns Removes every listener.
 */
export function bindEditorRootFocusWithin(
	root: HTMLElement,
	onChange: (hasFocusWithin: boolean) => void,
): Unsubscribe {
	const handleFocusIn = (): void => {
		onChange(true);
	};
	// the related target names where focus went; without one, a window switch keeps the active element
	const handleFocusOut = (event: FocusEvent): void => {
		const destination = isDomNode(event.relatedTarget)
			? event.relatedTarget
			: root.ownerDocument.activeElement;
		onChange(isInsideRoot(root, destination));
	};
	root.addEventListener("focusin", handleFocusIn);
	root.addEventListener("focusout", handleFocusOut);
	onChange(isInsideRoot(root, root.ownerDocument.activeElement));
	return () => {
		root.removeEventListener("focusin", handleFocusIn);
		root.removeEventListener("focusout", handleFocusOut);
	};
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
