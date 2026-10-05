import {
	getInlineCompletionController,
	getListItemSemantics,
	getListSegments,
	isListItemType,
	summaryTouchedBlockIds,
	type ListItemSemantics,
} from "@input/pen-core";
import type {
	ChangeSummary,
	CommitEvent,
	Editor,
	InlineCompletionController,
	InlineCompletionSuggestion,
	SelectionState,
	Unsubscribe,
} from "@input/pen-types";

import { getDocumentPlaceholderTargetBlockId } from "../utils/editorEmptyState";
import { numberedOrdinals, standaloneOrdinal } from "../utils/numberedListRun";
import { getRootBlockIds } from "../utils/parentIdTree";
import { arraysEqual } from "../utils/arraysEqual";
import {
	buildCommitSlice,
	buildFieldSlice,
	buildListSlice,
	buildSelectionSlice,
	buildSurfaceSnapshot,
	selectedBlockIds,
	type LastCommit,
} from "./blockNotifierSlices";
import type {
	BlockListSegment,
	BlockListSlice,
	BlockNotifier,
	BlockNotifierDiagnostics,
	BlockNotifierEventKind,
	BlockSnapshot,
	DocumentSnapshot,
	SurfaceSnapshot,
} from "./blockNotifierTypes";
import type { FieldEditorStore, FieldEditorStoreSnapshot } from "./store";

export interface BlockNotifierOptions {
	readonly fieldEditor?: FieldEditorStore | null;
}

interface Entry {
	snapshot: BlockSnapshot;
	readonly subscribers: Set<() => void>;
	domSyncVersion: number;
	lastCommit: LastCommit | undefined;
	/** The parent the snapshot was built under: the container a later commit's summary may not name. */
	parentId: string | null;
}

/** Per-event scratch: ordinals and list semantics are computed once per touched run. */
interface EventContext {
	/** Only a structural commit can move list semantics; any other event keeps each item's slice. */
	readonly structural: boolean;
	readonly ordinals: Map<string, number>;
	/** AX1 semantics of every item of each list run walked in this event. */
	readonly semantics: Map<string, ListItemSemantics>;
	/** The block type of every sibling the run walk read (null for a missing block). */
	readonly types: Map<string, string | null>;
}

/**
 * Where a sibling list changed, in its new positions: `[from, to]` replaced
 * the previous list's middle (`to === from - 1` for a pure removal), and the
 * list grew by `shift`. Null when the previous list is unknown.
 */
interface ChangedSpan {
	readonly from: number;
	readonly to: number;
	readonly shift: number;
	/** The list before the commit. */
	readonly previous: readonly string[];
}

function newContext(structural = false): EventContext {
	return { structural, ordinals: new Map(), semantics: new Map(), types: new Map() };
}

const NUMBERED = "numberedListItem";
/**
 * Props whose change can move a block into, out of, or within a list group
 * (AX1), or move a numbered item's ordinal.
 */
const LIST_SEMANTIC_PROPS = new Set(["type", "indent", "parentId", "start"]);
const EMPTY_IDS: readonly string[] = Object.freeze([]);

function emptyFanout(): Record<BlockNotifierEventKind, number> {
	return { commit: 0, selection: 0, field: 0, decorations: 0, completion: 0, domSync: 0 };
}

/**
 * The per-block fan-out bindings subscribe to (SCALE6). It holds one
 * subscription each on `commit`, `selectionChange`, `decorationsChange`, the
 * field-editor store and the inline completion controller while it has any
 * subscriber, and per event re-reads only the blocks that event names.
 */
export function createBlockNotifier(editor: Editor, options: BlockNotifierOptions = {}): BlockNotifier {
	return new BlockNotifierImpl(editor, options.fieldEditor ?? null);
}

class BlockNotifierImpl implements BlockNotifier {
	private readonly _entries = new Map<string, Entry>();
	private readonly _changeSubscribers = new Set<(blockIds: readonly string[]) => void>();
	private readonly _documentSubscribers = new Set<() => void>();
	private readonly _surfaceSubscribers = new Set<() => void>();
	private readonly _segmentSubscribers = new Map<string | null, Set<() => void>>();
	private readonly _segments = new Map<string | null, readonly BlockListSegment[]>();
	/** The sibling list each cached segment list was computed over. */
	private readonly _segmentBasis = new Map<string | null, readonly string[]>();
	/**
	 * The containers whose cached segment basis lists each child, so a
	 * container rendered through its segment channel alone is found when a
	 * `parentId`-route child leaves it (AX1). The root list is left out: it is
	 * the fallback, and indexing it would cost O(n) per structural commit.
	 */
	private readonly _segmentParents = new Map<string, Set<string>>();
	private _sources: Unsubscribe[] = [];
	private _completion: InlineCompletionController | null = null;
	private _completionBlockId: string | null = null;
	private _selection: SelectionState | null = null;
	private _selected: ReadonlySet<string> = new Set();
	private _store: FieldEditorStoreSnapshot | null = null;
	private _surface: SurfaceSnapshot = buildSurfaceSnapshot(null, undefined);
	private _document: DocumentSnapshot | null = null;
	/** `documentState.generation` the cached root ids were read at. */
	private _rootIdsGeneration = -1;
	/** Core's top-level list the root ids were last read as, while no dead id was filtered out. */
	private _coreRootIds: readonly string[] | null = null;
	/**
	 * COL4: ids still in an order array whose block a concurrent delete
	 * removed. Remote commits do not normalize, and a delete that only drops
	 * the block map entry names no structural change, so renderers skip these.
	 */
	private readonly _deadIds = new Set<string>();
	/**
	 * The parents whose cached snapshot lists each child: the pre-commit
	 * parent a commit's summary does not name. Kept as snapshots change, so
	 * a lookup reads one entry rather than every cached snapshot.
	 */
	private readonly _cachedParents = new Map<string, Set<string>>();
	private _sharedReadContext: EventContext | null = null;
	private _deliveries = 0;
	private readonly _fanout = emptyFanout();

