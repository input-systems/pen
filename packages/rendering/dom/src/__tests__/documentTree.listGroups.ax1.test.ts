// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";
import { mountEditor } from "../host/mountEditor";

afterEach(() => {
	document.body.replaceChildren();
});

/** p0, b1, b2, p3, b4 — b0 reuses the editor's first block as a paragraph. */
function createDocument(): Editor {
	const editor = createEditor({ schema: defaultSchema });
	const first = editor.firstBlock()!.id;
	const ops: DocumentOp[] = [{ type: "splice-text", blockId: first, from: 0, to: 0, insert: "intro" }];
	const types = ["bulletListItem", "bulletListItem", "paragraph", "bulletListItem"];
	types.forEach((type, index) => {
		const id = `b${index + 1}`;
		ops.push(
			{ type: "insert-block", blockId: id, blockType: type, props: {}, position: "last" },
			{ type: "splice-text", blockId: id, from: 0, to: 0, insert: id },
		);
	});
	editor.apply(ops, { origin: "system" });
	return editor;
}

/** The host's structure: block ids, with each list group as a nested array. */
function structure(host: Element): unknown[] {
	return [...host.children].map((child) =>
		child.hasAttribute("data-pen-list-group")
			? [...child.children].map((item) => item.getAttribute("data-block-id"))
			: child.getAttribute("data-block-id"),
	);
}

describe("vanilla document tree list groups (AX1)", () => {
	it("AX1: mountEditor groups list runs and reorder moves nodes without recreating them", () => {
		const editor = createDocument();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		const host = root.querySelector("[data-pen-editor-blocks-host]") as HTMLElement;
		const first = editor.firstBlock()!.id;
		expect(structure(host)).toEqual([first, ["b1", "b2"], "b3", ["b4"]]);

		const group = host.querySelector("[data-pen-list-group]") as HTMLElement;
		expect(group.getAttribute("role")).toBe("list");
		expect(group.getAttribute("style")).toBeNull();
		const b2 = host.querySelector('[data-block-id="b2"]') as HTMLElement;
		expect(b2.getAttribute("role")).toBe("listitem");
		expect(b2.getAttribute("aria-level")).toBe("1");
		expect(b2.getAttribute("aria-posinset")).toBe("2");
		expect(b2.getAttribute("aria-setsize")).toBe("2");
		expect(host.querySelector('[data-block-id="b3"]')?.hasAttribute("role")).toBe(false);
		expect(host.querySelectorAll("ul, ol, li")).toHaveLength(0);

		// Converting the paragraph between the runs merges them; nodes move.
		const nodes = new Map(
			["b1", "b2", "b3", "b4"].map((id) => [id, host.querySelector(`[data-block-id="${id}"]`)]),
		);
		editor.apply([{ type: "set-props", blockId: "b3", props: { type: "bulletListItem" } }], { origin: "user" });
		expect(structure(host)).toEqual([first, ["b1", "b2", "b3", "b4"]]);
		expect(host.querySelectorAll("[data-pen-list-group]")).toHaveLength(1);
		expect(host.querySelector('[data-block-id="b4"]')?.getAttribute("aria-posinset")).toBe("4");

		// A move out of the group and back keeps every node.
		editor.apply([{ type: "move-block", blockId: "b2", position: { before: first } }], { origin: "user" });
		expect(structure(host)).toEqual([["b2"], first, ["b1", "b3", "b4"]]);
		editor.apply([{ type: "move-block", blockId: "b2", position: { after: "b1" } }], { origin: "user" });
		expect(structure(host)).toEqual([first, ["b1", "b2", "b3", "b4"]]);
		for (const [id, node] of nodes) {
			expect(host.querySelector(`[data-block-id="${id}"]`)).toBe(node);
		}

		// Leaving the list drops the item attributes.
		editor.apply([{ type: "set-props", blockId: "b4", props: { type: "paragraph" } }], { origin: "user" });
		const b4 = host.querySelector('[data-block-id="b4"]') as HTMLElement;
		expect(b4.hasAttribute("role")).toBe(false);
		expect(b4.hasAttribute("aria-setsize")).toBe(false);
		expect(structure(host)).toEqual([first, ["b1", "b2", "b3"], "b4"]);

		mounted.destroy();
		editor.destroy();
	});
});
