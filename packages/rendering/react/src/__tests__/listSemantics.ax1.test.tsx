// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import type { DocumentOp } from "@input/pen-types";
import { defaultSchema } from "@input/pen-schema";
import { Pen } from "../primitives/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createListEditor() {
	const editor = createEditor({
		schema: defaultSchema,
		preset: defaultPreset({ tools: false, deltaStream: false, undo: false }),
	});
	const first = editor.firstBlock()!.id;
	const ops: DocumentOp[] = [{ type: "splice-text", blockId: first, from: 0, to: 0, insert: "intro" }];
	const specs = [
		["b1", "bulletListItem", 0],
		["b2", "bulletListItem", 1],
		["b3", "bulletListItem", 0],
		["n1", "numberedListItem", 0],
		["p", "paragraph", 0],
		["c1", "checkListItem", 0],
	] as const;
	for (const [blockId, blockType, indent] of specs) {
		ops.push(
			{ type: "insert-block", blockId, blockType, props: indent ? { indent } : {}, position: "last" },
			{ type: "splice-text", blockId, from: 0, to: 0, insert: blockId },
		);
	}
	editor.apply(ops, { origin: "system" });
	return editor;
}

/** The blocks host's structure: block ids, with each list group as a nested array. */
function structure(host: Element): unknown[] {
	return [...host.children].map((child) =>
		child.hasAttribute("data-pen-list-group")
			? [...child.children].map((item) => item.getAttribute("data-block-id"))
			: child.getAttribute("data-block-id"),
	);
}

function itemAttributes(container: Element, blockId: string) {
	const element = container.querySelector(`[data-pen-editor-block][data-block-id="${blockId}"]`)!;
	return ["role", "aria-level", "aria-posinset", "aria-setsize"].map((name) => element.getAttribute(name));
}

describe("React list semantics (AX1)", () => {
	it("AX1: EditorContent wraps list runs in role=list groups with listitem attributes on the block host", async () => {
		const editor = createListEditor();
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
		const host = container.querySelector("[data-pen-editor-blocks-host]")!;
		const first = editor.firstBlock()!.id;
		// a bullet run, then a numbered run at level 1 (a new list), a paragraph, a check list
		expect(structure(host)).toEqual([first, ["b1", "b2", "b3"], ["n1"], "p", ["c1"]]);
		for (const group of host.querySelectorAll("[data-pen-list-group]")) {
			expect(group.tagName).toBe("DIV");
			expect(group.getAttribute("role")).toBe("list");
			expect(group.getAttribute("style")).toBeNull();
		}
		expect(itemAttributes(container, "b1")).toEqual(["listitem", "1", "1", "2"]);
		expect(itemAttributes(container, "b2")).toEqual(["listitem", "2", "1", "1"]);
		expect(itemAttributes(container, "b3")).toEqual(["listitem", "1", "2", "2"]);
		expect(itemAttributes(container, "p")).toEqual([null, null, null, null]);
		expect(container.querySelectorAll("ul, ol, li")).toHaveLength(0);
		// HB8: the layout host carries no list role or aria-* of its own.
		for (const layout of container.querySelectorAll("[data-pen-list-item-layout]")) {
			expect(layout.hasAttribute("role")).toBe(false);
			expect(layout.getAttributeNames().filter((name) => name.startsWith("aria-"))).toEqual([]);
		}

		// Inserting an item renumbers the set's positions on items it did not touch.
		await act(async () => {
			editor.apply(
				[{ type: "insert-block", blockId: "b0", blockType: "bulletListItem", props: {}, position: { after: "b1" } }],
				{ origin: "user" },
			);
		});
		expect(itemAttributes(container, "b3")).toEqual(["listitem", "1", "3", "3"]);
		// Converting the paragraph to a numbered item joins n1's run; the check list stays its own list.
		await act(async () => {
			editor.apply([{ type: "set-props", blockId: "p", props: { type: "numberedListItem" } }], { origin: "user" });
		});
		expect(structure(host)).toEqual([first, ["b1", "b0", "b2", "b3"], ["n1", "p"], ["c1"]]);
		expect(itemAttributes(container, "p")).toEqual(["listitem", "1", "2", "2"]);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
