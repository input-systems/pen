import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vitest";

import {
	createPeerHarness,
	findStructuralViolations,
	type PeerHarness,
	type PeerIndex,
} from "../index";

// COL4 Rule 12 under out-of-order delivery: an order entry written by one
// client can reach a peer before the block map another client wrote, and a
// local pass in between must not take the entry for a dangling one.

let harness: PeerHarness | null = null;

afterEach(() => {
	harness?.destroy();
	harness = null;
});

/** `from`'s update carrying only `author`'s structs and deletes the target lacks. */
function updateFromClientOnly(
	h: PeerHarness,
	from: PeerIndex,
	to: PeerIndex,
	author: PeerIndex,
): Uint8Array {
	const source = h.peer(from).editor.ydoc;
	const authorClient = h.peer(author).editor.ydoc.clientID;
	const targetVector = Y.decodeStateVector(h.stateVector(to));
	const sourceVector = Y.decodeStateVector(h.stateVector(from));
	// Claim the target has every struct but `author`'s.
	const claimed = new Map(sourceVector);
	claimed.set(authorClient, targetVector.get(authorClient) ?? 0);
	return Y.encodeStateAsUpdate(source, Y.encodeStateVector(claimed));
}

describe("COL4 out-of-order structural delivery", () => {
	it("COL4: an order entry that arrives before its block map survives a local pass", () => {
		harness = createPeerHarness(3, {
			blocks: [
				{ id: "p1", type: "paragraph", content: "One" },
				{ id: "p2", type: "paragraph", content: "Two" },
			],
		});
		const [a, b, c] = [0, 1, 2] as const;
		harness.peer(a).editor.apply([
			{ type: "insert-block", blockId: "x", blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: "x", from: 0, to: 0, insert: "Fresh" },
		]);
		harness.deliver(a, b);
		harness.peer(b).editor.apply([{ type: "move-block", blockId: "x", position: "first" }]);

		// c hears b's move before a's insert.
		harness.applyUpdateTo(c, updateFromClientOnly(harness, b, c, b));
		const peerC = harness.peer(c).editor;
		const codes: string[] = [];
		peerC.on("diagnostic", (event) => codes.push(event.code));
		// The entry is there; the block map it names is still in flight.
		expect(peerC.documentState.blockOrder[0]).toBe("x");
		expect(peerC.document.blocks.has("x")).toBe(false);

		// A local pass on c before a's update arrives.
		peerC.apply([{ type: "splice-text", blockId: "p1", from: 3, to: 3, insert: "!" }]);

		harness.syncAll();
		harness.quiesce();
		harness.assertConverged();
		for (const peer of harness.peers) {
			expect(findStructuralViolations(peer.editor)).toEqual([]);
			// b's move stands: the block is first, not removed and re-homed.
			expect(peer.editor.documentState.blockOrder).toEqual(["x", "p1", "p2"]);
			expect(peer.editor.getBlock("x").textContent()).toBe("Fresh");
		}
		expect(codes).not.toContain("dangling-block-reference");
	});
});
