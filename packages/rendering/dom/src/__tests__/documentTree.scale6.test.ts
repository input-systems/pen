// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";
import { mountEditor } from "../host/mountEditor";

afterEach(() => {
	document.body.replaceChildren();
});

function createDocument(blockCount: number): Editor {
	const editor = createEditor({ schema: defaultSchema });
	const ops: DocumentOp[] = [];
	for (let index = 1; index < blockCount; index += 1) {
		ops.push(
			{ type: "insert-block", blockId: `b${index}`, blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: `b${index}`, from: 0, to: 0, insert: `block ${index}` },
		);
	}
	editor.apply(ops);
	return editor;
}

/** The block ids whose element subtree saw a DOM mutation. */
function touchedBlocks(records: MutationRecord[]): string[] {
	const ids = new Set<string>();
	for (const record of records) {
		const node = record.target instanceof Element ? record.target : record.target.parentElement;
		const block = node?.closest("[data-pen-editor-block]");
		const id = block?.getAttribute("data-block-id");
		if (id) ids.add(id);
	}
	return [...ids];
}

describe("vanilla document tree (SCALE6)", () => {
	it("SCALE6: the vanilla tree updates only notified blocks", () => {
		const editor = createDocument(200);
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		const host = root.querySelector("[data-pen-editor-blocks-host]") as HTMLElement;
		expect(host.children).toHaveLength(200);

		const observer = new MutationObserver(() => {});
		observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
		editor.apply([{ type: "splice-text", blockId: "b50", from: 0, to: 0, insert: "x" }], { origin: "user" });
		expect(touchedBlocks(observer.takeRecords())).toEqual(["b50"]);
		expect(host.querySelector('[data-block-id="b50"]')?.textContent).toBe("xblock 50");

		// A reorder moves only the node out of place.
		const insertBefore = host.insertBefore.bind(host);
		let moves = 0;
		host.insertBefore = ((node: Node, child: Node | null) => {
			moves += 1;
			return insertBefore(node, child);
		}) as typeof host.insertBefore;
		editor.apply([{ type: "move-block", blockId: "b150", position: { after: "b10" } }]);
		expect(moves).toBe(1);
		const order = [...host.children].map((element) => element.getAttribute("data-block-id"));
		expect(order.indexOf("b150")).toBe(order.indexOf("b10") + 1);

		observer.disconnect();
		mounted.destroy();
		editor.destroy();
	});
});
