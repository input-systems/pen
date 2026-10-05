import type { DocumentOp } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { createHeadlessEditor } from "../index";
import { defaultSchema } from "./fixtures/testSchema";

type Editor = ReturnType<typeof createHeadlessEditor>;

/** A toggle `t` with `parentId` children `c1`, `c2`, and an unrelated paragraph `spare`. */
function createRouted(): Editor {
	const editor = createHeadlessEditor({ schema: defaultSchema });
	const ops: DocumentOp[] = [
		{ type: "insert-block", blockId: "t", blockType: "toggle", props: {}, position: "last" },
		{ type: "insert-block", blockId: "c1", blockType: "bulletListItem", props: { parentId: "t" }, position: "last" },
		{ type: "insert-block", blockId: "c2", blockType: "bulletListItem", props: { parentId: "t" }, position: "last" },
		{ type: "insert-block", blockId: "spare", blockType: "paragraph", props: {}, position: "last" },
	];
	editor.apply(ops, { origin: "system" });
	return editor;
}

function parentIdOf(editor: Editor, blockId: string): unknown {
	return editor.getBlock(blockId)?.props.parentId;
}

describe("normalization Rule 10 (orphan promotion) through the parentId index (SCALE2)", () => {
	it("SCALE2: deleting a parent clears every parentId naming it, before and after the index is built", () => {
		const editor = createRouted();
		// The first delete builds the index; the second reads it.
		editor.apply([{ type: "delete-block", blockId: "spare" }], { origin: "user" });
		expect(parentIdOf(editor, "c1")).toBe("t");
		// Committed after the build: the index advances by the commit's delta.
		editor.apply(
			[{ type: "insert-block", blockId: "c3", blockType: "bulletListItem", props: { parentId: "t" }, position: "last" }],
			{ origin: "user" },
		);
		editor.apply([{ type: "set-props", blockId: "c2", props: { parentId: null } }], { origin: "user" });
		editor.apply([{ type: "set-props", blockId: "c2", props: { parentId: "t" } }], { origin: "user" });

		editor.apply([{ type: "delete-block", blockId: "t" }], { origin: "user" });

		for (const id of ["c1", "c2", "c3"]) expect(parentIdOf(editor, id), id).toBeFalsy();
		expect(editor.documentState.parentOf("c1")).toBeNull();
		editor.destroy();
	});

	it("SCALE2: a parentId written earlier in the same apply as the delete is cleared", () => {
		const editor = createRouted();
		editor.apply([{ type: "delete-block", blockId: "spare" }], { origin: "user" });

		editor.apply(
			[
				{ type: "insert-block", blockId: "c3", blockType: "bulletListItem", props: { parentId: "t" }, position: "last" },
				{ type: "set-props", blockId: "c1", props: { parentId: null } },
				{ type: "insert-block", blockId: "u", blockType: "toggle", props: {}, position: "last" },
				{ type: "set-props", blockId: "c1", props: { parentId: "u" } },
				{ type: "delete-block", blockId: "t" },
				{ type: "delete-block", blockId: "u" },
			],
			{ origin: "user" },
		);

		for (const id of ["c1", "c2", "c3"]) expect(parentIdOf(editor, id), id).toBeFalsy();
		editor.destroy();
	});

	it("SCALE2: a parentId a remote commit wrote is cleared by the next local delete", () => {
		const editor = createRouted();
		editor.apply([{ type: "delete-block", blockId: "spare" }], { origin: "user" });
		const adapter = editor.internals.adapter;
		const crdtDoc = editor.internals.crdtDoc;
		const remote = createHeadlessEditor({ schema: defaultSchema });
		adapter.applyUpdate(remote.internals.crdtDoc, adapter.encodeState(crdtDoc));
		remote.apply(
			[{ type: "insert-block", blockId: "r1", blockType: "bulletListItem", props: { parentId: "t" }, position: "last" }],
			{ origin: "user" },
		);
		adapter.applyUpdate(crdtDoc, adapter.encodeState(remote.internals.crdtDoc));
		expect(parentIdOf(editor, "r1")).toBe("t");

		editor.apply([{ type: "delete-block", blockId: "t" }], { origin: "user" });

		expect(parentIdOf(editor, "r1")).toBeFalsy();
		remote.destroy();
		editor.destroy();
	});
});
