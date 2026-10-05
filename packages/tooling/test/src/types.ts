import type {
	CreateEditorOptions,
	CRDTAdapter,
	CRDTDocument,
	Editor,
	PenDocument,
	BlockHandle,
} from "@input/pen-types";
import type * as Y from "yjs";

export type TestMarkDelta = {
	insert: string;
	attributes?: Record<string, unknown>;
};

export type TestTableCell = {
	content?: string;
	marks?: TestMarkDelta[];
};

export type TestTableRow = {
	cells: TestTableCell[];
};

export interface TestBlock {
	id?: string;
	type: string;
	props?: Record<string, unknown>;
	content?: string;
	marks?: TestMarkDelta[];
	children?: TestBlock[];
	table?: TestTableRow[];
}

export interface TestEditorOptions extends Partial<CreateEditorOptions> {
	blocks?: TestBlock[];
	doc?: Y.Doc;
}

export interface TestEditor extends Editor {
	readonly document: PenDocument;
	readonly ydoc: Y.Doc;
	readonly crdtDoc: CRDTDocument;

	getBlock(blockId: string): BlockHandle;
	simulateKeypress(key: string): void;
	simulateTyping(text: string): void;
	normalizeAll(): void;
	markDirty(blockId: string): void;
	normalizeDirty(): void;
}

export interface TestCollaboration {
	editorA: TestEditor;
	editorB: TestEditor;
	sync(): void;
}

export type NormalizedYjsValue =
	| null
	| boolean
	| number
	| string
	| NormalizedYjsValue[]
	| { [key: string]: NormalizedYjsValue };

export type YjsRootType = "array" | "map" | "text";

export interface YjsRootExpectation {
	name: string;
	type?: YjsRootType;
	optional?: boolean;
}

export interface NormalizedYDocSnapshot {
	roots: Record<string, NormalizedYjsValue>;
}

export interface DeterministicYDocFixtureOptions {
	blocks?: TestBlock[];
	clientId?: number;
	roots?: readonly YjsRootExpectation[];
	mutate?: (ydoc: Y.Doc) => void;
}

export interface DeterministicYDocFixture {
	ydoc: Y.Doc;
	doc: PenDocument;
	crdtDoc: CRDTDocument;
	update: Uint8Array;
	updateBase64: string;
	stateVector: Uint8Array;
	stateVectorBase64: string;
	snapshot: NormalizedYDocSnapshot;
}

export type TwoPeerId = "a" | "b";

export type TwoPeerInterleaving = "a-then-b" | "b-then-a";

export interface TwoPeerHarnessOptions extends TestEditorOptions {
	clientIdA?: number;
	clientIdB?: number;
	/** Mutate the seed editor before peers are forked from its encoded state. */
	prepare?: (editor: TestEditor) => void;
	/**
	 * Build each peer's extensions. An extension factory closes over the
	 * controller it activates, so two peers handed the same instance end up
	 * sharing one; anything with per-editor state needs this rather than
	 * `extensions`.
	 */
	extensionsFor?: (peer: TwoPeerId) => TestEditorOptions["extensions"];
}

export interface TwoPeer {
	readonly id: TwoPeerId;
	readonly editor: TestEditor;
	readonly adapter: CRDTAdapter;
	readonly crdtDoc: CRDTDocument;
}

export interface TwoPeerHarness {
	readonly peerA: TwoPeer;
	readonly peerB: TwoPeer;
	peer(id: TwoPeerId): TwoPeer;
	encodeUpdateFrom(from: TwoPeerId): Uint8Array;
	applyUpdateTo(to: TwoPeerId, update: Uint8Array): void;
	captureUpdates(): { fromA: Uint8Array; fromB: Uint8Array };
	exchange(interleaving?: TwoPeerInterleaving): void;
	sync(interleaving?: TwoPeerInterleaving): void;
	normalizeAll(): void;
	assertConverged(message?: string): void;
	snapshot(id?: TwoPeerId): NormalizedYDocSnapshot;
	destroy(): void;
}

/** Zero-based index of a peer in a {@link PeerHarness}. */
export type PeerIndex = number;

/** Options for `createPeerHarness(n, options)`. */
export interface PeerHarnessOptions extends TestEditorOptions {
	/** One Yjs clientID per peer. Default `index + 1`. Must be distinct and length n. */
	clientIds?: readonly number[];
	/** Mutate the seed editor before peers fork from its encoded state. */
	prepare?: (editor: TestEditor) => void;
	/** Fork from this encoded state instead of building a seed editor. Excludes `blocks`, `doc`, `prepare`. */
	seedUpdate?: Uint8Array;
	/**
	 * Build each peer's extensions. An extension factory closes over the
	 * controller it activates, so peers handed the same instance end up
	 * sharing one; anything with per-editor state needs this rather than
	 * `extensions`.
	 */
	extensionsFor?: (peer: PeerIndex) => TestEditorOptions["extensions"];
	/**
	 * Build each adapter with `yjsAdapter({ awareness: createYjsAwareness })`
	 * and relay its states in `syncAwareness()`. Default false.
	 */
	awareness?: boolean;
}

