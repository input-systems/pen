import { initBlockMap, yjsAdapter } from "@input/pen-yjs";
import type { ChangeSummary, DiagnosticEvent, DocumentOp } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createEditor as createCoreEditor } from "../index";
import { createDefaultSchema } from "./fixtures/testSchema";

// W5.R3 / COL4 Rule 12. A concurrent move re-inserts the entry a concurrent
// delete removed; normalization removes an entry whose block map is gone.

const DANGLING_CODE = "dangling-block-reference";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

type SeedBlock = { id: string; type: string; text?: string; children?: string[] };

type Peer = {
	editor: ReturnType<typeof createCoreEditor>;
	ydoc: Y.Doc;
	diagnostics: DiagnosticEvent[];
};

function encodeSeed(order: readonly string[], blocks: readonly SeedBlock[]): Uint8Array {
	const ydoc = new Y.Doc({ gc: false });
	const blocksMap = ydoc.getMap<Y.Map<unknown>>("blocks");
	const blockOrder = ydoc.getArray<string>("blockOrder");
	ydoc.transact(() => {
		for (const block of blocks) {
			const blockMap = initBlockMap(
				blocksMap,
				block.id,
				block.type,
				block.children ? "nested" : "inline",
			);
			if (block.text) {
				(blockMap.get("content") as Y.Text).insert(0, block.text);
			}
			if (block.children) {
				(blockMap.get("children") as Y.Array<string>).push(block.children);
			}
		}
		blockOrder.push([...order]);
	});
	const update = Y.encodeStateAsUpdate(ydoc);
	ydoc.destroy();
	return update;
}

function forkPeers(count: number, seed: Uint8Array): Peer[] {
	const peers: Peer[] = [];
	for (let i = 0; i < count; i++) {
		const adapter = yjsAdapter({ gc: false });
		const document = adapter.loadDocument(seed);
		const ydoc = adapter.raw<Y.Doc>(document);
		(ydoc as unknown as { clientID: number }).clientID = i + 1;
		const editor = createCoreEditor({
			schema: createDefaultSchema(),
			crdt: adapter,
			document,
			preset: noDefaultExtensionsPreset,
		});
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		peers.push({ editor, ydoc, diagnostics });
	}
	return peers;
}

function syncAll(peers: readonly Peer[]): void {
	for (const from of peers) {
		for (const to of peers) {
			if (from === to) continue;
			const update = Y.encodeStateAsUpdate(from.ydoc, Y.encodeStateVector(to.ydoc));
			to.editor.internals.adapter.applyUpdate(to.editor.internals.crdtDoc, update);
		}
	}
}

function readIds(array: Y.Array<string>): string[] {
	return array.toArray();
}

function blockOrderIds(peer: Peer): string[] {
	return readIds(peer.ydoc.getArray<string>("blockOrder"));
}

function childrenIds(peer: Peer, parentId: string): string[] {
	const parent = peer.ydoc.getMap<Y.Map<unknown>>("blocks").get(parentId);
	return readIds(parent!.get("children") as Y.Array<string>);
}

function danglingDiagnostics(peer: Peer): DiagnosticEvent[] {
	return peer.diagnostics.filter((event) => event.code === DANGLING_CODE);
}

function destroyAll(peers: readonly Peer[]): void {
	for (const peer of peers) {
		peer.editor.destroy();
	}
}

const FLAT_SEED = encodeSeed(
	["p1", "p2", "p3"],
	[
		{ id: "p1", type: "paragraph", text: "One" },
		{ id: "p2", type: "paragraph", text: "Two" },
		{ id: "p3", type: "paragraph", text: "Three" },
	],
);

const moveP2 = (position: "first" | "last"): DocumentOp[] => [
	{ type: "move-block", blockId: "p2", position },
];

