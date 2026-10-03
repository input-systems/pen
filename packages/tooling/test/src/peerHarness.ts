import * as Y from "yjs";
import { deepEqual } from "@input/pen-core";
import { yjsAdapter } from "@input/pen-yjs";
import {
	applyYjsAwarenessUpdate,
	createYjsAwareness,
	encodeYjsAwarenessUpdate,
} from "@input/pen-yjs/awareness";
import { buildTestEditor, createTestEditor } from "./createTestEditor";
import { normalizeDocumentForSnapshot } from "./fixtures";
import { mulberry32 } from "./seededRandom";
import { assertStructuralInvariants } from "./structuralInvariants";
import type {
	NormalizedYDocSnapshot,
	Peer,
	PeerDeliverOptions,
	PeerHarness,
	PeerHarnessOptions,
	PeerIndex,
	PeerSchedule,
	PeerScheduleName,
	PeerStep,
	TestEditor,
	TestEditorOptions,
} from "./types";

/** Smallest peer count `createPeerHarness` accepts. */
export const PEER_HARNESS_MIN_PEERS = 2;
/** Largest peer count `createPeerHarness` accepts. The SCALE3 bench uses 8; 16 leaves headroom. */
export const PEER_HARNESS_MAX_PEERS = 16;
/** Repairs must settle within this many `quiesce()` exchange rounds. */
export const MAX_QUIESCE_ROUNDS = 4;

/** The five named schedules, in the order `runPeerSchedules` walks them. */
export const PEER_SCHEDULES = [
	"ring",
	"reverse-ring",
	"star",
	"pairwise",
	"partial-normalize",
] as const satisfies readonly PeerScheduleName[];

const DEFAULT_SEEDED_SCHEDULES: readonly PeerSchedule[] = [
	{ seed: 1 },
	{ seed: 2 },
];

const SEEDED_NORMALIZE_PROBABILITY = 0.25;
const SEEDED_STEPS_PER_PEER_SQUARED = 3;
const RING_PASSES = 2;

/**
 * Origin a "provider" delivery passes to `Y.applyUpdate`. It is not an
 * adapter origin, so the receiver classifies the transaction by
 * `local === false` alone, as it would for a real provider (COL1).
 */
const PROVIDER_ORIGIN = Object.freeze({ peerHarness: "provider" });

/** Thrown by `quiesce()` when normalization repairs do not settle. */
export class PeerHarnessQuiesceError extends Error {
	/** Labels of the peers whose state still moved in the last round. */
	readonly peers: readonly string[];

	constructor(peers: readonly string[]) {
		super(
			`Peer harness did not quiesce within ${MAX_QUIESCE_ROUNDS} rounds; state still moved on ${peers.join(", ")}. Normalization must be idempotent.`,
		);
		this.name = "PeerHarnessQuiesceError";
		this.peers = peers;
	}
}

/**
 * Forks `n` editors from one encoded seed, each with its own clientID, and
 * hands back explicit delivery, schedules, and repair exchange. Throws
 * `RangeError` outside [`PEER_HARNESS_MIN_PEERS`, `PEER_HARNESS_MAX_PEERS`].
 */
