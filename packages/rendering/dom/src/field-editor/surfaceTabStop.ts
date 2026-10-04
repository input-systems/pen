import type { BackendAttachment } from "./backendAttachment";

/**
 * AX1: a contenteditable surface is tabbable only while it owns focus.
 *
 * Firefox 155 will not Shift-Tab out of a focused contenteditable that
 * carries tabindex="-1", so the focused surface takes 0. Once focus leaves,
 * the root returns to the tab order and the surface drops back to -1, so
 * native traversal never sees both the root and its surface as stops.
 */
export function bindSurfaceTabStop(
	attachment: BackendAttachment,
	element: HTMLElement,
): void {
	element.tabIndex = element.ownerDocument.activeElement === element ? 0 : -1;
	attachment.listen(element, "focus", () => {
		element.tabIndex = 0;
	});
	attachment.listen(element, "blur", () => {
		element.tabIndex = -1;
	});
}
