import { initBlockMap, wrapYjsDocument, yjsAdapter } from "@input/pen-yjs";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	assertStructuralInvariants,
	createTestEditor,
	findStructuralViolations,
} from "../index";
import type { StructuralViolation } from "../index";

// Raw Y.Doc fixtures built before any editor exists, so normalization cannot
// repair them first (the normalize.containersAndComparison.test.ts pattern).

type RawBlock = { id: string; children?: string[]; parentId?: string };

function rawDocument(order: readonly string[], blocks: readonly RawBlock[]) {
	const ydoc = new Y.Doc({ gc: false });
	const blocksMap = ydoc.getMap<Y.Map<unknown>>("blocks");
	ydoc.transact(() => {
		for (const block of blocks) {
			const blockMap = initBlockMap(
				blocksMap,
				block.id,
				block.children ? "callout" : "paragraph",
				block.children ? "nested" : "inline",
			);
			if (block.children) {
				(blockMap.get("children") as Y.Array<string>).push(block.children);
			}
			if (block.parentId) {
				(blockMap.get("props") as Y.Map<unknown>).set("parentId", block.parentId);
			}
		}
		ydoc.getArray<string>("blockOrder").push([...order]);
	});
	return wrapYjsDocument(yjsAdapter(), ydoc).penDocument;
}

describe("structural invariants oracle", () => {
	it("COL4: assertStructuralInvariants names a dangling, duplicate, orphan, cross-array, and cycle violation", () => {
		const clean = rawDocument(["p1", "c1"], [
			{ id: "p1" },
			{ id: "c1", children: ["k1"] },
			{ id: "k1" },
		]);
		expect(findStructuralViolations(clean)).toEqual([]);
		expect(() => assertStructuralInvariants(clean)).not.toThrow();

		const cases: Array<[order: string[], blocks: RawBlock[], expected: StructuralViolation[]]> = [
			[["p1", "ghost"], [{ id: "p1" }], [{ kind: "dangling-entry", array: "blockOrder", blockId: "ghost" }]],
			[
				["c1"],
				[{ id: "c1", children: ["ghost"] }],
				[{ kind: "dangling-entry", array: { children: "c1" }, blockId: "ghost" }],
			],
			[
				["p1", "p2", "p1"],
				[{ id: "p1" }, { id: "p2" }],
				[{ kind: "duplicate-entry", array: "blockOrder", blockId: "p1", count: 2 }],
			],
			[["p1"], [{ id: "p1" }, { id: "lost" }], [{ kind: "orphan", blockId: "lost" }]],
			[
				["c1", "c2", "k1"],
				[{ id: "c1", children: ["k1"] }, { id: "c2", children: ["k1"] }, { id: "k1" }],
				[{ kind: "cross-array", blockId: "k1", memberships: 3 }],
			],
			[
				["l1", "l2"],
				[{ id: "l1", parentId: "l2" }, { id: "l2", parentId: "l1" }],
				[{ kind: "cycle", blockIds: ["l1", "l2"] }],
			],
		];
		for (const [order, blocks, expected] of cases) {
			const document = rawDocument(order, blocks);
			expect(findStructuralViolations(document)).toEqual(expected);
			expect(() => assertStructuralInvariants(document, "fixture")).toThrow(
				/^fixture\nStructural invariants violated/,
			);
		}
		expect(() => assertStructuralInvariants(rawDocument(["p1"], [{ id: "p1" }, { id: "lost" }]))).toThrow(
			/orphan: "lost"/,
		);
	});

	it("COL4: a normalized test editor satisfies the oracle", () => {
		const editor = createTestEditor({
			blocks: [
				{ id: "p1", type: "paragraph", content: "One" },
				{ id: "c1", type: "callout", content: "Box", children: [] },
				{ id: "l1", type: "bulletListItem", content: "Item" },
			],
		});
		try {
			expect(findStructuralViolations(editor)).toEqual([]);
		} finally {
			editor.destroy();
		}
	});
});
