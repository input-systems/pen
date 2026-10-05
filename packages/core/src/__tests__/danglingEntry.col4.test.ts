import { initBlockMap, yjsAdapter } from "@input/pen-yjs";
import type { ChangeSummary, DiagnosticEvent, DocumentOp } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createBlockIndexSnapshotFromDocument } from "../changes/fromDocument";
import { replaceRangeOps } from "../commands/helpers";
import { createEditor } from "./editorCore.testHelpers";

// W5.R3 / COL4 Rule 12. A concurrent move re-inserts the entry a concurrent
// delete removed; normalization removes an entry whose block map is gone.

const DANGLING_CODE = "dangling-block-reference";

type SeedBlock = { id: string; type: string; text?: string; children?: string[] };

type Peer = {
	editor: ReturnType<typeof createEditor>;
	ydoc: Y.Doc;
	diagnostics: DiagnosticEvent[];
};

function encodeSeed(order: readonly string[], blocks: readonly SeedBlock[]): Uint8Array {
	const ydoc = new Y.Doc({ gc: false });
	const blocksMap = ydoc.getMap<Y.Map<unknown>>("blocks");
	ydoc.transact(() => {
		for (const block of blocks) {
			const blockMap = initBlockMap(
				blocksMap,
				block.id,
				block.type,
				block.children ? "nested" : "inline",
			);
			if (block.text) (blockMap.get("content") as Y.Text).insert(0, block.text);
			if (block.children) (blockMap.get("children") as Y.Array<string>).push(block.children);
		}
		ydoc.getArray<string>("blockOrder").push([...order]);
	});
	const update = Y.encodeStateAsUpdate(ydoc);
	ydoc.destroy();
	return update;
}

/** A root order of paragraphs whose text is their id. */
function paragraphSeed(...ids: string[]): Uint8Array {
	return encodeSeed(ids, ids.map((id) => ({ id, type: "paragraph", text: id })));
}

/** Forks `count` editors from `seed`, runs `run`, and destroys them. */
function withPeers(count: number, seed: Uint8Array, run: (peers: Peer[]) => void): void {
	const peers = Array.from({ length: count }, (_, i): Peer => {
		const adapter = yjsAdapter({ gc: false });
		const document = adapter.loadDocument(seed);
		const ydoc = adapter.raw<Y.Doc>(document);
		(ydoc as unknown as { clientID: number }).clientID = i + 1;
		const editor = createEditor({ crdt: adapter, document });
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		return { editor, ydoc, diagnostics };
	});
	try {
		run(peers);
	} finally {
		for (const peer of peers) peer.editor.destroy();
	}
}

function deliver(from: Peer, to: Peer): void {
	const update = Y.encodeStateAsUpdate(from.ydoc, Y.encodeStateVector(to.ydoc));
	to.editor.internals.adapter.applyUpdate(to.editor.internals.crdtDoc, update);
}

/** Delivers `from`'s update to `to` and returns the commit summaries it raised. */
function deliverSummaries(from: Peer, to: Peer): ChangeSummary[] {
	const summaries: ChangeSummary[] = [];
	const off = to.editor.on("commit", (event) => summaries.push(event.summary));
	deliver(from, to);
	off();
	return summaries;
}

function syncAll(peers: readonly Peer[]): void {
	for (const from of peers) {
		for (const to of peers) {
			if (from !== to) deliver(from, to);
		}
	}
}

function normalizeAll(peers: readonly Peer[]): void {
	for (const peer of peers) peer.editor.normalizeAll();
}

function blockOrderIds(peer: Peer): string[] {
	return peer.ydoc.getArray<string>("blockOrder").toArray();
}

function childrenIds(peer: Peer, parentId: string): string[] {
	const parent = peer.ydoc.getMap<Y.Map<unknown>>("blocks").get(parentId);
	return (parent!.get("children") as Y.Array<string>).toArray();
}

function danglingDiagnostics(peer: Peer): DiagnosticEvent[] {
	return peer.diagnostics.filter((event) => event.code === DANGLING_CODE);
}