	constructor(
		private readonly _editor: Editor,
		private readonly _fieldEditor: FieldEditorStore | null,
	) {}

	get diagnostics(): BlockNotifierDiagnostics {
		let blockSubscribers = 0;
		for (const entry of this._entries.values()) blockSubscribers += entry.subscribers.size;
		return {
			sourceSubscriptions: this._sources.length,
			blockSubscribers,
			changeSubscribers: this._changeSubscribers.size,
			cachedSnapshots: this._entries.size,
			deliveries: this._deliveries,
			lastFanout: { ...this._fanout },
		};
	}

	// ── Subscriptions ────────────────────────────────────────

	subscribeBlock(blockId: string, onChange: () => void): Unsubscribe {
		this._attach();
		const entry = this._entryFor(blockId);
		entry.subscribers.add(onChange);
		return () => {
			entry.subscribers.delete(onChange);
			if (entry.subscribers.size === 0 && this._entries.get(blockId) === entry) {
				this._forget(blockId, entry);
			}
			this._detachIfIdle();
		};
	}

	/**
	 * A read attaches, so a snapshot read in render before its block
	 * subscribes (React) is kept current by the events between the two: it
	 * keeps its identity across events that do not name the block, a commit
	 * that names it drops it so the next read rebuilds it, and the notifier
	 * detaches at an event with no subscriber left (SCALE4, SCALE6).
	 */
	getBlockSnapshot(blockId: string): BlockSnapshot {
		this._attach();
		return this._entryFor(blockId).snapshot;
	}

	subscribeChanges(onChange: (blockIds: readonly string[]) => void): Unsubscribe {
		return this._subscribeTo(this._changeSubscribers, onChange);
	}

	subscribeDocument(onChange: () => void): Unsubscribe {
		return this._subscribeTo(this._documentSubscribers, onChange);
	}

	getDocumentSnapshot(): DocumentSnapshot {
		// Attached, the snapshot is kept current by commits; detached, read now.
		// Root ids only move with a structural change, which bumps the
		// generation: a renderer reading every block before it subscribes
		// (React) must not walk the order once per block (SCALE6).
		if (!this._document || this._sources.length === 0) {
			const structural = this._rootIdsGeneration !== this._editor.documentState.generation;
			this._document = this._buildDocument(this._document ?? undefined, structural);
		}
		return this._document;
	}

	subscribeSurface(onChange: () => void): Unsubscribe {
		return this._subscribeTo(this._surfaceSubscribers, onChange);
	}

	getSurfaceSnapshot(): SurfaceSnapshot {
		if (this._sources.length === 0) {
			this._surface = buildSurfaceSnapshot(this._fieldEditor?.getSnapshot() ?? null, this._surface);
		}
		return this._surface;
	}

	subscribeListSegments(parentId: string | null, onChange: () => void): Unsubscribe {
		let subscribers = this._segmentSubscribers.get(parentId);
		if (!subscribers) {
			subscribers = new Set();
			this._segmentSubscribers.set(parentId, subscribers);
		}
		const set = subscribers;
		this._attach();
		set.add(onChange);
		return () => {
			set.delete(onChange);
			// A released unsubscribe called again must not drop a newer set.
			if (set.size === 0 && this._segmentSubscribers.get(parentId) === set) {
				this._segmentSubscribers.delete(parentId);
				this._dropSegments(parentId);
			}
			// After the channel is gone, so the last one out detaches.
			this._detachIfIdle();
		};
	}

	getListSegments(parentId: string | null): readonly BlockListSegment[] {
		// A read attaches, so a list read in render before its channel
		// subscribes (React) is kept current, or dropped, by the commits
		// between the two: a subscribed list is patched, an unsubscribed one
		// is dropped by a commit that touches it, and every one by detaching.
		// So a cached list is always current, and a render-before-subscribe
		// read keeps its identity (useSyncExternalStore).
		this._attach();
		const cached = this._segments.get(parentId);
		if (cached) return cached;
		const siblings = this._siblingsOf(parentId);
		const segments = getListSegments(this._editor, siblings);
		this._storeSegments(parentId, segments, siblings);
		return segments;
	}

	markDomSynced(blockId: string | null): void {
		const surface = this.getSurfaceSnapshot();
		const ids =
			blockId !== null
				? [blockId]
				: surface.mode === "expanded"
					? surface.activeBlockIds
					: surface.focusBlockId !== null
						? [surface.focusBlockId]
						: EMPTY_IDS;
		for (const id of ids) {
			const entry = this._entries.get(id);
			if (entry) entry.domSyncVersion += 1;
		}
		this._deliver("domSync", ids);
	}

	destroy(): void {
		this._clearEntries();
		this._changeSubscribers.clear();
		this._documentSubscribers.clear();
		this._surfaceSubscribers.clear();
		this._segmentSubscribers.clear();
		this._segments.clear();
		this._segmentBasis.clear();
		this._segmentParents.clear();
		this._deadIds.clear();
		this._detach();
	}

	// ── Lifetime ─────────────────────────────────────────────

	private _subscribeTo<T>(set: Set<T>, callback: T): Unsubscribe {
		this._attach();
		set.add(callback);
		return () => {
			set.delete(callback);
			this._detachIfIdle();
		};
	}

	private _hasSubscribers(): boolean {
		if (this._changeSubscribers.size + this._documentSubscribers.size + this._surfaceSubscribers.size > 0) {
			return true;
		}
		if (this._segmentSubscribers.size > 0) return true;
		for (const entry of this._entries.values()) {
			if (entry.subscribers.size > 0) return true;
		}
		return false;
	}