export function createPeerHarness(
	n: number,
	options: PeerHarnessOptions = {},
): PeerHarness {
	if (
		!Number.isInteger(n) ||
		n < PEER_HARNESS_MIN_PEERS ||
		n > PEER_HARNESS_MAX_PEERS
	) {
		throw new RangeError(
			`createPeerHarness: peer count must be an integer in [${PEER_HARNESS_MIN_PEERS}, ${PEER_HARNESS_MAX_PEERS}], got ${n}`,
		);
	}

	const {
		clientIds = Array.from({ length: n }, (_, index) => index + 1),
		prepare,
		seedUpdate: providedSeed,
		extensionsFor,
		awareness = false,
		...seedOptions
	} = options;

	if (clientIds.length !== n || new Set(clientIds).size !== n) {
		throw new RangeError(
			`createPeerHarness: clientIds must hold ${n} distinct values, got [${clientIds.join(", ")}]`,
		);
	}
	if (
		providedSeed &&
		(seedOptions.blocks !== undefined ||
			seedOptions.doc !== undefined ||
			prepare !== undefined)
	) {
		throw new TypeError(
			"createPeerHarness: seedUpdate excludes blocks, doc, and prepare",
		);
	}

	const seedUpdate = providedSeed ?? encodeSeed(seedOptions, prepare);
	const peers: Peer[] = [];
	try {
		for (let index = 0; index < n; index++) {
			peers.push(
				forkPeer(index, clientIds[index]!, seedUpdate, seedOptions, {
					extensionsFor,
					awareness,
				}),
			);
		}
	} catch (error) {
		for (const peer of peers) {
			destroyPeer(peer);
		}
		throw error;
	}

	const peer = (index: PeerIndex): Peer => {
		const found = peers[index];
		if (!found) {
			throw new RangeError(
				`Peer index ${index} is outside [0, ${n - 1}]`,
			);
		}
		return found;
	};

	const stateVector = (index: PeerIndex): Uint8Array =>
		Y.encodeStateVector(peer(index).editor.ydoc);

	const encodeUpdate = (from: PeerIndex, since?: Uint8Array): Uint8Array => {
		const source = peer(from);
		return source.adapter.encodeUpdate(source.crdtDoc, since);
	};

	const applyUpdateTo = (to: PeerIndex, update: Uint8Array): void => {
		const target = peer(to);
		target.adapter.applyUpdate(target.crdtDoc, update);
	};

	const deliver = (
		from: PeerIndex,
		to: PeerIndex,
		deliverOptions: PeerDeliverOptions = {},
	): void => {
		if (from === to) {
			return;
		}
		const target = peer(to);
		const update = encodeUpdate(from, stateVector(to));
		if (Y.snapshotContainsUpdate(Y.snapshot(target.editor.ydoc), update)) {
			return;
		}
		const via = deliverOptions.via ?? "adapter";
		switch (via) {
			case "adapter":
				applyUpdateTo(to, update);
				return;
			case "provider":
				Y.applyUpdate(target.editor.ydoc, update, PROVIDER_ORIGIN);
				return;
			default: {
				const _never: never = via;
				throw new Error(`Unknown delivery path: ${String(_never)}`);
			}
		}
	};

	const normalizePeer = (index: PeerIndex): void => {
		peer(index).editor.normalizeAll();
	};

	const runStep = (step: PeerStep): void => {
		switch (step.kind) {
			case "deliver":
				deliver(step.from, step.to, { via: step.via });
				return;
			case "normalize":
				normalizePeer(step.peer);
				return;
			default: {
				const _never: never = step;
				throw new Error(`Unknown peer step: ${JSON.stringify(_never)}`);
			}
		}
	};

	const snapshots = (): Y.Snapshot[] =>
		peers.map((entry) => Y.snapshot(entry.editor.ydoc));

	const movedPeers = (before: readonly Y.Snapshot[]): string[] =>
		peers
			.filter((entry, index) => {
				const previous = before[index];
				return (
					!previous ||
					!Y.equalSnapshots(previous, Y.snapshot(entry.editor.ydoc))
				);
			})
			.map((entry) => entry.label);

	const syncAll = (): void => {
		for (let pass = 0; pass <= n; pass++) {
			const before = snapshots();
			for (let from = 0; from < n; from++) {
				for (let to = 0; to < n; to++) {
					deliver(from, to);
				}
			}
			if (movedPeers(before).length === 0) {
				return;
			}
		}
	};

	const normalizeAll = (): void => {
		for (let index = 0; index < n; index++) {
			normalizePeer(index);
		}
	};

	const snapshot = (index: PeerIndex = 0): NormalizedYDocSnapshot =>
		normalizeDocumentForSnapshot(peer(index).editor.ydoc);

	return {
		peers,
		size: n,
		peer,
		stateVector,
		encodeUpdate,
		applyUpdateTo,
		deliver,
		run(schedule) {
			for (const step of schedulePeerSteps(n, schedule)) {
				runStep(step);
			}
		},
		syncAll,
		quiesce() {
			let moved: string[] = [];
			for (let round = 1; round <= MAX_QUIESCE_ROUNDS; round++) {
				const before = snapshots();
				syncAll();
				normalizeAll();
				syncAll();
				moved = movedPeers(before);
				if (moved.length === 0) {
					return round;
				}
			}
			throw new PeerHarnessQuiesceError(moved);
		},
		normalizeAll,
		syncAwareness() {
			if (!awareness) {
				throw new Error(
					"syncAwareness() requires createPeerHarness(n, { awareness: true })",
				);
			}
			for (const source of peers) {
				const sourceAwareness = source.editor.internals.awareness;
				if (!sourceAwareness) continue;
				const update = encodeYjsAwarenessUpdate(sourceAwareness, [
					source.editor.ydoc.clientID,
				]);
				for (const target of peers) {
					if (target === source) continue;
					const targetAwareness = target.editor.internals.awareness;
					if (!targetAwareness) continue;
					applyYjsAwarenessUpdate(targetAwareness, update, PROVIDER_ORIGIN);
				}
			}
		},
		assertConverged(message) {
			const reference = snapshot(0);
			const diverged = peers
				.slice(1)
				.filter((entry) => !deepEqual(reference, snapshot(entry.index)));
			if (diverged.length === 0) {
				return;
			}
			const detail = message ? `${message}\n` : "";
			const lines = [peers[0]!, ...diverged].map(
				(entry) =>
					`${entry.label.toUpperCase()}: ${JSON.stringify(snapshot(entry.index))}`,
			);
			throw new Error(
				`${detail}N-peer documents did not converge (${diverged.map((entry) => entry.label).join(", ")} differ from a).\n${lines.join("\n")}`,
			);
		},
		snapshot,
		destroy() {
			for (const entry of peers) {
				destroyPeer(entry);
			}
		},
	};
}

