// @vitest-environment jsdom

import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { getLogicalNodeLength } from "../inlineAtomDom";
import { applyDeltaToDOM } from "../reconcilerDeltaApply";
import { fullReconcileDeltasToDOM } from "../reconcilerFull";
import { extractTextFromDOM } from "../textDiff";

const hosts: HTMLElement[] = [];

afterEach(() => {
	for (const host of hosts) {
		host.remove();
	}
	hosts.length = 0;
});

function mountInline(): HTMLElement {
	const host = document.createElement("span");
	host.setAttribute(DATA_ATTRS.inlineContent, "");
	document.body.append(host);
	hosts.push(host);
	return host;
}

function fullReconcile(host: HTMLElement, text: string): void {
	fullReconcileDeltasToDOM([{ insert: text }], host, defaultSchema, {
		urlPolicy: { resolve: () => null },
	});
}

function trailingBreak(host: HTMLElement): Element | null {
	return host.querySelector(`[${DATA_ATTRS.trailingBreak}]`);
}

describe("RI5 trailing line break", () => {
	it("fullReconcile appends a marked br only when the text ends with a newline", () => {
		const host = mountInline();

		fullReconcile(host, "Hello\nworld");
		expect(trailingBreak(host)).toBeNull();

		fullReconcile(host, "Hello\nworld\n");
		const br = trailingBreak(host);
		expect(br?.tagName).toBe("BR");
		expect(br).toBe(host.lastChild);
	});

	it("the break carries no logical text and no logical length", () => {
		const host = mountInline();
		fullReconcile(host, "Hello\n");

		expect(trailingBreak(host)).toBeTruthy();
		expect(extractTextFromDOM(host)).toBe("Hello\n");
		expect(getLogicalNodeLength(host)).toBe("Hello\n".length);
	});

	it("the incremental path adds the break on a typed newline and drops it on delete", () => {
		const host = mountInline();
		fullReconcile(host, "Hi");

		expect(
			applyDeltaToDOM([{ retain: 2 }, { insert: "\n" }], host, defaultSchema),
		).toBe(true);
		expect(extractTextFromDOM(host)).toBe("Hi\n");
		expect(trailingBreak(host)).toBe(host.lastChild);

		expect(
			applyDeltaToDOM([{ retain: 2 }, { delete: 1 }], host, defaultSchema),
		).toBe(true);
		expect(extractTextFromDOM(host)).toBe("Hi");
		expect(trailingBreak(host)).toBeNull();
	});

	/**
	 * An insert landing on the break finds a `<br>` with no text leaf, so
	 * `applyDeltaToDOM` returns false and the caller falls back to a full
	 * reconcile — on every keystroke at the end of such a field. The `toBe(true)`
	 * below is the real assertion; the text check just proves it took the fast
	 * path correctly.
	 */
	it("an insert while the break is present keeps the incremental path", () => {
		const host = mountInline();
		fullReconcile(host, "Hi\n");
		expect(trailingBreak(host)).toBeTruthy();

		expect(
			applyDeltaToDOM(
				[{ retain: 3 }, { insert: "there" }],
				host,
				defaultSchema,
			),
		).toBe(true);
		expect(extractTextFromDOM(host)).toBe("Hi\nthere");
		expect(trailingBreak(host)).toBeNull();
	});
});
