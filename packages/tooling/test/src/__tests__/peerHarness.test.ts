import type { CommitEvent } from "@input/pen-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
	createPeerHarness,
	createTwoPeerHarness,
	MAX_QUIESCE_ROUNDS,
	PEER_HARNESS_MAX_PEERS,
	PEER_HARNESS_MIN_PEERS,
	PEER_SCHEDULES,
	PeerHarnessQuiesceError,
	assertStructuralInvariants,
	hasParentCycle,
	resetTestIdCounter,
	visibleText,
} from "../index";
import type { PeerHarness } from "../types";

beforeEach(() => {
	resetTestIdCounter();
});

const HELLO = { blocks: [{ id: "p1", type: "paragraph", content: "Hello" }] };

function typeAt(harness: PeerHarness, index: number, text: string): void {
	const editor = harness.peer(index).editor;
	const at = editor.getBlock("p1").textContent().length;
	editor.apply([{ type: "splice-text", blockId: "p1", from: at, to: at, insert: text }], {
		origin: "user",
	});
}

describe("createPeerHarness", () => {
	it("COL1: createPeerHarness forks n peers from one seed and every remote commit is collaborator", () => {
		const harness = createPeerHarness(3, HELLO);
		try {
			const clientIds = harness.peers.map((peer) => peer.editor.ydoc.clientID);
			expect(new Set(clientIds).size).toBe(3);
			expect(harness.peers.map((peer) => peer.label)).toEqual(["a", "b", "c"]);
			harness.assertConverged();

			const remoteOrigins: string[][] = harness.peers.map(() => []);
			harness.peers.forEach((peer, index) => {
				peer.editor.on("commit", (event: CommitEvent) => {
					if (event.source === "remote") remoteOrigins[index]!.push(event.origin.type);
				});
			});

			typeAt(harness, 0, " from-a");
			const undoBefore = harness.peers.map((peer) => peer.editor.undoManager.canUndo());
			harness.run("pairwise");
			harness.assertConverged();

			expect(visibleText(harness.peer(2).editor, "p1")).toBe("Hello from-a");
			expect(remoteOrigins[0]).toEqual([]);
			for (const index of [1, 2]) {
				expect(remoteOrigins[index]!.length).toBeGreaterThan(0);
				expect(new Set(remoteOrigins[index])).toEqual(new Set(["collaborator"]));
				// A remote edit never enters this client's undo stack (COL1).
				expect(harness.peer(index).editor.undoManager.canUndo()).toBe(undoBefore[index]);
			}
		} finally {
			harness.destroy();
		}
	});

	it("COL1: a provider-path delivery is classified collaborator by its non-local transaction", () => {
		const harness = createPeerHarness(2, HELLO);
		try {
			const commits: CommitEvent[] = [];
			harness.peer(1).editor.on("commit", (event: CommitEvent) => {
				commits.push(event);
			});
			const transactions: Array<{ local: boolean; origin: unknown }> = [];
			const blocks = harness.peer(1).editor.ydoc.getMap<Y.Map<unknown>>("blocks");
			(blocks.get("p1")!.get("content") as Y.Text).observe((_event, transaction) => {
				transactions.push({ local: transaction.local, origin: transaction.origin });
			});

			typeAt(harness, 0, " via-provider");
			harness.deliver(0, 1, { via: "provider" });

			expect(visibleText(harness.peer(1).editor, "p1")).toBe("Hello via-provider");
			expect(transactions).toHaveLength(1);
			expect(transactions[0]!.local).toBe(false);
			// Not the adapter's structured origin: only `local === false` classifies it.
			expect((transactions[0]!.origin as { type?: unknown }).type).toBeUndefined();
			expect(commits.map((event) => event.origin.type)).toEqual(["collaborator"]);
			harness.assertConverged();
		} finally {
			harness.destroy();
		}
	});

	it("COL1: deliver sends only the state-vector diff", () => {
		const harness = createPeerHarness(2, HELLO);
		try {
			typeAt(harness, 0, "!");
			const receiver = harness.peer(1).adapter;
			const applied: Uint8Array[] = [];
			const original = receiver.applyUpdate.bind(receiver);
			const spy = vi.spyOn(receiver, "applyUpdate").mockImplementation((doc, update) => {
				applied.push(update);
				original(doc, update);
			});
			harness.deliver(0, 1);
			harness.deliver(0, 1);
			spy.mockRestore();

			// The second delivery has nothing new and sends nothing.
			expect(applied).toHaveLength(1);
			expect(applied[0]!.byteLength).toBeLessThan(harness.encodeUpdate(0).byteLength);
			expect(visibleText(harness.peer(1).editor, "p1")).toBe("Hello!");
		} finally {
			harness.destroy();
		}
	});

	it("COL4: quiesce exchanges repairs until no state vector moves", () => {
		const harness = createPeerHarness(3, {
			blocks: [0, 1, 2].map((index) => ({
				id: `b-${index}`,
				type: "callout",
				content: `B${index}`,
				children: [],
			})),
		});
		try {
			for (const peer of harness.peers) {
				peer.editor.apply([
					{
						type: "move-block",
						blockId: `b-${peer.index}`,
						position: { parent: `b-${(peer.index + 1) % 3}`, index: 0 },
					},
				]);
			}
			harness.run("partial-normalize");
			const rounds = harness.quiesce();
			// Round 1 meets the cycle breaks (each peer re-homes the detached
			// block at the root end), round 2 meets Rule 9's removal of the
			// concurrent duplicates, round 3 is quiet.
			expect(rounds).toBeLessThanOrEqual(3);
			expect(rounds).toBeLessThan(MAX_QUIESCE_ROUNDS);
			harness.assertConverged();
			expect(hasParentCycle(harness.peer(0).editor)).toBe(false);
			assertStructuralInvariants(harness.peer(0));
			// A quiesced harness stays quiet.
			expect(harness.quiesce()).toBe(1);
		} finally {
			harness.destroy();
		}
	});

	it("COL4: quiesce throws when repairs do not settle", () => {
		const harness = createPeerHarness(2, HELLO);
		try {
			// Test-only stand-in for a non-idempotent normalization rule: every
			// pass writes again, so no exchange round is ever quiet.
			for (const peer of harness.peers) {
				const normalizeAll = peer.editor.normalizeAll.bind(peer.editor);
				peer.editor.normalizeAll = () => {
					normalizeAll();
					peer.editor.apply(
						[{ type: "splice-text", blockId: "p1", from: 0, to: 0, insert: peer.label }],
						{ origin: "user" },
					);
				};
			}
			typeAt(harness, 0, "!");
			let thrown: unknown;
			try {
				harness.quiesce();
			} catch (error) {
				thrown = error;
			}
			expect(thrown).toBeInstanceOf(PeerHarnessQuiesceError);
			expect((thrown as PeerHarnessQuiesceError).peers).toEqual(["a", "b"]);
			expect((thrown as Error).message).toMatch(/did not quiesce within 4 rounds.*a, b/);
		} finally {
			harness.destroy();
		}
	});

	it("COL4: createTwoPeerHarness keeps its contract over createPeerHarness", () => {
		const harness = createTwoPeerHarness({ ...HELLO, clientIdA: 7, clientIdB: 9 });
		try {
			expect(harness.peerA.id).toBe("a");
			expect(harness.peerB.id).toBe("b");
			expect(harness.peerA.editor.ydoc.clientID).toBe(7);
			expect(harness.peerB.editor.ydoc.clientID).toBe(9);

			const order: string[] = [];
			harness.peerA.editor.on("commit", (event: CommitEvent) => {
				if (event.source === "remote") order.push("a");
			});
			harness.peerB.editor.on("commit", (event: CommitEvent) => {
				if (event.source === "remote") order.push("b");
			});
			harness.peerA.editor.apply([{ type: "splice-text", blockId: "p1", from: 5, to: 5, insert: "A" }]);
			harness.peerB.editor.apply([{ type: "splice-text", blockId: "p1", from: 0, to: 0, insert: "B" }]);
			harness.exchange("b-then-a");
			expect(order).toEqual(["a", "b"]);
			harness.assertConverged();

			harness.peerA.editor.apply([{ type: "splice-text", blockId: "p1", from: 0, to: 0, insert: "x" }]);
			expect(() => harness.assertConverged()).toThrow(/Two-peer documents did not converge/);
		} finally {
			harness.destroy();
		}
	});

	it("COL1: syncAwareness relays every peer's local state to every other peer", () => {
		const harness = createPeerHarness(3, { ...HELLO, awareness: true });
		try {
			for (const peer of harness.peers) {
				peer.editor.internals.awareness!.setLocalState({ user: { id: peer.label } });
			}
			harness.syncAwareness();
			for (const peer of harness.peers) {
				const ids = [...peer.editor.internals.awareness!.getStates().values()]
					.map((state) => (state.user as { id: string }).id)
					.sort();
				expect(ids).toEqual(["a", "b", "c"]);
			}
		} finally {
			harness.destroy();
		}
	});

	it("createPeerHarness rejects a peer count or clientIds outside its bounds", () => {
		expect(() => createPeerHarness(PEER_HARNESS_MIN_PEERS - 1)).toThrow(RangeError);
		expect(() => createPeerHarness(PEER_HARNESS_MAX_PEERS + 1)).toThrow(RangeError);
		expect(() => createPeerHarness(3, { clientIds: [1, 1, 2] })).toThrow(RangeError);
		expect(() => createPeerHarness(2, { seedUpdate: new Uint8Array(), blocks: [] })).toThrow(
			TypeError,
		);
		expect(PEER_SCHEDULES).toEqual([
			"ring",
			"reverse-ring",
			"star",
			"pairwise",
			"partial-normalize",
		]);
	});

	it("createPeerHarness forks from a provided seed update", () => {
		const seedHarness = createPeerHarness(2, HELLO);
		const seedUpdate = seedHarness.encodeUpdate(0);
		seedHarness.destroy();
		const harness = createPeerHarness(4, { seedUpdate });
		try {
			for (const peer of harness.peers) {
				expect(visibleText(peer.editor, "p1")).toBe("Hello");
			}
		} finally {
			harness.destroy();
		}
	});
});