/** One forked peer of a {@link PeerHarness}. */
export interface Peer {
	readonly index: PeerIndex;
	/** `"a"`, `"b"`, `"c"` … for messages only. */
	readonly label: string;
	readonly editor: TestEditor;
	readonly adapter: CRDTAdapter;
	readonly crdtDoc: CRDTDocument;
}

/**
 * How a delivery reaches the receiver: `"adapter"` through
 * `adapter.applyUpdate` (structured `collaborator` origin), `"provider"`
 * through `Y.applyUpdate` with a non-adapter origin (`transaction.local === false`).
 */
export type PeerDeliveryPath = "adapter" | "provider";

/** One step of a peer schedule. */
export type PeerStep =
	| {
			readonly kind: "deliver";
			readonly from: PeerIndex;
			readonly to: PeerIndex;
			/** Default `"adapter"`. */
			readonly via?: PeerDeliveryPath;
	  }
	| { readonly kind: "normalize"; readonly peer: PeerIndex };

/**
 * Named delivery schedules:
 * - `ring`: two passes i → i+1 (mod n);
 * - `reverse-ring`: two passes i → i-1 (mod n);
 * - `star`: every peer → 0, then 0 → every peer;
 * - `pairwise`: every ordered pair, i ascending then j ascending, every second delivery via `"provider"`;
 * - `partial-normalize`: 0 → n-1, normalize(n-1), then pairwise.
 */
export type PeerScheduleName =
	| "ring"
	| "reverse-ring"
	| "star"
	| "pairwise"
	| "partial-normalize";

/**
 * A named schedule, a seeded schedule (3·n² steps, normalize with p = 1/4),
 * or explicit steps.
 */
export type PeerSchedule =
	| PeerScheduleName
	| { readonly seed: number }
	| readonly PeerStep[];

/** Options for {@link PeerHarness.deliver}. */
export interface PeerDeliverOptions {
	/** Default `"adapter"`. */
	via?: PeerDeliveryPath;
}

/** n forked editors on one seed, with explicit delivery and repair exchange. */
export interface PeerHarness {
	readonly peers: readonly Peer[];
	readonly size: number;
	peer(index: PeerIndex): Peer;
	stateVector(index: PeerIndex): Uint8Array;
	/** Everything `from` holds that `since` lacks. `since` defaults to the empty vector. */
	encodeUpdate(from: PeerIndex, since?: Uint8Array): Uint8Array;
	/** Applies through `adapter.applyUpdate`, so the receiver commits with origin `collaborator` (COL1). */
	applyUpdateTo(to: PeerIndex, update: Uint8Array): void;
	/**
	 * Sends `to` exactly the state-vector diff from `from`, and nothing when
	 * `to` already holds it. `via: "adapter"` (default) uses
	 * `adapter.applyUpdate`; `via: "provider"` uses `Y.applyUpdate` with a
	 * non-adapter origin, so the receiver sees `transaction.local === false`
	 * as with a real provider (COL1).
	 */
	deliver(from: PeerIndex, to: PeerIndex, options?: PeerDeliverOptions): void;
	/** Executes a schedule's steps in order. Does not quiesce. */
	run(schedule: PeerSchedule): void;
	/** Delivers every ordered pair until no peer's state moves. */
	syncAll(): void;
	/**
	 * syncAll; normalizeAll on every peer; syncAll — repeated until a round
	 * moves no peer's state (state vector or delete set). Returns the rounds
	 * used. Throws `PeerHarnessQuiesceError` after `MAX_QUIESCE_ROUNDS`,
	 * naming the peers whose state still moved.
	 */
	quiesce(): number;
	/** Runs `normalizeAll()` on every peer, in index order. */
	normalizeAll(): void;
	/** Relays every peer's local awareness state to every other peer. Requires `awareness: true`. */
	syncAwareness(): void;
	/** Throws `"N-peer documents did not converge"` naming every peer that differs from peer 0. */
	assertConverged(message?: string): void;
	snapshot(index?: PeerIndex): NormalizedYDocSnapshot;
	/** Destroys every editor and `Y.Doc` the harness allocated. */
	destroy(): void;
}