	private _attach(): void {
		if (this._sources.length > 0) return;
		const editor = this._editor;
		this._selection = editor.selection;
		this._selected = new Set(selectedBlockIds(editor, this._selection));
		this._store = this._fieldEditor?.getSnapshot() ?? null;
		this._surface = buildSurfaceSnapshot(this._store, this._surface);
		this._document = this._buildDocument(this._document ?? undefined, true);
		this._sources = [
			editor.on("commit", (event) => this._onCommit(event)),
			editor.on("selectionChange", () => this._onSelection()),
			editor.on("decorationsChange", (_generation, changed) => this._onDecorations(changed)),
		];
		if (this._fieldEditor) {
			this._sources.push(this._fieldEditor.subscribe(() => this._onField()));
		}
		this._resolveCompletion();
	}

	private _detachIfIdle(): void {
		if (!this._hasSubscribers()) this._detach();
	}

	private _detach(): void {
		for (const unsubscribe of this._sources.splice(0)) unsubscribe();
		this._sharedReadContext = null;
		this._completion = null;
		this._completionBlockId = null;
		this._clearEntries();
		// Detached, nothing keeps a list current; a subscribed one re-reads.
		for (const parentId of [...this._segments.keys()]) this._dropSegments(parentId);
	}

	/**
	 * At an event with no subscriber left, only reads kept the notifier
	 * attached (render before subscribe); it detaches rather than keeping
	 * them current, which bounds what a read holds (SCALE4).
	 */
	private _releaseIfIdle(): boolean {
		if (this._hasSubscribers()) return false;
		this._detach();
		return true;
	}

	/** Extensions activate asynchronously; resolve the controller until one exists. */
	private _resolveCompletion(): void {
		if (this._completion || this._sources.length === 0) return;
		const controller = getInlineCompletionController(this._editor);
		if (!controller) return;
		this._completion = controller;
		this._completionBlockId = controller.getState().visibleSuggestion?.blockId ?? null;
		this._sources.push(controller.subscribe(() => this._onCompletion()));
	}

	// ── Sources ──────────────────────────────────────────────

	private _onCommit(event: CommitEvent): void {
		if (this._releaseIfIdle()) return;
		this._resolveCompletion();
		const { summary } = event;
		const touched = summaryTouchedBlockIds(summary);
		const last: LastCommit = { origin: event.origin, commitId: event.commitId };
		for (const id of touched) {
			const entry = this._entries.get(id);
			if (entry) entry.lastCommit = last;
		}
		const ids = new Set<string>([...touched, ...this._namedParents(summary)]);
		const context = newContext(summary.structural.length > 0);
		if (context.structural) this._sharedReadContext = null;
		const previousRootIds = this._document?.rootIds ?? null;
		if (summary.structural.length > 0) {
			this._reselect(ids);
			// A multi-block text range's endpoint slices follow the endpoints'
			// document order, which a structural commit can flip while the
			// selection itself is unchanged.
			const selection = this._selection;
			if (
				selection?.type === "text" &&
				selection.anchor.blockId !== selection.focus.blockId
			) {
				ids.add(selection.anchor.blockId);
				ids.add(selection.focus.blockId);
			}
		}
		const liveness = this._trackDeadIds(summary);
		this._updateDocument(summary.structural.length > 0 || liveness, ids);
		// AX1: the sibling lists a structural commit touched, walked run by run.
		const listSpans = this._collectListSemantics(summary, previousRootIds, ids, context);
		// Sibling lists re-sync before blocks hear the commit, as the document
		// channel does: a removed block's node is gone before its slice is read.
		if (listSpans.size > 0) this._refreshSegments(listSpans, context);
		this._deliver("commit", ids, context);
	}

	/**
	 * Whether a block died or came back. Only `block-removed` ids are checked
	 * for liveness, so a text commit reads nothing (SCALE2).
	 */
	private _trackDeadIds(summary: ChangeSummary): boolean {
		// A remote write can bring a dead block back without naming it.
		let changed = summary.structural.length > 0 && this._reviveDeadIds();
		for (const change of summary.structural) {
			if (change.type === "block-inserted" || change.type === "block-moved") {
				if (this._deadIds.delete(change.blockId)) changed = true;
				continue;
			}
			if (change.type !== "block-removed" || this._deadIds.has(change.blockId)) continue;
			// A delete that also removed the order entry leaves nothing to skip.
			if (this._editor.documentState.indexOf(change.blockId) < 0) continue;
			if (this._editor.getBlock(change.blockId) === null) {
				this._deadIds.add(change.blockId);
				changed = true;
			}
		}
		return changed;
	}

	private _onSelection(): void {
		if (this._releaseIfIdle()) return;
		const previous = this._selection;
		const previousSelected = this._selected;
		this._selection = this._editor.selection;
		const ids = new Set<string>([...endpoints(previous), ...endpoints(this._selection)]);
		this._reselect(ids);
		// A selection that changed kind re-slices every block it covered or
		// covers, not only those whose membership moved: a block inside both a
		// text range and the block selection replacing it loses its text range.
		if (previous?.type !== this._selection?.type) {
			for (const id of previousSelected) ids.add(id);
			for (const id of this._selected) ids.add(id);
		}
		this._deliver("selection", ids);
	}

	private _onField(): void {
		if (this._releaseIfIdle()) return;
		const previous = this._store;
		const next = this._fieldEditor?.getSnapshot() ?? null;
		this._store = next;
		const ids = fieldChangedIds(previous, next);
		const surface = buildSurfaceSnapshot(next, this._surface);
		const surfaceChanged = surface !== this._surface;
		this._surface = surface;
		this._deliver("field", ids);
		if (surfaceChanged) this._notifyAll(this._surfaceSubscribers);
	}

	private _onDecorations(changed: readonly string[] | undefined): void {
		if (this._releaseIfIdle()) return;
		this._deliver("decorations", changed ?? [...this._entries.keys()]);
	}

