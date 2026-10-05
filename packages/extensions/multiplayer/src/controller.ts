import { announceEditorA11y } from "@input/pen-core";
import type { ConnectionState, Editor, Unsubscribe } from "@input/pen-types";
import type {
	AuthorLedgerLike,
	ClientIdentityMapLike,
	MultiplayerAwarenessState,
	MultiplayerController,
	MultiplayerControllerOptions,
	MultiplayerSnapshot,
	MultiplayerState,
	PeerState,
	RemoteCursorState,
	RemoteSelectionState,
	RemoteStreamingState,
} from "./types";
import { PRESENCE_REJECTED_CODE } from "./presence/constants";
import { RemoteCursorManager } from "./presence/cursorManager";
import { PresenceIngest } from "./presence/presenceIngest";
import { RemoteSelectionManager } from "./presence/selectionManager";
import { resolveRemoteStreaming } from "./presence/streamingPresence";

export class MultiplayerControllerImpl implements MultiplayerController {
	private readonly editor: Editor;
	private readonly localClientId: number;
	private readonly authorLedger: AuthorLedgerLike;
	private readonly identityMap: ClientIdentityMapLike;
	private readonly ingest: PresenceIngest;
	private readonly listeners = new Set<() => void>();
	private readonly cursorManager: RemoteCursorManager;
	private readonly selectionManager: RemoteSelectionManager;
	private connectHandler: (() => void) | null = null;
	private disconnectHandler: (() => void) | null = null;

	private lastAccepted: Map<number, MultiplayerAwarenessState> | null = null;
	private peers: readonly PeerState[] = [];
	private mappedCursors: readonly RemoteCursorState[] = [];
	private mappedSelections: readonly RemoteSelectionState[] = [];
	private mappedStreaming: readonly RemoteStreamingState[] = [];
	private mappedPeers: readonly PeerState[] = [];
	private resolvedGeneration = -1;
	private resolveGeneration = 0;
	private mappedAccepted: Map<number, MultiplayerAwarenessState> | null =
		null;
	private readonly unsubscribeCommit: Unsubscribe;
	private state: MultiplayerState;

	constructor(options: MultiplayerControllerOptions) {
		this.editor = options.editor;
		this.localClientId = options.editor.clientId;
		this.authorLedger = options.authorLedger;
		this.identityMap = options.identityMap;
		this.ingest = new PresenceIngest({
			editor: options.editor,
			localClientId: this.localClientId,
			now: options.now,
		});
		this.cursorManager = new RemoteCursorManager(this.localClientId);
		this.selectionManager = new RemoteSelectionManager(this.localClientId);
		this.state = {
			connectionState: "disconnected",
			peers: this.peers,
			localUser: options.config.user,
			isConnected: false,
		};
		this.unsubscribeCommit = options.editor.on("commit", () => {
			this.resolveGeneration += 1;
			this.invalidateMapped();
			this.ensureMapped();
			if (this.state.peers !== this.mappedPeers) {
				this.setState({
					...this.state,
					peers: this.mappedPeers,
				});
			}
		});
	}

	getState(): MultiplayerState {
		this.ensureMapped();
		return this.state;
	}

