import type { BlockHandle, Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { defineBlock } from "../index";
import { getListItemSemantics, getListSegments } from "../editor/listRuns";
import { createEditor } from "./editorCore.testHelpers";
import { createDefaultSchema } from "./fixtures/testSchema";

type Spec = readonly [id: string, type: string, indent?: number];

/** A read-only editor stand-in: the helpers read `getBlock(id).type` and `props.indent` only. */
function fakeEditor(specs: readonly Spec[]): { editor: Editor; ids: string[] } {
	const blocks = new Map<string, BlockHandle>();
	for (const [id, type, indent] of specs) {
		blocks.set(id, { id, type, props: indent === undefined ? {} : { indent } } as unknown as BlockHandle);
	}
	const editor = { getBlock: (id: string) => blocks.get(id) ?? null } as unknown as Editor;
	return { editor, ids: specs.map(([id]) => id) };
}

function positions(semantics: ReadonlyMap<string, { level: number; posinset: number; setsize: number }>) {
	return Object.fromEntries(
		[...semantics].map(([id, item]) => [id, `${item.level}:${item.posinset}/${item.setsize}`]),
	);
}

describe("listRuns", () => {
	it("AX1: consecutive list items form one group and any other block ends it", () => {
		const { editor, ids } = fakeEditor([
			["p1", "paragraph"],
			["b1", "bulletListItem"],
			["b2", "bulletListItem"],
			["p2", "paragraph"],
			["b3", "bulletListItem"],
		]);
		expect(getListSegments(editor, ids)).toEqual([
			{ kind: "block", blockId: "p1" },
			{ kind: "list", key: "b1", blockIds: ["b1", "b2"] },
			{ kind: "block", blockId: "p2" },
			{ kind: "list", key: "b3", blockIds: ["b3"] },
		]);
		const semantics = getListItemSemantics(editor, ids);
		expect(positions(semantics)).toEqual({ b1: "1:1/2", b2: "1:2/2", b3: "1:1/1" });
		expect(semantics.get("b2")?.groupKey).toBe("b1");
		expect(semantics.get("b3")?.groupKey).toBe("b3");
		expect(semantics.has("p1")).toBe(false);
	});

	it("AX1: a top-level list type change starts a new group; a nested type change starts a new set", () => {
		const { editor, ids } = fakeEditor([
			["b1", "bulletListItem"],
			["b2", "bulletListItem"],
			["n1", "numberedListItem"],
			["n2", "numberedListItem"],
			["n3", "numberedListItem", 1],
			["c1", "checkListItem", 1],
			["c2", "checkListItem", 1],
		]);
		expect(getListSegments(editor, ids)).toEqual([
			{ kind: "list", key: "b1", blockIds: ["b1", "b2"] },
			{ kind: "list", key: "n1", blockIds: ["n1", "n2", "n3", "c1", "c2"] },
		]);
		expect(positions(getListItemSemantics(editor, ids))).toEqual({
			b1: "1:1/2",
			b2: "1:2/2",
			n1: "1:1/2",
			n2: "1:2/2",
			n3: "2:1/1",
			c1: "2:1/2",
			c2: "2:2/2",
		});
	});

	it("AX1: aria-level is indent plus one and posinset/setsize count within the set", () => {
		const { editor, ids } = fakeEditor([
			["a", "bulletListItem"],
			["a1", "bulletListItem", 1],
			["a2", "bulletListItem", 1],
			["a2x", "bulletListItem", 2],
			["b", "bulletListItem"],
			["b1", "bulletListItem", 1],
			["c", "bulletListItem", 0.7],
			["d", "bulletListItem", -2],
		]);
		const semantics = getListItemSemantics(editor, ids);
		expect(positions(semantics)).toEqual({
			a: "1:1/4",
			a1: "2:1/2",
			a2: "2:2/2",
			a2x: "3:1/1",
			b: "1:2/4",
			// a new shallower parent starts a new nested set
			b1: "2:1/1",
			c: "1:3/4",
			d: "1:4/4",
		});
		for (const item of semantics.values()) expect(item.groupKey).toBe("a");
	});

	it("AX1: a nested item opening a group does not split it when a top-level item follows", () => {
		const { editor, ids } = fakeEditor([
			["x", "numberedListItem", 1],
			["y", "bulletListItem"],
			["z", "numberedListItem"],
		]);
		expect(getListSegments(editor, ids)).toEqual([
			{ kind: "list", key: "x", blockIds: ["x", "y"] },
			{ kind: "list", key: "z", blockIds: ["z"] },
		]);
	});

	it("AX1: segments are computed per sibling list, not over blockOrder", () => {
		const container = defineBlock("listHost", { content: "inline", isContainer: true });
		const editor = createEditor({ schema: createDefaultSchema().extend([container]) });
		editor.apply(
			[
				{ type: "insert-block", blockId: "top", blockType: "bulletListItem", props: {}, position: "last" },
				{ type: "insert-block", blockId: "host", blockType: "listHost", props: {}, position: { after: "top" } },
				{ type: "insert-block", blockId: "c1", blockType: "bulletListItem", props: {}, position: { parent: "host", index: 0 } },
				{ type: "insert-block", blockId: "c2", blockType: "bulletListItem", props: {}, position: { parent: "host", index: 1 } },
				{ type: "insert-block", blockId: "tail", blockType: "bulletListItem", props: {}, position: { after: "host" } },
			],
			{ origin: "user" },
		);
		const children = editor.documentState.childrenOf("host");
		expect(children).toEqual(["c1", "c2"]);
		expect(getListSegments(editor, children)).toEqual([
			{ kind: "list", key: "c1", blockIds: ["c1", "c2"] },
		]);
		expect(positions(getListItemSemantics(editor, children))).toEqual({ c1: "1:1/2", c2: "1:2/2" });
		// The editor's initial paragraph leads the root list.
		const roots = editor.documentState.blockOrder.filter(
			(id) => editor.documentState.parentOf(id) === null,
		);
		expect(roots.slice(1)).toEqual(["top", "host", "tail"]);
		expect(getListSegments(editor, roots).map((segment) => segment.kind)).toEqual([
			"block",
			"list",
			"block",
			"list",
		]);
		editor.destroy();
	});
});