	private _onCompletion(): void {
		if (this._releaseIfIdle()) return;
		const previous = this._completionBlockId;
		const next = this._completion?.getState().visibleSuggestion?.blockId ?? null;
		this._completionBlockId = next;
		const ids = [previous, next];
		// Visibility flipped: the blocks that can show a placeholder must hear it.
		if ((previous === null) !== (next === null)) {
			ids.push(
				this._surface.focusBlockId,
				this.getDocumentSnapshot().placeholderTargetBlockId,
				...endpoints(this._selection),
			);
		}
		this._deliver("completion", ids.filter((id): id is string => id !== null));
	}

	// ── Derived state ────────────────────────────────────────

	/** Recomputes the selected set; adds every block whose membership changed. */
	private _reselect(ids: Set<string>): void {
		const next = new Set(selectedBlockIds(this._editor, this._selection));
		for (const id of next) if (!this._selected.has(id)) ids.add(id);
		for (const id of this._selected) if (!next.has(id)) ids.add(id);
		this._selected = next;
	}

	/** Parents a structural change names, whose `childIds` may have changed. */
	private _namedParents(summary: ChangeSummary): string[] {
		const parents: (string | null | undefined)[] = [];
		for (const change of summary.structural) {
			switch (change.type) {
				case "block-inserted":
				case "block-removed":
					parents.push(change.parentId);
					break;
				case "block-moved":
					parents.push(change.fromParentId, change.toParentId);
					break;
				case "block-props-changed":
					if (change.keys.includes("parentId")) {
						parents.push(...this._cachedParentsOf(change.blockId), this._editor.documentState.parentOf(change.blockId));
					}
					break;
				default:
					break;
			}
			// The parentId route: a root-order insert or removal can still change
			// a container's children.
			for (const id of structuralBlockIds(change)) {
				parents.push(this._editor.documentState.parentOf(id), ...this._cachedParentsOf(id));
			}
		}
		return parents.filter((id): id is string => typeof id === "string");
	}

	/** Every cached parent whose snapshot lists `blockId` (two under COL4). */
	private _cachedParentsOf(blockId: string): Iterable<string> {
		return this._cachedParents.get(blockId) ?? EMPTY_IDS;
	}

	private _updateDocument(structural: boolean, ids: Set<string>): void {
		const previous = this._document ?? undefined;
		const next = this._buildDocument(previous, structural);
		if (next === previous) return;
		this._document = next;
		if (previous?.placeholderTargetBlockId) ids.add(previous.placeholderTargetBlockId);
		if (next.placeholderTargetBlockId) ids.add(next.placeholderTargetBlockId);
		this._notifyAll(this._documentSubscribers);
	}

	private _buildDocument(previous: DocumentSnapshot | undefined, structural: boolean): DocumentSnapshot {
		const rootIds = !previous || structural ? this._liveRootIds() : previous.rootIds;
		const next: DocumentSnapshot = {
			rootIds: previous && arraysEqual(previous.rootIds, rootIds) ? previous.rootIds : rootIds,
			isEmpty: this._editor.documentState.isEmpty,
			placeholderTargetBlockId: getDocumentPlaceholderTargetBlockId(this._editor),
		};
		const same =
			previous &&
			previous.rootIds === next.rootIds &&
			previous.isEmpty === next.isEmpty &&
			previous.placeholderTargetBlockId === next.placeholderTargetBlockId;
		return same ? previous : next;
	}

	private _liveRootIds(): readonly string[] {
		this._rootIdsGeneration = this._editor.documentState.generation;
		const rootIds = getRootBlockIds(this._editor);
		this._reviveDeadIds();
		this._coreRootIds = this._deadIds.size === 0 ? rootIds : null;
		if (this._deadIds.size === 0) return rootIds;
		return rootIds.filter((id) => !this._deadIds.has(id));
	}

	/**
	 * Forgets every dead id core no longer lists or holds a block for again.
	 * Detached, the notifier hears no commit, so a block re-inserted meanwhile
	 * is only found here (COL4). O(dead ids).
	 */
	private _reviveDeadIds(): boolean {
		let changed = false;
		for (const id of this._deadIds) {
			if (this._editor.documentState.indexOf(id) < 0 || this._editor.getBlock(id) !== null) {
				this._deadIds.delete(id);
				changed = true;
			}
		}
		return changed;
	}

	/** The sibling list a parent renders: the live root ids, or `childrenOf` (RI6). */
	private _siblingsOf(parentId: string | null): readonly string[] {
		return parentId === null
			? this.getDocumentSnapshot().rootIds
			: this._editor.documentState.childrenOf(parentId);
	}

	/**
	 * `blockId`'s position in a sibling list, or -1. The root list asks core's
	 * top-level index while the root ids are core's current list, so a
	 * structural commit builds no position map over the whole list (SCALE2).
	 */
	private _positionIn(parentId: string | null, siblings: readonly string[], blockId: string): number {
		const state = this._editor.documentState;
		if (
			parentId === null &&
			this._coreRootIds !== null &&
			this._coreRootIds === state.rootBlockIds() &&
			siblings.length === this._coreRootIds.length
		) {
			return state.rootBlockIndexOf(blockId);
		}
		return indexIn(siblings, blockId);
	}

	/** A whole sibling list through `getListSegments`. */
	private _buildSegments(parentId: string | null): readonly BlockListSegment[] {
		return getListSegments(this._editor, this._siblingsOf(parentId));
	}

	/**
	 * Re-segments each subscribed parent the commit's list walk touched. A
	 * cached parent is patched from its previous segments and the runs the walk
	 * recomputed, so an edit reads only the runs around it (SCALE6); with its
	 * changed span known, only the segments that span and those runs reach
	 * are rebuilt (SCALE2).
	 */
	private _refreshSegments(spans: ReadonlyMap<string | null, ChangedSpan | null>, context: EventContext): void {
		for (const [parentId, span] of spans) {
			const subscribers = this._segmentSubscribers.get(parentId);
			// A list read without a subscriber is not patched; the next read
			// re-reads it.
			if (!subscribers) {
				this._dropSegments(parentId);
				continue;
			}
			const previous = this._segments.get(parentId);
			const siblings = this._siblingsOf(parentId);
			let next: readonly BlockListSegment[];
			if (!previous) {
				next = this._buildSegments(parentId);
			} else {
				// The span patch needs the segments to cover the list it
				// changed; any other cached list is re-read whole.
				const patched =
					span && this._segmentBasis.get(parentId) === span.previous
						? this._patchSpan(previous, parentId, siblings, span, context)
						: null;
				next = patched ?? patchSegments(previous, siblings, context);
				if (next === previous || (!patched && segmentsEqual(previous, next))) {
					this._setSegmentBasis(parentId, siblings);
					continue;
				}
			}
			this._storeSegments(parentId, next, siblings);
			this._notifyAll(subscribers);
		}
	}

