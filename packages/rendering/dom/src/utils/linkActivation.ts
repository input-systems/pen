import { DATA_ATTRS } from "./dataAttributes";
import { closestDomElement } from "./domNodes";

/**
 * RI9: a click on a link in editor content edits and never navigates the
 * page; Cmd/Ctrl+click opens the link in a new tab. A link outside an
 * editable field is a plain page link to the browser, so its click would
 * follow it.
 */
export function bindLinkActivation(root: HTMLElement): () => void {
	const onClick = (event: MouseEvent): void => {
		const link = closestDomElement(
			event.target,
		)?.closest<HTMLAnchorElement>("a[href]");
		if (
			!link ||
			!root.contains(link) ||
			!link.closest(`[${DATA_ATTRS.inlineContent}]`)
		) {
			return;
		}
		event.preventDefault();
		if (event.metaKey || event.ctrlKey) {
			link.ownerDocument.defaultView?.open(
				link.href,
				"_blank",
				"noopener,noreferrer",
			);
		}
	};
	root.addEventListener("click", onClick);
	return () => root.removeEventListener("click", onClick);
}
