import type { DiagnosticEvent } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";

import {
	createPeerHarness,
	createTestEditor,
	findStructuralViolations,
	type PeerHarness,
} from "../index";

// COL4: a parent cycle or a duplicate entry that only a remote commit
// creates is repaired by the next local commit's pass on any peer, without
// normalizeAll and without a reload, and concurrent repairs converge.

let harness: PeerHarness | null = null;

afterEach(() => {
	harness?.destroy();
	harness = null;
});

/** A local commit that names no structural block: typing into "p". */
function typeOn(h: PeerHarness, index: number): void {
	h.peer(index).editor.apply([
		{ type: "splice-text", blockId: "p", from: 0, to: 0, insert: "." },
	]);
}

function crossedMoves(): PeerHarness {
	const created = createPeerHarness(2, {
		blocks: [
			{ id: "p", type: "paragraph", content: "Root" },
			{ id: "x1", type: "callout", content: "One", children: [] },
			{ id: "x2", type: "callout", content: "Two", children: [] },
		],
	});
	created.peer(0).editor.apply([
		{ type: "move-block", blockId: "x1", position: { parent: "x2", index: 0 } },
	]);
	created.peer(1).editor.apply([
		{ type: "move-block", blockId: "x2", position: { parent: "x1", index: 0 } },
	]);
	created.syncAll();
	return created;
}

describe("COL4 per-commit structural repair", () => {
	it("COL4: a remote parent cycle is broken by the next local commit, not only by normalizeAll", () => {
		harness = crossedMoves();
		const diagnostics: DiagnosticEvent[] = [];
		harness.peer(0).editor.on("diagnostic", (event) => diagnostics.push(event));
		expect(harness.peer(0).editor.documentState.blockOrder).toEqual(["p"]);

		typeOn(harness, 0);
		harness.syncAll();

		for (const peer of harness.peers) {
			expect(findStructuralViolations(peer.editor)).toEqual([]);
			expect(peer.editor.documentState.preorderBlockIds()).toEqual(["p", "x2", "x1"]);
		}
		expect(diagnostics.map((event) => event.code)).toContain("parent-cycle");
	});

	it.each([
		{ name: "one peer removes it", removers: [1] },
		{ name: "every peer removes it concurrently", removers: [0, 1] },
	])("COL4: peers repairing one cycle concurrently converge with no duplicate entry ($name)", ({ removers }) => {
		harness = crossedMoves();
		// Both peers repair the same state before either repair is exchanged:
		// each appends its own root entry for the detached block.
		typeOn(harness, 0);
		typeOn(harness, 1);
		harness.syncAll();
		expect(harness.peer(0).editor.documentState.blockOrder).toEqual(["p", "x2", "x2"]);

		// The duplicate is a remote commit's doing, so the next local commit
		// on any peer removes it.
		for (const index of removers) typeOn(harness, index);
		harness.syncAll();
		harness.assertConverged();
		for (const peer of harness.peers) {
			expect(findStructuralViolations(peer.editor)).toEqual([]);
			expect(peer.editor.documentState.blockOrder).toEqual(["p", "x2"]);
			expect(peer.editor.documentState.childrenOf("x2")).toEqual(["x1"]);
		}
	});

	it("COL4: the cycle break is the same whichever block of the cycle a pass reaches first", () => {
		// x1 owns two edges of the cycle: its parentId names x2, and its
		// children list x2. The tie on owner id must not depend on the walk.
		const results = new Set<string>();
		for (const first of ["x1", "x2"] as const) {
			const editor = createTestEditor({
				blocks: [
					{ id: "p", type: "paragraph", content: "Root" },
					{ id: "x1", type: "callout", content: "One", children: [] },
					{ id: "x2", type: "callout", content: "Two", children: [] },
				],
			});
			try {
				editor.apply([
					{ type: "move-block", blockId: "x2", position: { parent: "x1", index: 0 } },
				]);
				// The pass normalizes dirty blocks in op order, so `first` is
				// where the cycle walk starts.
				const touch = { type: "set-meta", blockId: first, namespace: "test", data: { n: 1 } } as const;
				const close = { type: "set-props", blockId: "x1", props: { parentId: "x2" } } as const;
				editor.apply(first === "x2" ? [touch, close] : [close, touch]);
				expect(findStructuralViolations(editor)).toEqual([]);
				results.add(
					JSON.stringify({
						order: editor.documentState.blockOrder,
						x1Parent: editor.getBlock("x1").props.parentId || null,
						x1Children: editor.documentState.childrenOf("x1"),
					}),
				);
			} finally {
				editor.destroy();
			}
		}
		expect([...results]).toEqual([
			JSON.stringify({ order: ["p", "x1"], x1Parent: null, x1Children: ["x2"] }),
		]);
	});
});
