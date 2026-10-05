// @vitest-environment jsdom

import { urlPolicyExtension, type UrlPolicy } from "@input/pen-dom";
import { createTestEditor } from "@input/pen-test";
import type { DocumentOp } from "@input/pen-types";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { PenEditor } from "../components/PenEditor";

const DENIED = "https://blocked.example/page";
const ADMITTED_BLOB = "blob:host-admitted";
const CELL = { row: 0, col: 0 };

afterEach(() => {
	document.body.replaceChildren();
});

/** Denies one default-admitted URL and admits one default-denied blob: URL. */
function hostWrap(defaults: UrlPolicy): UrlPolicy {
	return {
		resolve(raw, context) {
			if (raw === DENIED) {
				return null;
			}
			if (raw === ADMITTED_BLOB) {
				return ADMITTED_BLOB;
			}
			return defaults.resolve(raw, context);
		},
	};
}

/**
 * Each Vue surface reaches the host policy on its own path: the image
 * fallback through resolveEditorUrl, idle PenInlineContent and
 * PenTableCellContent through the pen-dom reconciler. The policy itself is
 * pinned in pen-dom.
 */
const SURFACES: Array<{
	name: string;
	attribute: "src" | "href";
	selector: string;
	ops(url: string): DocumentOp[];
}> = [
	{
		name: "image fallback",
		attribute: "src",
		selector: "img",
		ops: (url) => [
			{
				type: "insert-block",
				blockId: "image-1",
				blockType: "image",
				props: { src: url, alt: "image" },
				position: "last",
			},
		],
	},
	{
		name: "idle PenInlineContent",
		attribute: "href",
		selector: '[data-block-id="linked"] a',
		ops: (url) => [
			{ type: "insert-block", blockId: "linked", blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: "linked", from: 0, to: 0, insert: "click" },
			{ type: "format-text", blockId: "linked", from: 0, to: 5, marks: { link: { href: url } } },
		],
	},
	{
		name: "idle PenTableCellContent",
		attribute: "href",
		selector:
			'[data-pen-table-cell][data-cell-row="0"][data-cell-col="0"] a',
		ops: (url) => [
			{ type: "insert-block", blockId: "t1", blockType: "table", props: {}, position: "last" },
			{ type: "splice-text", blockId: "t1", cell: CELL, from: 0, to: 0, insert: "click" },
			{ type: "format-text", blockId: "t1", cell: CELL, from: 0, to: 5, marks: { link: { href: url } } },
		],
	},
];

function renderUrl(surface: (typeof SURFACES)[number], url: string) {
	const editor = createTestEditor({
		extensions: [urlPolicyExtension(hostWrap)],
		blocks: [
			{
				id: "paragraph-1",
				type: "paragraph",
				props: {},
				content: "First",
			},
		],
	});
	editor.apply(surface.ops(url));
	editor.selectText("paragraph-1", 0, 0);
	const wrapper = mount(PenEditor, {
		attachTo: document.body,
		props: { editor },
	});
	const element = wrapper.get(surface.selector);
	const result = {
		attribute: element.attributes(surface.attribute),
		blocked: element.attributes("data-pen-blocked-url"),
		html: wrapper.html(),
	};
	wrapper.unmount();
	editor.destroy();
	return result;
}

describe("SEC1 Vue host urlPolicy", () => {
	it.each(SURFACES)(
		"SEC1: $name omits a default-admitted URL the host wrap denies",
		(surface) => {
			const { attribute, blocked, html } = renderUrl(surface, DENIED);

			expect(attribute).toBeUndefined();
			expect(blocked).toBe("");
			expect(html).not.toContain(DENIED);
		},
	);

	it.each(SURFACES)(
		"SEC1: $name admits a blob: URL the host wrap allows",
		(surface) => {
			const { attribute, blocked } = renderUrl(surface, ADMITTED_BLOB);

			expect(attribute).toBe(ADMITTED_BLOB);
			expect(blocked).toBeUndefined();
		},
	);
});
