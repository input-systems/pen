import { afterEach, describe, expect, it } from "vitest";

import { createPeerHarness, type PeerHarness } from "../index";

// COL4: an order entry that outlives its block map (a concurrent move
// re-inserted it after a concurrent delete) is skipped by core's iteration
// APIs until the next local structural pass removes it.

let harness: PeerHarness | null = null;

afterEach(() => {
	harness?.destroy();
	harness = null;
});

function deleteAgainstMove(): PeerHarness {
	const created = createPeerHarness(2, {
		blocks: [
			{ id: "p1", type: "paragraph", content: "One" },
			{ id: "p2", type: "paragraph", content: "Two" },
			{ id: "p3", type: "paragraph", content: "Three" },
		],
	});
	created.peer(0).editor.apply([{ type: "delete-block", blockId: "p2" }]);
	created
		.peer(1)
		.editor.apply([{ type: "move-block", blockId: "p2", position: "first" }]);
	created.syncAll();
	return created;
}

describe("COL4 dangling entries in core iteration", () => {
	it("COL4: editor.blocks(), preorderBlockIds and blockCount skip an entry whose block map is gone", () => {
		harness = deleteAgainstMove();
		for (const peer of harness.peers) {
			const { editor } = peer;
			// Remote commits do not normalize: the entry is still there.
			expect(editor.documentState.blockOrder).toContain("p2");

			const handles = [...editor.blocks()];
			expect(handles.map((handle) => handle.id)).toEqual(["p1", "p3"]);
			expect(handles.map((handle) => handle.type)).toEqual([
				"paragraph",
				"paragraph",
			]);
			expect(editor.documentState.preorderBlockIds()).toEqual(["p1", "p3"]);
			expect(editor.documentState.preorderIndexOf("p2")).toBe(-1);
			expect(editor.documentState.blockCount).toBe(2);
			expect(editor.blockCount()).toBe(2);
			expect(editor.firstBlock()?.id).toBe("p1");
		}
	});

	it("COL4: a dangling child entry is skipped under its parent", () => {
		harness = createPeerHarness(2, {
			blocks: [
				{ id: "c1", type: "callout", content: "Box", children: [] },
				{ id: "p2", type: "paragraph", content: "Two" },
			],
		});
		harness.peer(0).editor.apply([{ type: "delete-block", blockId: "p2" }]);
		harness.peer(1).editor.apply([
			{ type: "move-block", blockId: "p2", position: { parent: "c1", index: 0 } },
		]);
		harness.syncAll();
		for (const peer of harness.peers) {
			const { editor } = peer;
			expect(editor.documentState.childrenOf("c1")).toContain("p2");
			expect([...editor.blocks()].map((handle) => handle.id)).toEqual(["c1"]);
			expect(editor.documentState.preorderBlockIds()).toEqual(["c1"]);
			expect(editor.documentState.blockCount).toBe(1);
		}
	});

	it("COL4: the next local commit removes the entry and iteration is unchanged", () => {
		harness = deleteAgainstMove();
		const { editor } = harness.peer(1);
		editor.apply([
			{ type: "splice-text", blockId: "p1", from: 3, to: 3, insert: "!" },
		]);
		expect(editor.documentState.blockOrder).toEqual(["p1", "p3"]);
		expect([...editor.blocks()].map((handle) => handle.id)).toEqual(["p1", "p3"]);
	});
});