	private _storeSegments(
		parentId: string | null,
		segments: readonly BlockListSegment[],
		basis: readonly string[],
	): void {
		this._segments.set(parentId, segments);
		this._setSegmentBasis(parentId, basis);
	}

	private _dropSegments(parentId: string | null): void {
		this._segments.delete(parentId);
		this._setSegmentBasis(parentId, null);
	}

	/** Records (or, with null, drops) the list a parent's cached segments cover. */
	private _setSegmentBasis(parentId: string | null, basis: readonly string[] | null): void {
		const previous = this._segmentBasis.get(parentId);
		if (previous === basis) return;
		if (basis === null) this._segmentBasis.delete(parentId);
		else this._segmentBasis.set(parentId, basis);
		if (parentId === null) return;
		for (const childId of previous ?? EMPTY_IDS) {
			const parents = this._segmentParents.get(childId);
			parents?.delete(parentId);
			if (parents?.size === 0) this._segmentParents.delete(childId);
		}
		for (const childId of basis ?? EMPTY_IDS) {
			let parents = this._segmentParents.get(childId);
			if (!parents) {
				parents = new Set();
				this._segmentParents.set(childId, parents);
			}
			parents.add(parentId);
		}
	}

	/** Widens a changed span to every position this event's run walk read, then patches it. */
	private _patchSpan(
		previous: readonly BlockListSegment[],
		parentId: string | null,
		siblings: readonly string[],
		span: ChangedSpan,
		context: EventContext,
	): readonly BlockListSegment[] {
		let from = span.from;
		let to = span.to;
		for (const blockId of context.types.keys()) {
			const at = this._positionIn(parentId, siblings, blockId);
			if (at < 0) continue;
			from = Math.min(from, at);
			to = Math.max(to, at);
		}
		return patchSegmentRange(previous, siblings, from, to, span.shift, context);
	}

	// ── List semantics (AX1) ─────────────────────────────────

	private _isListItem(blockId: string, context: EventContext): boolean {
		let type = context.types.get(blockId);
		if (type === undefined) {
			type = this._editor.getBlock(blockId)?.type ?? null;
			context.types.set(blockId, type);
		}
		return isListItemType(type);
	}

	/**
	 * The run of consecutive list items around `siblings[index]`, with its
	 * semantics and numbered ordinals recorded in the context. A run is bounded
	 * by non-list siblings, so `getListItemSemantics` and `numberedOrdinals`
	 * over it equal the whole-list result. O(run).
	 */
	private _walkRun(siblings: readonly string[], index: number, context: EventContext): readonly string[] {
		const id = siblings[index];
		if (id === undefined || context.semantics.has(id) || !this._isListItem(id, context)) return EMPTY_IDS;
		let start = index;
		while (start > 0 && this._isListItem(siblings[start - 1] as string, context)) start -= 1;
		let end = index;
		while (end < siblings.length - 1 && this._isListItem(siblings[end + 1] as string, context)) end += 1;
		const run = siblings.slice(start, end + 1);
		for (const [blockId, semantics] of getListItemSemantics(this._editor, run)) {
			context.semantics.set(blockId, semantics);
		}
		const typeOf = (blockId: string) => context.types.get(blockId) ?? null;
		for (const [blockId, ordinal] of numberedOrdinals(this._editor, run, typeOf)) {
			context.ordinals.set(blockId, ordinal);
		}
		return run;
	}

	/**
	 * One list item's slice. Outside a structural commit neither its semantics
	 * nor its ordinal can move — both change only with a sibling list or a
	 * run member's type, indent or `start` — so the previous slice still holds
	 * and a keystroke or caret move in a list item reads no run (W6.R4, SCALE6).
	 */
	private _listFor(
		blockId: string,
		type: string | null,
		context: EventContext,
		previous: BlockListSlice | null | undefined,
		rootIds: readonly string[],
	): BlockListSlice | null {
		if (!isListItemType(type)) return null;
		if (previous && !context.structural) return previous;
		const semantics = this._semanticsFor(blockId, context, rootIds);
		// Ordinals count over the same sibling list as the semantics (AX1);
		// a block in none numbers alone.
		const ordinal =
			type === NUMBERED
				? (context.ordinals.get(blockId) ?? standaloneOrdinal(this._editor.getBlock(blockId)))
				: null;
		return buildListSlice(ordinal, semantics, previous);
	}

	/** One list item's semantics, from the run it sits in now. */
	private _semanticsFor(blockId: string, context: EventContext, rootIds: readonly string[]): ListItemSemantics {
		const cached = context.semantics.get(blockId);
		if (cached) return cached;
		const parentId = this._editor.documentState.parentOf(blockId);
		const siblings = parentId === null ? rootIds : this._siblingsOf(parentId);
		const index = this._positionIn(parentId, siblings, blockId);
		if (index >= 0) this._walkRun(siblings, index, context);
		return context.semantics.get(blockId) ?? { level: 1, posinset: 1, setsize: 1, groupKey: blockId };
	}

