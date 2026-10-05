import { afterEach, describe, expect, it } from "vitest";

import {
	createPeerHarness,
	createTestEditor,
	findStructuralViolations,
	type PeerHarness,
	type TestEditor,
} from "../index";

// RI6: a block has one nesting route. A container's `children` array owns
// its children, so deleting the container deletes them, and a block stored
// in a `children` array never also keeps a `parentId`.

let editor: TestEditor | null = null;
let harness: PeerHarness | null = null;

afterEach(() => {
	editor?.destroy();
	editor = null;
	harness?.destroy();
	harness = null;
});

function nested(): TestEditor {
	const created = createTestEditor({
		blocks: [
			{ id: "p", type: "paragraph", content: "Root" },
			{ id: "l1", type: "bulletListItem", content: "L1" },
			{ id: "c1", type: "callout", content: "Box", children: [] },
			{ id: "c2", type: "callout", content: "Inner", children: [] },
			{ id: "k1", type: "paragraph", content: "Kid" },
			{ id: "k2", type: "paragraph", content: "Grandkid" },
		],
	});
	created.apply([
		{ type: "move-block", blockId: "c2", position: { parent: "c1", index: 0 } },
		{ type: "move-block", blockId: "k1", position: { parent: "c1", index: 1 } },
		{ type: "move-block", blockId: "k2", position: { parent: "c2", index: 0 } },
	]);
	return created;
}

function codesOf(target: TestEditor): string[] {
	const codes: string[] = [];
	target.on("diagnostic", (event) => codes.push(event.code));
	return codes;
}

describe("RI6 nesting routes", () => {
	it("RI6: deleting a children-array container deletes its children at every depth", () => {
		editor = nested();
		expect(editor.documentState.preorderBlockIds()).toEqual(["p", "l1", "c1", "c2", "k2", "k1"]);

		editor.apply([{ type: "delete-block", blockId: "c1" }]);

		expect([...editor.document.blocks.keys()].sort()).toEqual(["l1", "p"]);
		expect(editor.documentState.preorderBlockIds()).toEqual(["p", "l1"]);
		expect(findStructuralViolations(editor)).toEqual([]);
	});

	it("RI6: set-props parentId on a block in a children array keeps the children route", () => {
		editor = nested();
		const codes = codesOf(editor);
		editor.apply([{ type: "set-props", blockId: "k1", props: { parentId: "l1" } }]);

		expect(editor.getBlock("k1").props.parentId || null).toBeNull();
		expect(editor.documentState.parentOf("k1")).toBe("c1");
		expect(editor.documentState.childrenOf("l1")).toEqual([]);
		expect(codes).toContain("nesting-route-conflict");
	});

	it("RI6: moving a parentId child into a children array clears its parentId", () => {
		editor = nested();
		editor.apply([
			{ type: "insert-block", blockId: "l2", blockType: "bulletListItem", props: { parentId: "l1" }, position: "last" },
		]);
		expect(editor.documentState.parentOf("l2")).toBe("l1");

		editor.apply([{ type: "move-block", blockId: "l2", position: { parent: "c1", index: 0 } }]);
		expect(editor.getBlock("l2").props.parentId || null).toBeNull();
		expect(editor.documentState.parentOf("l2")).toBe("c1");
		expect(editor.documentState.childrenOf("c1")).toEqual(["l2", "c2", "k1"]);
	});

	it("RI6: a parentId naming the same container agrees with the array and is kept", () => {
		editor = nested();
		const codes = codesOf(editor);
		editor.apply([{ type: "set-props", blockId: "k1", props: { parentId: "c1" } }]);
		expect(editor.getBlock("k1").props.parentId).toBe("c1");
		expect(editor.documentState.parentOf("k1")).toBe("c1");
		expect(codes).not.toContain("nesting-route-conflict");
	});

	it("RI6 COL4: a concurrent parentId and move into a container converge on the children route", () => {
		harness = createPeerHarness(2, {
			blocks: [
				{ id: "anchor", type: "paragraph", content: "Anchor" },
				{ id: "l1", type: "bulletListItem", content: "L1" },
				{ id: "l2", type: "bulletListItem", content: "L2" },
				{ id: "c1", type: "callout", content: "Box", children: [] },
			],
		});
		harness.peer(0).editor.apply([{ type: "set-props", blockId: "l2", props: { parentId: "l1" } }]);
		harness.peer(1).editor.apply([
			{ type: "move-block", blockId: "l2", position: { parent: "c1", index: 0 } },
		]);
		harness.syncAll();
		// The next local commit on either peer repairs it.
		harness.peer(0).editor.apply([
			{ type: "splice-text", blockId: "anchor", from: 0, to: 0, insert: "." },
		]);
		harness.syncAll();
		harness.assertConverged();
		for (const peer of harness.peers) {
			expect(peer.editor.getBlock("l2").props.parentId || null).toBeNull();
			expect(peer.editor.documentState.parentOf("l2")).toBe("c1");
			expect(findStructuralViolations(peer.editor)).toEqual([]);
		}
	});
});
