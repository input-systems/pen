import { describe, expect, it } from "vitest";

import { createBlockIndexSnapshotFromDocument } from "../changes/fromDocument";
import { createNestedEditor } from "./fixtures/structuralEdits";

describe("apply into a missing parent", () => {
	it("PR5: an insert-block or move-block into a non-existent parent is dropped with PEN_APPLY_003", () => {
		const editor = createNestedEditor();
		const codes: string[] = [];
		editor.on("diagnostic", (event) => codes.push(event.code));
		const before = [...editor.documentState.preorderBlockIds()];

		editor.apply([
			{ type: "insert-block", blockId: "orphan", blockType: "paragraph", props: {}, position: { parent: "gone", index: 0 } },
		]);
		editor.apply([{ type: "move-block", blockId: "cols-a", position: { parent: "gone", index: 0 } }]);

		expect(codes.filter((code) => code === "PEN_APPLY_003")).toHaveLength(2);
		expect(editor.getBlock("orphan")).toBeNull();
		expect(editor.documentState.preorderBlockIds()).toEqual(before);
		// No block map entry outside the tree.
		const swept = createBlockIndexSnapshotFromDocument(editor.internals.doc);
		expect(swept.order).toEqual(before);
		editor.destroy();
	});

	it("PR5: a parent inserted earlier in the same batch is a valid target", () => {
		const editor = createNestedEditor();
		editor.apply([
			{ type: "insert-block", blockId: "cols3", blockType: "columns", props: {}, position: "last" },
			{ type: "insert-block", blockId: "cols3-a", blockType: "paragraph", props: {}, position: { parent: "cols3", index: 0 } },
			{ type: "insert-block", blockId: "cols3-b", blockType: "paragraph", props: {}, position: { parent: "cols3", index: 1 } },
		]);
		expect(editor.documentState.childrenOf("cols3")).toEqual(["cols3-a", "cols3-b"]);
		editor.destroy();
	});

	it("PR5: a parent deleted earlier in the same batch is not a valid target", () => {
		const editor = createNestedEditor();
		const codes: string[] = [];
		editor.on("diagnostic", (event) => codes.push(event.code));

		editor.apply([
			{ type: "delete-block", blockId: "cols" },
			{ type: "move-block", blockId: "cols2-a", position: { parent: "cols", index: 0 } },
			{ type: "insert-block", blockId: "late", blockType: "paragraph", props: {}, position: { parent: "cols", index: 0 } },
		]);

		expect(codes.filter((code) => code === "PEN_APPLY_003")).toHaveLength(2);
		expect(editor.getBlock("cols")).toBeNull();
		expect(editor.getBlock("late")).toBeNull();
		// The move is dropped, so the block stays where it was instead of
		// being written into the deleted parent's array and lost with it.
		expect(editor.documentState.childrenOf("cols2")).toEqual(["cols2-a", "cols2-b"]);
		expect(editor.documentState.preorderBlockIds()).toContain("cols2-a");
		editor.destroy();
	});

	it("PR5: a parent deleted and re-inserted in the same batch is a valid target again", () => {
		const editor = createNestedEditor();
		editor.apply([
			{ type: "delete-block", blockId: "cols2-b" },
			{ type: "delete-block", blockId: "cols2" },
			{ type: "insert-block", blockId: "cols2", blockType: "columns", props: {}, position: "last" },
			{ type: "move-block", blockId: "cols2-a", position: { parent: "cols2", index: 0 } },
			{ type: "insert-block", blockId: "cols2-c", blockType: "paragraph", props: {}, position: { parent: "cols2", index: 1 } },
		]);
		expect(editor.documentState.childrenOf("cols2")).toEqual(["cols2-a", "cols2-c"]);
		editor.destroy();
	});
});