	/**
	 * Walks the list runs a structural commit can have changed — around each
	 * changed position of each touched sibling list, and around each block whose
	 * list type, indent or parent changed — and names every item in them, so an
	 * item outside `affectedBlockIds` whose position or set size moved is
	 * notified. Returns each touched parent's changed span. A commit with no
	 * structural change reads nothing (W6.R4).
	 */
	private _collectListSemantics(
		summary: ChangeSummary,
		previousRootIds: readonly string[] | null,
		ids: Set<string>,
		context: EventContext,
	): ReadonlyMap<string | null, ChangedSpan | null> {
		const spans = new Map<string | null, ChangedSpan | null>();
		const touched = this._listTouchedParents(summary);
		for (const [parentId, blockIds] of touched) {
			const siblings = this._siblingsOf(parentId);
			const previous =
				parentId === null
					? previousRootIds
					: (this._entries.get(parentId)?.snapshot.childIds ?? this._segmentBasis.get(parentId) ?? null);
			const around = (index: number) => {
				for (const at of [index - 1, index, index + 1]) {
					for (const runId of this._walkRun(siblings, at, context)) ids.add(runId);
				}
			};
			if (previous === null) {
				for (let index = 0; index < siblings.length; index += 1) around(index);
				spans.set(parentId, null);
				continue;
			}
			const [from, to] = changedRange(previous, siblings);
			spans.set(parentId, { from, to, shift: siblings.length - previous.length, previous });
			for (let index = from; index <= Math.max(from, to); index += 1) around(index);
			for (const blockId of blockIds) {
				const index = this._positionIn(parentId, siblings, blockId);
				if (index >= 0) around(index);
			}
		}
		return spans;
	}

	/** Each sibling list a list-relevant structural change touched, with the blocks it names there. */
	private _listTouchedParents(summary: ChangeSummary): Map<string | null, Set<string>> {
		const touched = new Map<string | null, Set<string>>();
		const state = this._editor.documentState;
		const add = (parentId: string | null | undefined, blockId?: string) => {
			const key = parentId ?? null;
			let blockIds = touched.get(key);
			if (!blockIds) {
				blockIds = new Set();
				touched.set(key, blockIds);
			}
			if (blockId !== undefined) blockIds.add(blockId);
		};
		const addCurrent = (blockId: string) => add(state.parentOf(blockId), blockId);
		// Where the block rendered before the commit, which core's index no
		// longer knows: every cached container listing it — a container's
		// snapshot or the basis of its segment channel — and the parent its
		// own snapshot was built under. Known by none, it rendered in the root.
		const addCached = (blockId: string) => {
			let found = false;
			for (const parentId of this._cachedParentsOf(blockId)) {
				add(parentId);
				found = true;
			}
			for (const parentId of this._segmentParents.get(blockId) ?? EMPTY_IDS) {
				add(parentId);
				found = true;
			}
			const entry = this._entries.get(blockId);
			if (entry) add(entry.parentId);
			else if (!found) add(null);
		};
		for (const change of summary.structural) {
			switch (change.type) {
				case "block-inserted":
					addCurrent(change.blockId);
					break;
				// A `parentId`-route child's summary names no parent; the
				// container that rendered it still lists it (AX1).
				case "block-removed":
					add(change.parentId);
					addCached(change.blockId);
					break;
				// The array a move wrote into is touched even when the index
				// resolves the block elsewhere: concurrent moves can list it in
				// two arrays (COL4) until the next local pass repairs that. A
				// `parentId`-route child moved into an array leaves the container
				// that rendered it, which the summary does not name, and the index
				// may resolve to either route.
				case "block-moved":
					add(change.fromParentId);
					add(change.toParentId);
					addCached(change.blockId);
					addCurrent(change.blockId);
					break;
				case "block-split":
					addCurrent(change.blockId);
					addCurrent(change.newBlockId);
					break;
				// The merge removes its source and names no `block-removed` for
				// it: a `parentId`-route source's container still lists it.
				case "blocks-merged":
					addCurrent(change.targetBlockId);
					addCurrent(change.sourceBlockId);
					// The array the source left, when the commit removed an entry.
					if (change.sourceParentId !== undefined) add(change.sourceParentId);
					addCached(change.sourceBlockId);
					break;
				case "block-props-changed":
					if (!change.keys.some((key) => LIST_SEMANTIC_PROPS.has(key))) break;
					addCurrent(change.blockId);
					if (change.keys.includes("parentId")) addCached(change.blockId);
					break;
				case "table-changed":
				case "apps-changed":
				case "metadata-changed":
					break;
				default: {
					const unhandled: never = change;
					return unhandled;
				}
			}
		}
		return touched;
	}

	// ── Snapshots and delivery ───────────────────────────────

	/**
	 * The context first reads build snapshots in, shared until the next
	 * structural commit, so a mount walks each list run once rather than once
	 * per item. Reads attach first, so commits invalidate it.
	 */
	private _readContext(): EventContext {
		this._sharedReadContext ??= newContext();
		return this._sharedReadContext;
	}

	private _entryFor(blockId: string): Entry {
		let entry = this._entries.get(blockId);
		if (!entry) {
			entry = {
				snapshot: undefined as unknown as BlockSnapshot,
				subscribers: new Set(),
				domSyncVersion: 0,
				lastCommit: undefined,
				parentId: null,
			};
			this._setSnapshot(blockId, entry, this._buildSnapshot(blockId, entry, this._readContext()));
			this._entries.set(blockId, entry);
		}
		return entry;
	}

	private _buildSnapshot(blockId: string, entry: Entry, context: EventContext): BlockSnapshot {
		const previous = entry.snapshot as BlockSnapshot | undefined;
		const editor = this._editor;
		const commit = buildCommitSlice(editor, blockId, entry.lastCommit, previous?.commit);
		const document = this.getDocumentSnapshot();
		const next: BlockSnapshot = {
			blockId,
			commit,
			selection: buildSelectionSlice(editor, this._selection, this._selected, blockId, previous?.selection),
			field: buildFieldSlice(editor, this._store, blockId, entry.domSyncVersion, previous?.field),
			decorations: editor.getDecorations().forBlock(blockId),
			childIds: this._childIdsFor(blockId, previous),
			list: this._listFor(blockId, commit.type, context, previous?.list, document.rootIds),
			isPlaceholderTarget: document.placeholderTargetBlockId === blockId,
			inlineCompletion: this._completionFor(blockId, previous),
			inlineCompletionVisible: this._visibleCompletion() !== null,
		};
		return previous && snapshotsEqual(previous, next) ? previous : next;
	}