const move = (blockId: string, position: unknown): DocumentOp[] => [
	{ type: "move-block", blockId, position } as DocumentOp,
];
const remove = (blockId: string): DocumentOp[] => [{ type: "delete-block", blockId }];
const splice = (blockId: string, insert: string): DocumentOp[] => [
	{ type: "splice-text", blockId, from: 0, to: 0, insert },
];

const FLAT_SEED = paragraphSeed("p1", "p2", "p3");

/** `a` deletes p2 while `b` moves it first: the classic dangling entry. */
function deleteVersusMove([a, b]: Peer[]): void {
	a!.editor.apply(remove("p2"));
	b!.editor.apply(move("p2", "first"));
}

describe("COL4 dangling structural entries (Rule 12)", () => {
	it("COL4: normalizeAll removes block-order entries whose block map is absent", () => {
		withPeers(2, FLAT_SEED, (peers) => {
			const [a, b] = peers as [Peer, Peer];
			deleteVersusMove(peers);
			syncAll(peers);

			// Remote commits do not normalize: the dangling entry arrives intact.
			expect(blockOrderIds(a)).toEqual(["p2", "p1", "p3"]);

			a.editor.normalizeAll();
			expect(blockOrderIds(a)).toEqual(["p1", "p3"]);
			expect(danglingDiagnostics(a)).toEqual([
				expect.objectContaining({ code: DANGLING_CODE, level: "warn", source: "schema" }),
			]);
			expect(danglingDiagnostics(a)[0]!.message).toContain('"p2"');
			expect(danglingDiagnostics(a)[0]!.message).toContain("blockOrder");

			syncAll(peers);
			expect(blockOrderIds(b)).toEqual(["p1", "p3"]);
		});
	});

	it("COL4: a remote delete that leaves the mover's entry is reported block-removed", () => {
		withPeers(2, FLAT_SEED, (peers) => {
			const [a, b] = peers as [Peer, Peer];
			deleteVersusMove(peers);
			const summaries = deliverSummaries(a, b);

			// The order entry b's move wrote survives; the block is gone all the same.
			expect(blockOrderIds(b)).toEqual(["p2", "p1", "p3"]);
			expect(summaries).toHaveLength(1);
			expect(
				summaries[0]!.structural.filter((change) => change.type.startsWith("block")),
			).toEqual([{ type: "block-removed", blockId: "p2", parentId: null, index: 0 }]);
			expect(summaries[0]!.affectedBlockIds).toEqual(["p2"]);
		});
	});

	it("COL4: a remote delete that leaves the mover's entry drops the block from a cached preorder", () => {
		withPeers(2, FLAT_SEED, (peers) => {
			const [a, b] = peers as [Peer, Peer];
			deleteVersusMove(peers);
			const state = b.editor.documentState;
			expect(state.preorderBlockIds()).toEqual(["p2", "p1", "p3"]);
			const generation = state.generation;

			deliver(a, b);

			// The entry survives in storage; the preorder skips it, as a fresh build does.
			expect(blockOrderIds(b)).toEqual(["p2", "p1", "p3"]);
			expect(state.preorderBlockIds()).toEqual(["p1", "p3"]);
			expect(state.preorderIndexOf("p2")).toBe(-1);
			expect(state.generation).toBeGreaterThan(generation);
		});
	});

	it("COL4: a local pass that swaps a dangling root entry for a re-homed orphan updates the document index", () => {
		const seed = encodeSeed(
			["p1", "p2", "p3", "t"],
			[
				{ id: "p1", type: "paragraph", text: "One" },
				{ id: "p2", type: "paragraph", text: "Two" },
				{ id: "p3", type: "paragraph", text: "Three" },
				{ id: "t", type: "toggle", children: [] },
			],
		);
		withPeers(2, seed, (peers) => {
			const [a, b] = peers as [Peer, Peer];
			a.editor.apply(remove("p2"));
			a.editor.apply(remove("t"));
			b.editor.apply(move("p2", "last"));
			b.editor.apply(move("p1", { parent: "t", index: 0 }));
			syncAll(peers);
			// b: `p2` is a dangling root entry, `p1` an orphan in a deleted
			// toggle; `p3`, the block the next op writes, keeps its position.
			expect(blockOrderIds(b)).toEqual(["p3", "p2"]);

			// The pass inside any local apply repairs both, keeping the length.
			b.editor.apply(splice("p3", "x"));

			expect(blockOrderIds(b)).toEqual(["p3", "p1"]);
			expect(b.editor.documentState.blockOrder).toEqual(["p3", "p1"]);
			expect(b.editor.documentState.preorderBlockIds()).toEqual(["p3", "p1"]);
		});
	});

	it("COL4: a block map arriving under a deleted parent reshapes the change-summary index", () => {
		const seed = encodeSeed(
			["p1", "t"],
			[
				{ id: "p1", type: "paragraph", text: "One" },
				{ id: "t", type: "toggle", children: [] },
			],
		);
		withPeers(2, seed, (peers) => {
			const [a, b] = peers as [Peer, Peer];
			// Both peers write once first, so the concurrent commit carries no
			// first-write metadata of its own.
			a.editor.apply(splice("p1", "a"));
			b.editor.apply(splice("p1", "b"));
			syncAll(peers);
			a.editor.apply([
				{
					type: "insert-block",
					blockId: "c",
					blockType: "paragraph",
					props: {},
					position: { parent: "t", index: 0 },
				},
			]);
			b.editor.apply(remove("t"));
			const summaries = deliverSummaries(a, b);

			// `c`'s map lands; its entry went into an array b already deleted.
			expect(b.ydoc.getMap("blocks").has("c")).toBe(true);
			expect(summaries.flatMap((summary) => summary.structural)).toEqual([]);
			const index = (
				b.editor as unknown as { _blockIndex: { snapshot(): unknown } }
			)._blockIndex.snapshot();
			expect(index).toEqual(createBlockIndexSnapshotFromDocument(b.editor.internals.doc));
		});
	});

	it("COL4: dangling-entry repair is idempotent across peers", () => {
		withPeers(3, FLAT_SEED, (peers) => {
			const [a, , c] = peers as [Peer, Peer, Peer];
			deleteVersusMove(peers);
			c.editor.apply(move("p2", "last"));
			syncAll(peers);
			expect(blockOrderIds(a)).toEqual(["p2", "p1", "p3", "p2"]);

			// Every peer repairs the same state before any repair is exchanged.
			for (const peer of peers) {
				peer.editor.normalizeAll();
				expect(blockOrderIds(peer)).toEqual(["p1", "p3"]);
				// One diagnostic per removed id per pass, however many entries it had.
				expect(danglingDiagnostics(peer)).toHaveLength(1);
			}

			syncAll(peers);
			for (const peer of peers) {
				expect(blockOrderIds(peer)).toEqual(["p1", "p3"]);
				peer.diagnostics.length = 0;
				peer.editor.normalizeAll();
				expect(blockOrderIds(peer)).toEqual(["p1", "p3"]);
				expect(danglingDiagnostics(peer)).toEqual([]);
			}
		});
	});

	it("COL4: a children entry naming a deleted block is removed", () => {
		const seed = encodeSeed(
			["c1"],
			[
				{ id: "c1", type: "callout", children: ["k1", "k2", "k3"] },
				{ id: "k1", type: "paragraph", text: "One" },
				{ id: "k2", type: "paragraph", text: "Two" },
				{ id: "k3", type: "paragraph", text: "Three" },
			],
		);
		withPeers(2, seed, (peers) => {
			const [a, b] = peers as [Peer, Peer];
			a.editor.apply(remove("k2"));
			b.editor.apply(move("k2", { parent: "c1", index: 0 }));
			syncAll(peers);
			expect(childrenIds(a, "c1")).toEqual(["k2", "k1", "k3"]);

			a.editor.normalizeAll();
			expect(childrenIds(a, "c1")).toEqual(["k1", "k3"]);
			expect(danglingDiagnostics(a)).toHaveLength(1);
			expect(danglingDiagnostics(a)[0]!.message).toContain('children of "c1"');

			syncAll(peers);
			expect(childrenIds(b, "c1")).toEqual(["k1", "k3"]);
		});
	});

	it("COL4: a local structural apply removes a dangling entry without normalizeAll", () => {
		withPeers(2, FLAT_SEED, (peers) => {
			const b = peers[1]!;
			deleteVersusMove(peers);
			syncAll(peers);
			expect(blockOrderIds(b)).toEqual(["p2", "p1", "p3"]);

			b.editor.apply(move("p3", "first"));
			expect(blockOrderIds(b)).toEqual(["p3", "p1"]);
			expect(danglingDiagnostics(b)).toHaveLength(1);
		});
	});

	it("COL4: a range op across a dangling entry deletes only live blocks", () => {
		withPeers(2, paragraphSeed("p1", "p2", "p3", "p4"), (peers) => {
			const [a, b] = peers as [Peer, Peer];
			a.editor.apply(remove("p2"));
			b.editor.apply(move("p2", { after: "p3" }));
			syncAll(peers);
			expect(blockOrderIds(b)).toEqual(["p1", "p3", "p2", "p4"]);

			const replacement = replaceRangeOps(
				b.editor,
				{
					type: "text",
					anchor: { blockId: "p1", offset: 1 },
					focus: { blockId: "p4", offset: 1 },
				},
				"",
			);
			const deleted = (replacement?.ops ?? [])
				.filter((op) => op.type === "delete-block")
				.map((op) => (op as { blockId: string }).blockId);
			expect(deleted).toEqual(["p3", "p4"]);
		});
	});
});