/**
 * For each schedule: a fresh harness, `apply`, `run(schedule)`, `quiesce()`,
 * `assertConverged()`, `assertStructuralInvariants()`, then `invariant`.
 * Failures are rethrown naming the peer count and schedule.
 */
export function runPeerSchedules(
	n: number,
	options: PeerHarnessOptions,
	apply: (harness: PeerHarness) => void,
	invariant?: (harness: PeerHarness, schedule: PeerSchedule) => void,
	schedules: readonly PeerSchedule[] = [
		...PEER_SCHEDULES,
		...DEFAULT_SEEDED_SCHEDULES,
	],
): void {
	for (const schedule of schedules) {
		const harness = createPeerHarness(n, options);
		try {
			apply(harness);
			harness.run(schedule);
			harness.quiesce();
			harness.assertConverged();
			assertStructuralInvariants(harness.peer(0));
			invariant?.(harness, schedule);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(
				`[${n} peers, schedule ${describePeerSchedule(schedule)}] ${reason}`,
				{ cause: error },
			);
		} finally {
			harness.destroy();
		}
	}
}

/** Human-readable schedule label for test names and failure messages. */
export function describePeerSchedule(schedule: PeerSchedule): string {
	if (typeof schedule === "string") {
		return schedule;
	}
	if (isSeededSchedule(schedule)) {
		return `seed ${schedule.seed}`;
	}
	return `${schedule.length} explicit steps`;
}

/** Expands a schedule into the steps `run()` executes. */
export function schedulePeerSteps(
	n: number,
	schedule: PeerSchedule,
): PeerStep[] {
	if (typeof schedule !== "string") {
		return isSeededSchedule(schedule)
			? seededSteps(n, schedule.seed)
			: [...schedule];
	}
	switch (schedule) {
		case "ring":
			return ringSteps(n, 1);
		case "reverse-ring":
			return ringSteps(n, n - 1);
		case "star": {
			const steps: PeerStep[] = [];
			for (let index = 1; index < n; index++) {
				steps.push({ kind: "deliver", from: index, to: 0 });
			}
			for (let index = 1; index < n; index++) {
				steps.push({ kind: "deliver", from: 0, to: index });
			}
			return steps;
		}
		case "pairwise":
			return pairwiseSteps(n);
		case "partial-normalize":
			return [
				{ kind: "deliver", from: 0, to: n - 1 },
				{ kind: "normalize", peer: n - 1 },
				...pairwiseSteps(n),
			];
		default: {
			const _never: never = schedule;
			throw new Error(`Unknown peer schedule: ${String(_never)}`);
		}
	}
}