	private _childIdsFor(blockId: string, previous: BlockSnapshot | undefined): readonly string[] {
		const childIds = this._editor.documentState.childrenOf(blockId);
		return previous && arraysEqual(previous.childIds, childIds) ? previous.childIds : [...childIds];
	}

	private _visibleCompletion(): InlineCompletionSuggestion | null {
		const controller = this._completion ?? getInlineCompletionController(this._editor);
		return controller?.getState().visibleSuggestion ?? null;
	}

	private _completionFor(blockId: string, previous: BlockSnapshot | undefined): InlineCompletionSuggestion | null {
		const suggestion = this._visibleCompletion();
		const mine = suggestion?.blockId === blockId ? suggestion : null;
		return previous?.inlineCompletion === mine ? previous.inlineCompletion : mine;
	}

	private _deliver(kind: BlockNotifierEventKind, ids: Iterable<string>, context: EventContext = newContext()): void {
		const changed: string[] = [];
		for (const id of new Set(ids)) {
			const entry = this._entries.get(id);
			if (!entry) continue;
			// A snapshot read without a subscriber lives until a commit names
			// it; the next read rebuilds it (SCALE4).
			if (kind === "commit" && entry.subscribers.size === 0) {
				this._forget(id, entry);
				continue;
			}
			const next = this._buildSnapshot(id, entry, context);
			if (next === entry.snapshot) continue;
			this._setSnapshot(id, entry, next);
			changed.push(id);
		}
		this._fanout[kind] = changed.length;
		for (const id of changed) {
			const entry = this._entries.get(id);
			if (entry) this._notifyAll(entry.subscribers);
		}
		if (changed.length > 0) {
			for (const subscriber of [...this._changeSubscribers]) {
				this._deliveries += 1;
				subscriber(changed);
			}
		}
	}

	/** Stores a snapshot, moving its children in the cached parent map when they changed. */
	private _setSnapshot(blockId: string, entry: Entry, next: BlockSnapshot): void {
		const previous = entry.snapshot as BlockSnapshot | undefined;
		entry.snapshot = next;
		entry.parentId = this._editor.documentState.parentOf(blockId);
		if (previous?.childIds === next.childIds) return;
		if (previous) this._unlinkChildren(blockId, previous.childIds);
		for (const childId of next.childIds) {
			let parents = this._cachedParents.get(childId);
			if (!parents) {
				parents = new Set();
				this._cachedParents.set(childId, parents);
			}
			parents.add(blockId);
		}
	}

	private _unlinkChildren(blockId: string, childIds: readonly string[]): void {
		for (const childId of childIds) {
			const parents = this._cachedParents.get(childId);
			if (!parents) continue;
			parents.delete(blockId);
			if (parents.size === 0) this._cachedParents.delete(childId);
		}
	}

	private _forget(blockId: string, entry: Entry): void {
		this._entries.delete(blockId);
		this._unlinkChildren(blockId, entry.snapshot.childIds);
	}

	private _clearEntries(): void {
		this._entries.clear();
		this._cachedParents.clear();
	}

	private _notifyAll(subscribers: ReadonlySet<() => void>): void {
		for (const subscriber of [...subscribers]) {
			this._deliveries += 1;
			subscriber();
		}
	}
}

function endpoints(selection: SelectionState | null): string[] {
	if (!selection) return [];
	switch (selection.type) {
		case "text":
			return [selection.anchor.blockId, selection.focus.blockId];
		case "block":
			return selection.head ? [selection.head] : [];
		case "cell":
			return [selection.blockId];
		case "app":
			return [];
		default: {
			const unhandled: never = selection;
			return unhandled;
		}
	}
}

/** Blocks whose field slice may have moved between two store snapshots. */
function fieldChangedIds(
	previous: FieldEditorStoreSnapshot | null,
	next: FieldEditorStoreSnapshot | null,
): string[] {
	const ids = [
		previous?.focusBlockId,
		next?.focusBlockId,
		previous?.activeCellCoord?.blockId,
		next?.activeCellCoord?.blockId,
		...activeIdsIfChanged(previous, next),
	];
	return [...new Set(ids.filter((id): id is string => typeof id === "string"))];
}

const NO_ACTIVE: Pick<FieldEditorStoreSnapshot, "mode" | "activeBlockIds"> = {
	mode: "inactive",
	activeBlockIds: EMPTY_IDS,
};

function activeIdsIfChanged(
	previous: FieldEditorStoreSnapshot | null,
	next: FieldEditorStoreSnapshot | null,
): readonly string[] {
	const before = previous ?? NO_ACTIVE;
	const after = next ?? NO_ACTIVE;
	if (before.mode === after.mode && before.activeBlockIds === after.activeBlockIds) return EMPTY_IDS;
	return [...before.activeBlockIds, ...after.activeBlockIds];
}

function structuralBlockIds(change: ChangeSummary["structural"][number]): string[] {
	if (change.type === "block-split") return [change.blockId, change.newBlockId];
	if (change.type === "blocks-merged") return [change.targetBlockId, change.sourceBlockId];
	return "blockId" in change ? [change.blockId] : [];
}

function snapshotsEqual(previous: BlockSnapshot, next: BlockSnapshot): boolean {
	return (
		previous.commit === next.commit &&
		previous.selection === next.selection &&
		previous.field === next.field &&
		previous.decorations === next.decorations &&
		previous.childIds === next.childIds &&
		previous.list === next.list &&
		previous.isPlaceholderTarget === next.isPlaceholderTarget &&
		previous.inlineCompletion === next.inlineCompletion &&
		previous.inlineCompletionVisible === next.inlineCompletionVisible
	);
}