describe("COL4 children-array repairs", () => {
	const CONTAINER_SEED = encodeSeed(
		["c1", "c2", "mover"],
		[
			{ id: "c1", type: "callout", children: [] },
			{ id: "c2", type: "callout", children: [] },
			{ id: "mover", type: "paragraph", text: "Move me" },
		],
	);

	it("COL4: a block moved under two parents stays under the parent whose id sorts lowest", () => {
		withPeers(2, CONTAINER_SEED, (peers) => {
			const [a, b] = peers as [Peer, Peer];
			a.editor.apply(move("mover", { parent: "c2", index: 0 }));
			b.editor.apply(move("mover", { parent: "c1", index: 0 }));
			syncAll(peers);
			expect(childrenIds(a, "c1")).toEqual(["mover"]);
			expect(childrenIds(a, "c2")).toEqual(["mover"]);

			normalizeAll(peers);
			syncAll(peers);
			for (const peer of peers) {
				expect(childrenIds(peer, "c1")).toEqual(["mover"]);
				expect(childrenIds(peer, "c2")).toEqual([]);
				expect(blockOrderIds(peer)).toEqual(["c1", "c2"]);
			}
		});
	});

	it("COL4: concurrent moves into one parent leave one children entry", () => {
		withPeers(2, CONTAINER_SEED, (peers) => {
			for (const peer of peers) peer.editor.apply(move("mover", { parent: "c1", index: 0 }));
			syncAll(peers);
			expect(childrenIds(peers[0]!, "c1")).toEqual(["mover", "mover"]);

			peers[0]!.editor.normalizeAll();
			syncAll(peers);
			for (const peer of peers) expect(childrenIds(peer, "c1")).toEqual(["mover"]);
		});
	});

	it("COL4: breaking a children-array cycle re-homes the detached block at the end of the root order", () => {
		const seed = encodeSeed(
			["x1", "x2"],
			[
				{ id: "x1", type: "callout", children: [] },
				{ id: "x2", type: "callout", children: [] },
			],
		);
		withPeers(2, seed, (peers) => {
			const [a, b] = peers as [Peer, Peer];
			a.editor.apply(move("x1", { parent: "x2", index: 0 }));
			b.editor.apply(move("x2", { parent: "x1", index: 0 }));
			syncAll(peers);
			expect(blockOrderIds(a)).toEqual([]);

			normalizeAll(peers);
			syncAll(peers);
			normalizeAll(peers);
			syncAll(peers);
			for (const peer of peers) {
				// The edge owned by "x1" (x1's children entry for x2) is cleared,
				// so x2 is detached and re-homed; x1 stays under it.
				expect(blockOrderIds(peer)).toEqual(["x2"]);
				expect(childrenIds(peer, "x2")).toEqual(["x1"]);
				expect(childrenIds(peer, "x1")).toEqual([]);
				expect(peer.diagnostics.some((event) => event.code === "parent-cycle")).toBe(true);
			}
		});
	});
});
