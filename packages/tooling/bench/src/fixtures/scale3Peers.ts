import { multiplayerExtension } from "@input/pen-multiplayer";
import {
	createPeerHarness,
	type PeerHarness,
	type PeerIndex,
} from "@input/pen-test";
import type { CommitEvent } from "@input/pen-types";
import * as Y from "yjs";
import { LOCAL_PRESENCE_SETTLE_MS } from "../constants/scale3";
import { createScale3YDoc, scale3KeystrokeTarget } from "./scale3Stack";

/**
 * SCALE3 synced-peer axis (W5.R9): `peers` real forked `Y.Doc`s at the
 * 1,000-block point, each with the real `multiplayerExtension`, so a
 * keystroke pays for resolving the remote carets it shifts and fans out to
 * every other peer.
 */

const SCALE3_PEER_BLOCK_COUNT = 1000;
const REMOTE_CURSOR_MARKER = "data-pen-multiplayer-cursor";

/** What one keystroke on the typist produced. Every field is a count, gated by `baselines/scale3-peers.json`. */
export interface Scale3PeerKeystrokeCounts {
	/** Deliveries that carried an update: expected n − 1. */
	readonly updatesDelivered: number;
	/** Commits on the receivers: expected n − 1 (I1: one per receiver). */
	readonly remoteCommits: number;
	/** Most blocks a remote commit named: expected 1 (SCALE2 on the remote path). */
	readonly maxAffectedBlocksPerRemoteCommit: number;
	/** Remote-cursor decorations on the typist: expected n − 1. */
	readonly remoteCaretsOnTypist: number;
	/** Peers holding the keystroke's token: expected n. */
	readonly peersObservingKeystroke: number;
}

export interface Scale3PeerSession {
	readonly harness: PeerHarness;
	readonly typist: PeerIndex;
	readonly targetBlockId: string;
	/** The typist's apply only: the clock that pays for remote-caret resolution. */
	type(): string;
	/**
	 * Delivers the typist's update to every other peer. `skip` drops the
	 * delivery to those peers, which the fault-injected test uses.
	 */
	fanOut(options?: { readonly skip?: ReadonlySet<PeerIndex> }): number;
	/** One keystroke: `type()`, then `fanOut()`, counted. */
	keystroke(options?: { readonly skip?: ReadonlySet<PeerIndex> }): Scale3PeerKeystrokeCounts;
	destroy(): void;
}

function remoteCursorCount(harness: PeerHarness, index: PeerIndex): number {
	const editor = harness.peer(index).editor;
	editor.requestDecorationUpdate();
	return editor
		.getDecorations()
		.decorations.filter(
			(decoration) =>
				decoration.type === "inline" &&
				decoration.attributes[REMOTE_CURSOR_MARKER] !== undefined,
		).length;
}

/**
 * Builds the session and settles presence before any clock: each peer's
 * caret sits in its own block (`block-500 + i`, offset 0) so no caret is
 * inside the text the keystroke shifts, and every peer must see n − 1
 * remote cursors or this throws. Async because local presence publishes at
 * most once per `LOCAL_PRESENCE_MIN_INTERVAL_MS`, and the activation write
 * opens that interval; setup is outside every clock.
 */
export async function createScale3PeerSession(
	peers: number,
): Promise<Scale3PeerSession> {
	const harness = createPeerHarness(peers, {
		seedUpdate: Y.encodeStateAsUpdate(createScale3YDoc(SCALE3_PEER_BLOCK_COUNT)),
		awareness: true,
		extensionsFor: (index) => [
			multiplayerExtension({
				user: { id: `peer-${index}`, name: `Peer ${index}` },
			}),
		],
	});
	const typist = 0 as PeerIndex;
	const targetBlockId = scale3KeystrokeTarget(SCALE3_PEER_BLOCK_COUNT);
	const base = Number(targetBlockId.slice("block-".length));
	for (const peer of harness.peers) {
		peer.editor.selectText(`block-${base + peer.index}`, 0, 0);
	}
	await new Promise((resolve) => setTimeout(resolve, LOCAL_PRESENCE_SETTLE_MS));
	harness.syncAwareness();
	for (const peer of harness.peers) {
		const seen = remoteCursorCount(harness, peer.index);
		if (seen !== peers - 1) {
			harness.destroy();
			throw new Error(
				`SCALE3 synced peers: peer ${peer.label} sees ${seen} remote cursors before the clock, expected ${peers - 1}`,
			);
		}
	}

	let keystrokes = 0;
	const type = (): string => {
		const token = `k${keystrokes++}`;
		const editor = harness.peer(typist).editor;
		const at = editor.getBlock(targetBlockId)?.length() ?? 0;
		editor.apply(
			[{ type: "splice-text", blockId: targetBlockId, from: at, to: at, insert: token }],
			{ origin: "user" },
		);
		return token;
	};
	const fanOut = (options?: { readonly skip?: ReadonlySet<PeerIndex> }): number => {
		let delivered = 0;
		for (const peer of harness.peers) {
			if (peer.index === typist || options?.skip?.has(peer.index)) continue;
			const update = harness.encodeUpdate(typist, harness.stateVector(peer.index));
			if (update.length <= 2) continue;
			harness.deliver(typist, peer.index);
			delivered += 1;
		}
		return delivered;
	};

	return {
		harness,
		typist,
		targetBlockId,
		type,
		fanOut,
		keystroke(options) {
			const remote: CommitEvent[] = [];
			const unsubscribers = harness.peers
				.filter((peer) => peer.index !== typist)
				.map((peer) => peer.editor.on("commit", (event) => remote.push(event)));
			try {
				const token = type();
				const updatesDelivered = fanOut(options);
				return {
					updatesDelivered,
					remoteCommits: remote.length,
					maxAffectedBlocksPerRemoteCommit: Math.max(
						0,
						...remote.map((event) => event.summary.affectedBlockIds.length),
					),
					remoteCaretsOnTypist: remoteCursorCount(harness, typist),
					peersObservingKeystroke: harness.peers.filter((peer) =>
						(peer.editor.getBlock(targetBlockId)?.textContent() ?? "").includes(token),
					).length,
				};
			} finally {
				for (const unsubscribe of unsubscribers) unsubscribe();
			}
		},
		destroy() {
			harness.destroy();
		},
	};
}