function segmentsEqual(left: readonly BlockListSegment[], right: readonly BlockListSegment[]): boolean {
	return (
		left.length === right.length &&
		left.every((segment, index) => {
			const other = right[index];
			if (!other || segment.kind !== other.kind) return false;
			if (segment.kind === "block") return segment.blockId === (other as typeof segment).blockId;
			const list = other as typeof segment;
			return segment.key === list.key && arraysEqual(segment.blockIds, list.blockIds);
		})
	);
}

/** Position indexes per sibling array; arrays are identity-stable until their list changes. */
const siblingIndexes = new WeakMap<readonly string[], Map<string, number>>();

function indexIn(siblings: readonly string[], blockId: string): number {
	let index = siblingIndexes.get(siblings);
	if (!index) {
		index = new Map(siblings.map((id, at) => [id, at]));
		siblingIndexes.set(siblings, index);
	}
	return index.get(blockId) ?? -1;
}

/**
 * The range of `next` that differs from `previous` after their common prefix
 * and suffix: `[from, to]`, with `to === from - 1` for a pure removal at `from`.
 */
function changedRange(previous: readonly string[], next: readonly string[]): readonly [number, number] {
	let from = 0;
	const shorter = Math.min(previous.length, next.length);
	while (from < shorter && previous[from] === next[from]) from += 1;
	let suffix = 0;
	while (
		suffix < shorter - from &&
		previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
	) {
		suffix += 1;
	}
	return [from, next.length - 1 - suffix];
}

/**
 * The sibling list's segments from its previous segments plus the runs this
 * event walked: a walked block takes its new group (or none), every other
 * block keeps its old one. Equal to `getListSegments` over `siblings` because
 * the walk covered every run a change could reach.
 */
function patchSegments(
	previous: readonly BlockListSegment[],
	siblings: readonly string[],
	context: EventContext,
): readonly BlockListSegment[] {
	return segmentRun(siblings, previous, context);
}

/**
 * Segments of `blockIds`: each takes its walked group, none when the walk read
 * it as a non-list block, or else its group in `previous`.
 */
function segmentRun(
	blockIds: readonly string[],
	previous: readonly BlockListSegment[],
	context: EventContext,
): BlockListSegment[] {
	const previousGroup = new Map<string, string>();
	for (const segment of previous) {
		if (segment.kind === "list") for (const blockId of segment.blockIds) previousGroup.set(blockId, segment.key);
	}
	const segments: BlockListSegment[] = [];
	let current = null as { key: string; blockIds: string[] } | null;
	for (const blockId of blockIds) {
		const walked = context.semantics.get(blockId);
		const groupKey = walked
			? walked.groupKey
			: context.types.has(blockId)
				? null
				: (previousGroup.get(blockId) ?? null);
		if (groupKey === null) {
			current = null;
			segments.push({ kind: "block", blockId });
			continue;
		}
		if (current?.key !== groupKey) {
			current = { key: groupKey, blockIds: [] };
			segments.push({ kind: "list", key: groupKey, blockIds: current.blockIds });
		}
		current.blockIds.push(blockId);
	}
	return segments;
}

function segmentLength(segment: BlockListSegment): number {
	return segment.kind === "block" ? 1 : segment.blockIds.length;
}

/** Joins adjacent list segments that share a key: `getListSegments` never splits one group. */
function coalesce(segments: readonly BlockListSegment[]): BlockListSegment[] {
	const out: BlockListSegment[] = [];
	for (const segment of segments) {
		const last = out[out.length - 1];
		if (last?.kind === "list" && segment.kind === "list" && last.key === segment.key) {
			out[out.length - 1] = { kind: "list", key: last.key, blockIds: [...last.blockIds, ...segment.blockIds] };
			continue;
		}
		out.push(segment);
	}
	return out;
}

/**
 * `patchSegments` over only the segments new positions `[from, to]` reach,
 * where `[from, to]` covers the changed span and every block the run walk
 * read: positions before `from` are the previous list's, and positions after
 * `to` are the previous list's shifted by `shift`. The window's edges are
 * found by one pass over the segment lengths up to it, with nothing built
 * per list, and the segments outside it are kept by identity (SCALE2).
 * Returns `previous` when the window's segments are unchanged.
 */
function patchSegmentRange(
	previous: readonly BlockListSegment[],
	siblings: readonly string[],
	from: number,
	to: number,
	shift: number,
	context: EventContext,
): readonly BlockListSegment[] {
	const previousTo = to - shift;
	// The first segment ending after `from`, and the last starting at or
	// before `previousTo`, in previous positions.
	let first = previous.length;
	let firstStart = 0;
	let last = -1;
	let lastEnd = 0;
	let start = 0;
	for (let k = 0; k < previous.length; k += 1) {
		if (first < previous.length && start > previousTo) break;
		const end = start + segmentLength(previous[k] as BlockListSegment);
		if (first === previous.length && end > from) {
			first = k;
			firstStart = start;
		}
		if (start <= previousTo) {
			last = k;
			lastEnd = end;
		}
		start = end;
	}
	if (first === previous.length) firstStart = start;
	if (last < first) {
		last = first - 1;
		lastEnd = firstStart;
	}
	// One neighbour each side joins the window, so a group the edit rejoined
	// across its seam merges as `getListSegments` would.
	const windowStart = first > 0 ? first - 1 : first;
	const windowEnd = last + 1 < previous.length ? last + 2 : last + 1;
	const replaced = previous.slice(windowStart, windowEnd);
	const next = coalesce([
		...previous.slice(windowStart, first),
		...segmentRun(siblings.slice(firstStart, lastEnd + shift), previous.slice(first, last + 1), context),
		...previous.slice(last + 1, windowEnd),
	]);
	if (segmentsEqual(replaced, next)) return previous;
	const patched = previous.slice();
	patched.splice(windowStart, windowEnd - windowStart, ...next);
	return patched;
}
