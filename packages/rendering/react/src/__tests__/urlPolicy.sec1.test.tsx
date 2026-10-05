// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor as createCoreEditor } from "@input/pen-core";
import { urlPolicyExtension, type UrlPolicy } from "@input/pen-dom";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp } from "@input/pen-types";
import { Pen } from "../primitives/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const DENIED = "https://blocked.example/page";
const ADMITTED_BLOB = "blob:host-admitted";
const CELL = { row: 0, col: 0 };

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
 * Each React surface reaches the host policy on its own path: ImageRenderer
 * through resolveEditorUrl, idle InlineContent and TableCellContent through
 * the pen-dom reconciler. The policy itself is pinned in pen-dom.
 */
const SURFACES: Array<{
	name: string;
	attribute: "src" | "href";
	selector: string;
	ops(url: string): DocumentOp[];
}> = [
	{
		name: "ImageRenderer",
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
		name: "idle InlineContent",
		attribute: "href",
		selector: '[data-block-id="linked"] a',
		ops: (url) => [
			{ type: "insert-block", blockId: "linked", blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: "linked", from: 0, to: 0, insert: "click" },
			{ type: "format-text", blockId: "linked", from: 0, to: 5, marks: { link: { href: url } } },
		],
	},
	{
		name: "idle TableCellContent",
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

async function renderUrl(
	surface: (typeof SURFACES)[number],
	url: string,
): Promise<{ element: Element | null; html: string }> {
	const editor = createCoreEditor({
		schema: defaultSchema,
		extensions: [urlPolicyExtension(hostWrap)],
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
	editor.apply(surface.ops(url));
	editor.selectText(editor.firstBlock()!.id, 0, 0);
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			<Pen.Editor.Root editor={editor}>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);
	});
	const element = container.querySelector(surface.selector);
	const html = container.innerHTML;
	await act(async () => {
		root.unmount();
	});
	container.remove();
	editor.destroy();
	return { element, html };
}

describe("SEC1 React host urlPolicy", () => {
	it.each(SURFACES)(
		"SEC1: $name omits a default-admitted URL the host wrap denies",
		async (surface) => {
			const { element, html } = await renderUrl(surface, DENIED);

			expect(element).not.toBeNull();
			expect(element?.getAttribute(surface.attribute)).toBeNull();
			expect(element?.getAttribute("data-pen-blocked-url")).toBe("");
			expect(html).not.toContain(DENIED);
		},
	);

	it.each(SURFACES)(
		"SEC1: $name admits a blob: URL the host wrap allows",
		async (surface) => {
			const { element } = await renderUrl(surface, ADMITTED_BLOB);

			expect(element).not.toBeNull();
			expect(element?.getAttribute(surface.attribute)).toBe(
				ADMITTED_BLOB,
			);
			expect(element?.hasAttribute("data-pen-blocked-url")).toBe(false);
		},
	);
});