describe("COL4 dangling structural entries (Rule 12)", () => {
	it("COL4: normalizeAll removes block-order entries whose block map is absent", () => {
		const peers = forkPeers(2, FLAT_SEED);
		const [a, b] = peers as [Peer, Peer];
		try {
			a.editor.apply([{ type: "delete-block", blockId: "p2" }]);
			b.editor.apply(moveP2("first"));
			syncAll(peers);

			// Remote commits do not normalize: the dangling entry arrives intact.
			expect(blockOrderIds(a)).toEqual(["p2", "p1", "p3"]);

			a.editor.normalizeAll();
			expect(blockOrderIds(a)).toEqual(["p1", "p3"]);
			expect(danglingDiagnostics(a)).toHaveLength(1);
			expect(danglingDiagnostics(a)[0]).toMatchObject({
				code: DANGLING_CODE,
				level: "warn",
				source: "schema",
			});
			expect(danglingDiagnostics(a)[0]!.message).toContain('"p2"');
			expect(danglingDiagnostics(a)[0]!.message).toContain("blockOrder");

			syncAll(peers);
			expect(blockOrderIds(b)).toEqual(["p1", "p3"]);
		} finally {
			destroyAll(peers);
		}
	});

	it("COL4: a remote delete that leaves the mover's entry is reported block-removed", () => {
		const peers = forkPeers(2, FLAT_SEED);
		const [a, b] = peers as [Peer, Peer];
		try {
			a.editor.apply([{ type: "delete-block", blockId: "p2" }]);
			b.editor.apply(moveP2("first"));
			const summaries: ChangeSummary[] = [];
			const off = b.editor.on("commit", (event) => summaries.push(event.summary));
			const update = Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc));
			b.editor.internals.adapter.applyUpdate(b.editor.internals.crdtDoc, update);
			off();

			// The order entry b's move wrote survives; the block is gone all the same.
			expect(blockOrderIds(b)).toEqual(["p2", "p1", "p3"]);
			expect(summaries).toHaveLength(1);
			expect(
				summaries[0]!.structural.filter((change) => change.type.startsWith("block")),
			).toEqual([
				{ type: "block-removed", blockId: "p2", parentId: null, index: 0 },
			]);
			expect(summaries[0]!.affectedBlockIds).toEqual(["p2"]);
		} finally {
			destroyAll(peers);
		}
	});

	it("COL4: dangling-entry repair is idempotent across peers", () => {
		const peers = forkPeers(3, FLAT_SEED);
		const [a, b, c] = peers as [Peer, Peer, Peer];
		try {
			a.editor.apply([{ type: "delete-block", blockId: "p2" }]);
			b.editor.apply(moveP2("first"));
			c.editor.apply(moveP2("last"));
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
		} finally {
			destroyAll(peers);
		}
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
		const peers = forkPeers(2, seed);
		const [a, b] = peers as [Peer, Peer];
		try {
			a.editor.apply([{ type: "delete-block", blockId: "k2" }]);
			b.editor.apply([
				{
					type: "move-block",
					blockId: "k2",
					position: { parent: "c1", index: 0 },
				},
			]);
			syncAll(peers);
			expect(childrenIds(a, "c1")).toEqual(["k2", "k1", "k3"]);

			a.editor.normalizeAll();
			expect(childrenIds(a, "c1")).toEqual(["k1", "k3"]);
			expect(danglingDiagnostics(a)).toHaveLength(1);
			expect(danglingDiagnostics(a)[0]!.message).toContain('children of "c1"');

			syncAll(peers);
			expect(childrenIds(b, "c1")).toEqual(["k1", "k3"]);
		} finally {
			destroyAll(peers);
		}
	});

	it("COL4: a local structural apply removes a dangling entry without normalizeAll", () => {
		const peers = forkPeers(2, FLAT_SEED);
		const [a, b] = peers as [Peer, Peer];
		try {
			a.editor.apply([{ type: "delete-block", blockId: "p2" }]);
			b.editor.apply(moveP2("first"));
			syncAll(peers);
			expect(blockOrderIds(b)).toEqual(["p2", "p1", "p3"]);

			b.editor.apply([{ type: "move-block", blockId: "p3", position: "first" }]);
			expect(blockOrderIds(b)).toEqual(["p3", "p1"]);
			expect(danglingDiagnostics(b)).toHaveLength(1);
		} finally {
			destroyAll(peers);
		}
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
		const peers = forkPeers(2, CONTAINER_SEED);
		const [a, b] = peers as [Peer, Peer];
		try {
			a.editor.apply([{ type: "move-block", blockId: "mover", position: { parent: "c2", index: 0 } }]);
			b.editor.apply([{ type: "move-block", blockId: "mover", position: { parent: "c1", index: 0 } }]);
			syncAll(peers);
			expect(childrenIds(a, "c1")).toEqual(["mover"]);
			expect(childrenIds(a, "c2")).toEqual(["mover"]);

			for (const peer of peers) peer.editor.normalizeAll();
			syncAll(peers);
			for (const peer of peers) {
				expect(childrenIds(peer, "c1")).toEqual(["mover"]);
				expect(childrenIds(peer, "c2")).toEqual([]);
				expect(blockOrderIds(peer)).toEqual(["c1", "c2"]);
			}
		} finally {
			destroyAll(peers);
		}
	});

	it("COL4: concurrent moves into one parent leave one children entry", () => {
		const peers = forkPeers(2, CONTAINER_SEED);
		const [a, b] = peers as [Peer, Peer];
		try {
			for (const peer of [a, b]) {
				peer.editor.apply([{ type: "move-block", blockId: "mover", position: { parent: "c1", index: 0 } }]);
			}
			syncAll(peers);
			expect(childrenIds(a, "c1")).toEqual(["mover", "mover"]);

			a.editor.normalizeAll();
			syncAll(peers);
			for (const peer of peers) {
				expect(childrenIds(peer, "c1")).toEqual(["mover"]);
			}
		} finally {
			destroyAll(peers);
		}
	});

	it("COL4: breaking a children-array cycle re-homes the detached block at the end of the root order", () => {
		const seed = encodeSeed(
			["x1", "x2"],
			[
				{ id: "x1", type: "callout", children: [] },
				{ id: "x2", type: "callout", children: [] },
			],
		);
		const peers = forkPeers(2, seed);
		const [a, b] = peers as [Peer, Peer];
		try {
			a.editor.apply([{ type: "move-block", blockId: "x1", position: { parent: "x2", index: 0 } }]);
			b.editor.apply([{ type: "move-block", blockId: "x2", position: { parent: "x1", index: 0 } }]);
			syncAll(peers);
			expect(blockOrderIds(a)).toEqual([]);

			for (const peer of peers) peer.editor.normalizeAll();
			syncAll(peers);
			for (const peer of peers) peer.editor.normalizeAll();
			syncAll(peers);
			for (const peer of peers) {
				// The edge owned by "x1" (x1's children entry for x2) is cleared,
				// so x2 is detached and re-homed; x1 stays under it.
				expect(blockOrderIds(peer)).toEqual(["x2"]);
				expect(childrenIds(peer, "x2")).toEqual(["x1"]);
				expect(childrenIds(peer, "x1")).toEqual([]);
				expect(peer.diagnostics.some((event) => event.code === "parent-cycle")).toBe(true);
			}
		} finally {
			destroyAll(peers);
		}
	});
});