function isSeededSchedule(
	schedule: Exclude<PeerSchedule, PeerScheduleName>,
): schedule is { readonly seed: number } {
	return !Array.isArray(schedule);
}

function ringSteps(n: number, stride: number): PeerStep[] {
	const steps: PeerStep[] = [];
	for (let pass = 0; pass < RING_PASSES; pass++) {
		for (let index = 0; index < n; index++) {
			steps.push({ kind: "deliver", from: index, to: (index + stride) % n });
		}
	}
	return steps;
}

function pairwiseSteps(n: number): PeerStep[] {
	const steps: PeerStep[] = [];
	let delivery = 0;
	for (let from = 0; from < n; from++) {
		for (let to = 0; to < n; to++) {
			if (from === to) continue;
			steps.push({
				kind: "deliver",
				from,
				to,
				via: delivery % 2 === 1 ? "provider" : "adapter",
			});
			delivery += 1;
		}
	}
	return steps;
}

function seededSteps(n: number, seed: number): PeerStep[] {
	const random = mulberry32(seed);
	const steps: PeerStep[] = [];
	const count = SEEDED_STEPS_PER_PEER_SQUARED * n * n;
	for (let step = 0; step < count; step++) {
		if (random() < SEEDED_NORMALIZE_PROBABILITY) {
			steps.push({ kind: "normalize", peer: Math.floor(random() * n) });
			continue;
		}
		const from = Math.floor(random() * n);
		const to = (from + 1 + Math.floor(random() * (n - 1))) % n;
		steps.push({
			kind: "deliver",
			from,
			to,
			via: random() < 0.5 ? "adapter" : "provider",
		});
	}
	return steps;
}

function encodeSeed(
	seedOptions: TestEditorOptions,
	prepare: PeerHarnessOptions["prepare"],
): Uint8Array {
	const seed = createTestEditor(seedOptions);
	try {
		prepare?.(seed);
		return seed.crdtDoc.adapter.encodeState(seed.crdtDoc);
	} finally {
		seed.destroy();
	}
}

/** Label used in messages: `a`, `b`, … `z`, then `p26`, `p27`, …. */
export function peerLabel(index: PeerIndex): string {
	return index < 26 ? String.fromCharCode(97 + index) : `p${index}`;
}

function forkPeer(
	index: PeerIndex,
	clientId: number,
	seedUpdate: Uint8Array,
	editorOptions: TestEditorOptions,
	peerOptions: {
		extensionsFor: PeerHarnessOptions["extensionsFor"];
		awareness: boolean;
	},
): Peer {
	const ydoc = new Y.Doc({ gc: false });
	(ydoc as unknown as { clientID: number }).clientID = clientId;
	Y.applyUpdate(ydoc, seedUpdate);

	const { blocks: _blocks, doc: _doc, ...rest } = editorOptions;
	const adapter = peerOptions.awareness
		? yjsAdapter({ awareness: createYjsAwareness })
		: yjsAdapter();
	let editor: TestEditor;
	try {
		editor = buildTestEditor(
			{
				...rest,
				...(peerOptions.extensionsFor
					? { extensions: peerOptions.extensionsFor(index) }
					: {}),
				doc: ydoc,
			},
			adapter,
		);
	} catch (error) {
		ydoc.destroy();
		throw error;
	}

	return {
		index,
		label: peerLabel(index),
		editor,
		adapter: editor.crdtDoc.adapter,
		crdtDoc: editor.crdtDoc,
	};
}

function destroyPeer(peer: Peer): void {
	const ydoc = peer.editor.ydoc;
	peer.editor.destroy();
	ydoc.destroy();
}