	subscribe(listener: () => void): Unsubscribe {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	connect(): void {
		if (this.connectHandler) {
			this.connectHandler();
			return;
		}
		this.setConnectionState("connecting");
	}

	disconnect(): void {
		if (this.disconnectHandler) {
			this.disconnectHandler();
			return;
		}
		this.setConnectionState("disconnected");
	}

	getAuthorLedger(): AuthorLedgerLike {
		return this.authorLedger;
	}

	getIdentityMap(): ClientIdentityMapLike {
		return this.identityMap;
	}

	getPeers(): readonly PeerState[] {
		this.ensureMapped();
		return this.mappedPeers;
	}

	getRemoteCursors(): readonly RemoteCursorState[] {
		this.ensureMapped();
		return this.mappedCursors;
	}

	getRemoteSelections(): readonly RemoteSelectionState[] {
		this.ensureMapped();
		return this.mappedSelections;
	}

	getRemoteStreaming(): readonly RemoteStreamingState[] {
		this.ensureMapped();
		return this.mappedStreaming;
	}

	snapshot(): MultiplayerSnapshot {
		return {
			state: this.state,
			remoteCursors: this.getRemoteCursors(),
			remoteSelections: this.getRemoteSelections(),
			remoteStreaming: this.getRemoteStreaming(),
		};
	}

	destroy(): void {
		this.unsubscribeCommit();
		this.connectHandler = null;
		this.disconnectHandler = null;
		this.ingest.destroy();
		this.listeners.clear();
	}

	setConnectionLifecycleHandlers(handlers: {
		connect: () => void;
		disconnect: () => void;
	}): void {
		this.connectHandler = handlers.connect;
		this.disconnectHandler = handlers.disconnect;
	}

	setConnectionState(connectionState: ConnectionState): void {
		this.setState({
			...this.state,
			connectionState,
			isConnected: connectionState === "connected",
		});
	}

	handleAwarenessChange(states: Map<number, MultiplayerAwarenessState>): void {
		try {
			const previousPeers = this.peers;
			const accepted = this.ingest.ingest(states);
			this.identityMap.updateFromAwareness(accepted);
			for (const [clientId, user] of this.identityMap.entries()) {
				this.authorLedger.record(clientId, user);
			}
			this.lastAccepted = accepted;
			this.cursorManager.ingest(this.editor, accepted, (clientId) =>
				this.identityMap.resolve(clientId),
			);
			this.selectionManager.ingest(this.editor, accepted, (clientId) =>
				this.identityMap.resolve(clientId),
			);
			this.invalidateMapped();
			this.ensureMapped();
			this.announcePeerChanges(previousPeers, this.mappedPeers);
			this.peers = this.mappedPeers;
			this.setState({
				...this.state,
				peers: this.mappedPeers,
			});
		} catch (error) {
			this.editor.internals.emit("diagnostic", {
				code: PRESENCE_REJECTED_CODE,
				level: "warn",
				source: "multiplayer",
				extension: "multiplayer",
				message: "Presence ingest failed.",
				error,
			});
		}
	}

	private announcePeerChanges(
		previous: readonly PeerState[],
		next: readonly PeerState[],
	): void {
		const previousIds = new Set(previous.map((peer) => peer.clientId));
		const previousEditing = new Set(
			previous
				.filter((peer) => peer.cursor !== null || peer.selection !== null)
				.map((peer) => peer.clientId),
		);
		for (const peer of next) {
			if (!previousIds.has(peer.clientId)) {
				announceEditorA11y(this.editor, "collaboratorJoined", {
					name: peer.user.name,
				});
				continue;
			}
			if (
				(peer.cursor !== null || peer.selection !== null) &&
				!previousEditing.has(peer.clientId)
			) {
				announceEditorA11y(this.editor, "collaboratorEditing", {
					name: peer.user.name,
				});
			}
		}
	}

	private setState(nextState: MultiplayerState): void {
		this.state = nextState;
		for (const listener of this.listeners) {
			listener();
		}
	}

	private invalidateMapped(): void {
		this.resolvedGeneration = -1;
		this.mappedAccepted = null;
	}

	private ensureMapped(): void {
		if (
			this.resolvedGeneration === this.resolveGeneration &&
			this.mappedAccepted === this.lastAccepted
		) {
			return;
		}

		const nextCursors = this.cursorManager.resolve(this.editor);
		const nextSelections = this.selectionManager.resolve(this.editor);
		const nextStreaming = this.lastAccepted
			? resolveRemoteStreaming(
					this.editor,
					this.lastAccepted,
					this.localClientId,
					(clientId) => this.identityMap.resolve(clientId),
				)
			: this.mappedStreaming;
		// A commit re-resolves every peer, but most leave a peer where it was:
		// keep the previous objects then, so subscribers see no change.
		this.mappedCursors = reuseEqual(this.mappedCursors, nextCursors);
		this.mappedSelections = reuseEqual(
			this.mappedSelections,
			nextSelections,
		);
		this.mappedStreaming = reuseEqual(this.mappedStreaming, nextStreaming);

		const nextPeers = this.lastAccepted
			? this.buildPeers(this.lastAccepted)
			: this.peers;
		this.mappedPeers = reuseEqual(this.mappedPeers, nextPeers);
		this.resolvedGeneration = this.resolveGeneration;
		this.mappedAccepted = this.lastAccepted;
	}

	private buildPeers(
		states: Map<number, MultiplayerAwarenessState>,
	): readonly PeerState[] {
		const cursorMap = new Map(
			this.mappedCursors.map((cursor) => [cursor.clientId, cursor]),
		);
		const selectionMap = new Map(
			this.mappedSelections.map((selection) => [
				selection.clientId,
				selection,
			]),
		);
		const streamingMap = new Map(
			this.mappedStreaming.map((streaming) => [
				streaming.clientId,
				streaming,
			]),
		);
		const peers: PeerState[] = [];

		for (const [clientId] of states) {
			if (clientId === this.localClientId) {
				continue;
			}

			const cursor = cursorMap.get(clientId) ?? null;
			const selection = selectionMap.get(clientId) ?? null;
			peers.push({
				clientId,
				user: this.identityMap.resolve(clientId),
				cursor,
				selection,
				streaming: streamingMap.get(clientId) ?? null,
				lastSeen: Math.max(
					cursor?.clock ?? 0,
					selection?.clock ?? 0,
				),
			});
		}

		return peers;
	}
}

/**
 * `next`, with each entry swapped for its predecessor (same `clientId`)
 * when the two hold equal values, and `prev` itself when every entry was
 * kept in order.
 */
function reuseEqual<T extends { readonly clientId: number }>(
	prev: readonly T[],
	next: readonly T[],
): readonly T[] {
	if (prev === next) {
		return prev;
	}
	const previous = new Map(prev.map((item) => [item.clientId, item]));
	let unchanged = prev.length === next.length;
	const reused = next.map((item, index) => {
		const before = previous.get(item.clientId);
		const kept =
			before !== undefined && presenceValueEqual(before, item) ? before : item;
		if (kept !== prev[index]) {
			unchanged = false;
		}
		return kept;
	});
	return unchanged ? prev : reused;
}

/**
 * Structural equality over presence values: plain objects, arrays and
 * primitives, a handful of fields deep. Nested entries that were already
 * reused compare by identity first.
 */
function presenceValueEqual(left: unknown, right: unknown): boolean {
	if (left === right) {
		return true;
	}
	if (
		typeof left !== "object" ||
		typeof right !== "object" ||
		left === null ||
		right === null
	) {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((item, index) => presenceValueEqual(item, right[index]))
		);
	}
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const keys = Object.keys(leftRecord);
	if (keys.length !== Object.keys(rightRecord).length) {
		return false;
	}
	return keys.every(
		(key) =>
			Object.prototype.hasOwnProperty.call(rightRecord, key) &&
			presenceValueEqual(leftRecord[key], rightRecord[key]),
	);
}
