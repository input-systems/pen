// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { bindLinkActivation } from "../utils/linkActivation";

function createLink(href: string, text: string): HTMLAnchorElement {
	const link = document.createElement("a");
	link.href = href;
	link.textContent = text;
	return link;
}

/** A content link inside inline content, and a chrome link beside it. */
function mountLinks(): {
	root: HTMLElement;
	link: HTMLAnchorElement;
	chrome: HTMLAnchorElement;
} {
	const root = document.createElement("div");
	const inline = document.createElement("div");
	inline.setAttribute("data-pen-inline-content", "");
	const link = createLink("https://example.com/", "link");
	const chrome = createLink("https://example.com/chrome", "chrome");
	inline.append(link);
	root.append(inline, chrome);
	document.body.append(root);
	return { root, link, chrome };
}

function click(target: Node, init: MouseEventInit = {}): MouseEvent {
	const event = new MouseEvent("click", {
		bubbles: true,
		cancelable: true,
		...init,
	});
	target.dispatchEvent(event);
	return event;
}

describe("RI9 link activation", () => {
	afterEach(() => {
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it("prevents a plain click on a content link from navigating", () => {
		const { root, link } = mountLinks();
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const unbind = bindLinkActivation(root);

		// A press lands on the link's text node.
		expect(click(link.firstChild!).defaultPrevented).toBe(true);
		expect(open).not.toHaveBeenCalled();
		unbind();
	});

	it("opens a content link in a new tab on Cmd/Ctrl+click", () => {
		const { root, link } = mountLinks();
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const unbind = bindLinkActivation(root);

		expect(click(link, { metaKey: true }).defaultPrevented).toBe(true);
		expect(click(link, { ctrlKey: true }).defaultPrevented).toBe(true);
		expect(open).toHaveBeenCalledTimes(2);
		expect(open).toHaveBeenCalledWith(
			"https://example.com/",
			"_blank",
			"noopener,noreferrer",
		);
		unbind();
	});

	it("leaves links outside editor content alone, and stops after unbind", () => {
		const { root, link, chrome } = mountLinks();
		const unbind = bindLinkActivation(root);

		expect(click(chrome).defaultPrevented).toBe(false);
		unbind();
		expect(click(link).defaultPrevented).toBe(false);
	});
});
