import { beforeEach, describe, expect, it } from "vitest";
import {
	createTwoPeerHarness,
	resetTestIdCounter,
	runBothInterleavings,
	TWO_PEER_INTERLEAVINGS,
	visibleText,
} from "../index";

beforeEach(() => {
	resetTestIdCounter();
});

// The COL4 rows live in col4NPeer.test.ts at two, three, and five peers.
// This file keeps createTwoPeerHarness's own contract.
describe("COL4 two-peer harness contract", () => {
	it("COL4: harness uses two adapters and incremental encodeUpdate/applyUpdate", () => {
		runBothInterleavings(
			{ blocks: [{ id: "p1", type: "paragraph", content: "Hello" }] },
			(harness, interleaving) => {
				expect(harness.peerA.adapter).not.toBe(harness.peerB.adapter);
				expect(harness.peer("a")).toBe(harness.peerA);
				expect(harness.peer("b")).toBe(harness.peerB);

				harness.peerA.editor.apply([
					{
						type: "splice-text",
						blockId: "p1",
						from: 5,
				to: 5,
				insert: " A",
					},
				]);
				harness.peerB.editor.apply([
					{
						type: "splice-text",
						blockId: "p1",
						from: 5,
				to: 5,
				insert: " B",
					},
				]);

				const { fromA, fromB } = harness.captureUpdates();
				const fullA = harness.peerA.adapter.encodeState(harness.peerA.crdtDoc);
				const fullB = harness.peerB.adapter.encodeState(harness.peerB.crdtDoc);
				expect(fromA.byteLength).toBeLessThan(fullA.byteLength);
				expect(fromB.byteLength).toBeLessThan(fullB.byteLength);

				harness.exchange(interleaving);
				harness.assertConverged();
				expect(visibleText(harness.peerA.editor)).toContain("Hello");
				expect(visibleText(harness.peerA.editor)).toContain("A");
				expect(visibleText(harness.peerA.editor)).toContain("B");
			},
		);
	});

	it("TWO_PEER_INTERLEAVINGS is the pair runBothInterleavings actually walks", () => {
		expect(TWO_PEER_INTERLEAVINGS.length).toBeGreaterThanOrEqual(2);
		expect(new Set(TWO_PEER_INTERLEAVINGS).size).toBe(
			TWO_PEER_INTERLEAVINGS.length,
		);

		const seen: string[] = [];
		runBothInterleavings(
			{ blocks: [{ id: "p1", type: "paragraph", content: "Hello" }] },
			(_harness, interleaving) => {
				seen.push(interleaving);
			},
		);
		expect(seen).toEqual([...TWO_PEER_INTERLEAVINGS]);
	});

	it("assertConverged throws when peers diverge and nobody syncs", () => {
		const harness = createTwoPeerHarness({
			blocks: [{ id: "p1", type: "paragraph", content: "Hello" }],
		});
		try {
			harness.peerA.editor.apply(
				[{ type: "splice-text", blockId: "p1", from: 5,
				to: 5,
				insert: " A" }],
				{ origin: "user" },
			);
			expect(() => harness.assertConverged()).toThrow(
				/Two-peer documents did not converge/,
			);
		} finally {
			harness.destroy();
		}
	});
});
