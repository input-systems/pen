import type { DocumentOp, Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import {
	createPeerHarness,
	findStructuralViolations,
	type PeerHarness,
	type PeerHarnessOptions,
} from "../index";
import { mulberry32 } from "../seededRandom";

/**
 * COL4 property under per-commit normalization: random concurrent moves,
 * deletes, inserts, and indents across two to five peers, delivered in a
 * seeded partial order, where the only normalization is the pass each
 * peer's own `apply` runs — never `normalizeAll`. After every peer keeps
 * committing and syncing, all peers converge with no cycle, duplicate,
 * dangling, orphan, or cross-array entry, and every live block is reachable.
 * Honours PEN_FUZZ_NIGHTLY (2,000 cases, else 60), PEN_FUZZ_SEED and
 * PEN_FUZZ_OP_COUNT (cases per peer count).
 */

const NIGHTLY = Boolean(process.env.PEN_FUZZ_NIGHTLY);
const SEED = parseSeed(process.env.PEN_FUZZ_SEED);
const CASES = resolveCaseCount();
const PEER_COUNTS = [2, 3, 4, 5] as const;
const ROUNDS = 3;
const DELIVERIES_PER_ROUND = 6;
/** Settle rounds: each is a full sync followed by one local commit per peer. */
const MAX_SETTLE_ROUNDS = 6;

const CONTAINERS = ["c1", "c2", "c3"] as const;
const LEAVES = ["p1", "p2", "l1", "l2", "l3"] as const;
const LIST_ITEMS = ["l1", "l2", "l3"] as const;
const MOVABLE = [...CONTAINERS, ...LEAVES] as const;

function parseSeed(raw: string | undefined): number {
	const source = raw && raw.length > 0 ? raw : "20261004";
	const asNumber = Number(source);
	if (Number.isFinite(asNumber)) return asNumber >>> 0;
	let hash = 2166136261;
	for (let i = 0; i < source.length; i++) {
		hash ^= source.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function resolveCaseCount(): number {
	const override = Number(process.env.PEN_FUZZ_OP_COUNT);
	if (Number.isFinite(override) && override > 0) return Math.floor(override);
	return NIGHTLY ? 2_000 : 60;
}

function seedOptions(): PeerHarnessOptions {
	return {
		blocks: [
			// The anchor is never moved or deleted: settle rounds type into it.
			{ id: "anchor", type: "paragraph", content: "Anchor" },
			{ id: "p1", type: "paragraph", content: "One" },
			{ id: "p2", type: "paragraph", content: "Two" },
			{ id: "l1", type: "bulletListItem", content: "L1" },
			{ id: "l2", type: "bulletListItem", content: "L2" },
			{ id: "l3", type: "bulletListItem", content: "L3" },
			{ id: "c1", type: "callout", content: "C1", children: [] },
			{ id: "c2", type: "callout", content: "C2", children: [] },
			{ id: "c3", type: "callout", content: "C3", children: [] },
		],
	};
}

function pick<T>(random: () => number, items: readonly T[]): T {
	return items[Math.floor(random() * items.length)]!;
}

/** One random structural op; deletes only hit leaves, so no subtree is dropped with its parent. */
function randomOp(random: () => number, tag: string): DocumentOp {
	const roll = random();
	if (roll < 0.35) {
		return {
			type: "move-block",
			blockId: pick(random, MOVABLE),
			position: { parent: pick(random, CONTAINERS), index: 0 },
		};
	}
	if (roll < 0.5) {
		return {
			type: "move-block",
			blockId: pick(random, MOVABLE),
			position: random() < 0.5 ? "first" : "last",
		};
	}
	if (roll < 0.7) {
		const blockId = pick(random, LIST_ITEMS);
		const parent = pick(random, LIST_ITEMS);
		return {
			type: "set-props",
			blockId,
			props: { parentId: random() < 0.7 ? parent : null },
		};
	}
	if (roll < 0.85) {
		return { type: "delete-block", blockId: pick(random, LEAVES) };
	}
	return {
		type: "insert-block",
		blockId: `n-${tag}`,
		blockType: "paragraph",
		props: {},
		position: random() < 0.5 ? { parent: pick(random, CONTAINERS), index: 0 } : "last",
	};
}

function typeIntoAnchor(editor: Editor): void {
	editor.apply([
		{ type: "splice-text", blockId: "anchor", from: 0, to: 0, insert: "." },
	]);
}

function unreachableLiveBlocks(editor: Editor): string[] {
	const reachable = new Set(editor.documentState.preorderBlockIds());
	return [...editor.document.blocks.keys()].filter((id) => !reachable.has(id));
}

function settled(harness: PeerHarness): boolean {
	return harness.peers.every(
		(peer) =>
			findStructuralViolations(peer.editor).length === 0 &&
			unreachableLiveBlocks(peer.editor).length === 0,
	);
}

function runCase(peers: number, caseSeed: number): void {
	const random = mulberry32(caseSeed);
	const harness = createPeerHarness(peers, seedOptions());
	try {
		for (let round = 0; round < ROUNDS; round++) {
			for (let index = 0; index < peers; index++) {
				harness.peer(index).editor.apply([randomOp(random, `${round}-${index}`)]);
			}
			for (let step = 0; step < DELIVERIES_PER_ROUND; step++) {
				const from = Math.floor(random() * peers);
				const to = (from + 1 + Math.floor(random() * (peers - 1))) % peers;
				harness.deliver(from, to);
				// The receiver keeps working: its next commit is the only pass.
				if (random() < 0.5) {
					harness.peer(to).editor.apply([randomOp(random, `${round}-${step}-r`)]);
				}
			}
		}

		let rounds = 0;
		do {
			harness.syncAll();
			if (settled(harness)) break;
			for (const peer of harness.peers) typeIntoAnchor(peer.editor);
			rounds += 1;
		} while (rounds < MAX_SETTLE_ROUNDS);
		harness.syncAll();

		harness.assertConverged();
		for (const peer of harness.peers) {
			expect(findStructuralViolations(peer.editor), `peer ${peer.label}`).toEqual([]);
			expect(unreachableLiveBlocks(peer.editor), `peer ${peer.label}`).toEqual([]);
		}
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`COL4 per-commit fuzz failed at case seed ${caseSeed} (${peers} peers)\n${reason}`, {
			cause: error,
		});
	} finally {
		harness.destroy();
	}
}

describe("COL4 per-commit normalization property", () => {
	for (const peers of PEER_COUNTS) {
		it(`COL4: random concurrent move, delete, and indent at ${peers} peers converge under per-commit normalization`, () => {
			for (let iteration = 0; iteration < CASES; iteration++) {
				runCase(peers, SEED + peers * 100_003 + iteration);
			}
		}, 1_800_000);
	}
});
