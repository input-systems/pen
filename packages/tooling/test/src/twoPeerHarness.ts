import { deepEqual } from "@input/pen-core";
import { createPeerHarness } from "./peerHarness";
import type {
	NormalizedYDocSnapshot,
	Peer,
	PeerIndex,
	TwoPeer,
	TwoPeerHarness,
	TwoPeerHarnessOptions,
	TwoPeerId,
	TwoPeerInterleaving,
} from "./types";

export const TWO_PEER_INTERLEAVINGS = [
	"a-then-b",
	"b-then-a",
] as const satisfies readonly TwoPeerInterleaving[];

const DEFAULT_CLIENT_ID_A = 1;
const DEFAULT_CLIENT_ID_B = 2;
const TWO_PEER_IDS: readonly TwoPeerId[] = ["a", "b"];

export function createTwoPeerHarness(
	options: TwoPeerHarnessOptions = {},
): TwoPeerHarness {
	const {
		clientIdA = DEFAULT_CLIENT_ID_A,
		clientIdB = DEFAULT_CLIENT_ID_B,
		extensionsFor,
		...seedOptions
	} = options;

	const harness = createPeerHarness(2, {
		...seedOptions,
		clientIds: [clientIdA, clientIdB],
		...(extensionsFor
			? {
					extensionsFor: (index: PeerIndex) =>
						extensionsFor(TWO_PEER_IDS[index]!),
				}
			: {}),
	});
	const peerA = asTwoPeer("a", harness.peer(0));
	const peerB = asTwoPeer("b", harness.peer(1));

	const peers: Record<TwoPeerId, TwoPeer> = { a: peerA, b: peerB };

	const peer = (id: TwoPeerId): TwoPeer => {
		switch (id) {
			case "a":
			case "b":
				return peers[id];
			default: {
				const _never: never = id;
				throw new Error(`Unknown two-peer id: ${String(_never)}`);
			}
		}
	};

	const encodeUpdateFrom = (from: TwoPeerId): Uint8Array =>
		harness.encodeUpdate(
			peerIndex(from),
			harness.stateVector(peerIndex(otherPeer(from))),
		);

	const applyUpdateTo = (to: TwoPeerId, update: Uint8Array): void => {
		harness.applyUpdateTo(peerIndex(to), update);
	};

	const captureUpdates = (): { fromA: Uint8Array; fromB: Uint8Array } => ({
		fromA: encodeUpdateFrom("a"),
		fromB: encodeUpdateFrom("b"),
	});

	const exchange = (interleaving: TwoPeerInterleaving = "a-then-b"): void => {
		const { fromA, fromB } = captureUpdates();
		switch (interleaving) {
			case "a-then-b":
				applyUpdateTo("b", fromA);
				applyUpdateTo("a", fromB);
				break;
			case "b-then-a":
				applyUpdateTo("a", fromB);
				applyUpdateTo("b", fromA);
				break;
			default: {
				const _never: never = interleaving;
				throw new Error(`Unknown interleaving: ${String(_never)}`);
			}
		}
	};

	const snapshot = (id: TwoPeerId = "a"): NormalizedYDocSnapshot =>
		harness.snapshot(peerIndex(id));

	return {
		peerA,
		peerB,
		peer,
		encodeUpdateFrom,
		applyUpdateTo,
		captureUpdates,
		exchange,
		sync: exchange,
		normalizeAll() {
			peerA.editor.normalizeAll();
			peerB.editor.normalizeAll();
		},
		assertConverged(message) {
			const snapA = snapshot("a");
			const snapB = snapshot("b");
			if (deepEqual(snapA, snapB)) {
				return;
			}
			const detail = message ? `${message}\n` : "";
			throw new Error(
				`${detail}Two-peer documents did not converge.\nA: ${JSON.stringify(snapA)}\nB: ${JSON.stringify(snapB)}`,
			);
		},
		snapshot,
		destroy() {
			harness.destroy();
		},
	};
}

export function runBothInterleavings(
	options: TwoPeerHarnessOptions,
	apply: (harness: TwoPeerHarness, interleaving: TwoPeerInterleaving) => void,
	invariant?: (
		harness: TwoPeerHarness,
		interleaving: TwoPeerInterleaving,
	) => void,
): void {
	for (const interleaving of TWO_PEER_INTERLEAVINGS) {
		const harness = createTwoPeerHarness(options);
		try {
			apply(harness, interleaving);
			if (invariant) {
				harness.exchange(interleaving);
				harness.normalizeAll();
				harness.assertConverged();
				invariant(harness, interleaving);
			}
		} finally {
			harness.destroy();
		}
	}
}

function otherPeer(id: TwoPeerId): TwoPeerId {
	switch (id) {
		case "a":
			return "b";
		case "b":
			return "a";
		default: {
			const _never: never = id;
			throw new Error(`Unknown two-peer id: ${String(_never)}`);
		}
	}
}

function peerIndex(id: TwoPeerId): PeerIndex {
	switch (id) {
		case "a":
			return 0;
		case "b":
			return 1;
		default: {
			const _never: never = id;
			throw new Error(`Unknown two-peer id: ${String(_never)}`);
		}
	}
}

function asTwoPeer(id: TwoPeerId, peer: Peer): TwoPeer {
	return {
		id,
		editor: peer.editor,
		adapter: peer.adapter,
		crdtDoc: peer.crdtDoc,
	};
}
