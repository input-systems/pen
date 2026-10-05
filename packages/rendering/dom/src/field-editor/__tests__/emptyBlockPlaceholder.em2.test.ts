// @vitest-environment jsdom

import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import {
	createEmptyBlockPlaceholder,
	ensureEmptyBlockPlaceholder,
	isEmptyBlockPlaceholder,
} from "../emptyBlockPlaceholder";
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

describe("EM2 empty-block placeholder", () => {
	it("fullReconcile writes a br placeholder whose field text stays empty", () => {
		const host = mountInline();
		fullReconcileDeltasToDOM([], host, defaultSchema, {
			urlPolicy: { resolve: () => null },
		});

		const placeholder = host.querySelector(`[${DATA_ATTRS.emptyBlock}]`);
		expect(placeholder?.tagName).toBe("BR");
		expect(placeholder?.getAttribute(DATA_ATTRS.emptyBlock)).toBe("");
		expect(isEmptyBlockPlaceholder(placeholder)).toBe(true);
		expect(host.textContent).toBe("");
		expect(extractTextFromDOM(host)).toBe("");
	});

	it("EM7: insert removes the placeholder and delete restores it in the same apply", () => {
		const host = mountInline();
		ensureEmptyBlockPlaceholder(host);
		expect(host.querySelector(`[${DATA_ATTRS.emptyBlock}]`)).toBeTruthy();

		expect(applyDeltaToDOM([{ insert: "x" }], host, defaultSchema)).toBe(
			true,
		);
		expect(host.textContent).toBe("x");
		expect(host.querySelector(`[${DATA_ATTRS.emptyBlock}]`)).toBeNull();
		expect(extractTextFromDOM(host)).toBe("x");

		expect(applyDeltaToDOM([{ delete: 1 }], host, defaultSchema)).toBe(
			true,
		);
		expect(host.textContent).toBe("");
		const restored = host.querySelector(`[${DATA_ATTRS.emptyBlock}]`);
		expect(restored?.tagName).toBe("BR");
		expect(extractTextFromDOM(host)).toBe("");
	});

	it("extractTextFromDOM ignores text stuffed inside the placeholder", () => {
		const host = mountInline();
		const placeholder = createEmptyBlockPlaceholder();
		placeholder.append(document.createTextNode("leak"));
		host.append(placeholder);

		expect(host.querySelector(`[${DATA_ATTRS.emptyBlock}]`)).toBe(
			placeholder,
		);
		expect(extractTextFromDOM(host)).toBe("");
	});
});
