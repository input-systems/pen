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
import { numberedRunOrdinals } from "../utils/numberedListRun";
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
}

/** Per-event scratch: ordinals and list semantics are computed once per touched run. */
interface EventContext {
	/** Only a structural commit can move list semantics; any other event keeps each item's slice. */
	readonly structural: boolean;
	readonly ordinals: Map<string, number>;
	/** AX1 semantics of every item of each list run walked in this event. */
	readonly semantics: Map<string, ListItemSemantics>;
	/** Whether a block is a list item, for every sibling the run walk read. */
	readonly listItems: Map<string, boolean>;
}

function newContext(structural = false): EventContext {
	return { structural, ordinals: new Map(), semantics: new Map(), listItems: new Map() };
}

const NUMBERED = "numberedListItem";
const LIST_PROPS = new Set(["type", "indent", "start"]);
/** Props whose change can move a block into, out of, or within a list group (AX1). */
const LIST_SEMANTIC_PROPS = new Set(["type", "indent", "parentId"]);
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
	/**
	 * COL4: ids still in an order array whose block a concurrent delete
	 * removed. Remote commits do not normalize, and a delete that only drops
	 * the block map entry names no structural change, so renderers skip these.
	 */
	private readonly _deadIds = new Set<string>();
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
				this._entries.delete(blockId);
			}
			this._detachIfIdle();
		};
	}

	getBlockSnapshot(blockId: string): BlockSnapshot {
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
		const unsubscribe = this._subscribeTo(set, onChange);
		return () => {
			unsubscribe();
			if (set.size === 0) {
				this._segmentSubscribers.delete(parentId);
				this._segments.delete(parentId);
			}
		};
	}

	getListSegments(parentId: string | null): readonly BlockListSegment[] {
		const cached = this._segments.get(parentId);
		// Subscribed and attached, commits keep the cache current.
		if (cached && this._segmentSubscribers.has(parentId) && this._sources.length > 0) return cached;
		// Otherwise read now, keeping the previous identity while equal, so a
		// render-before-subscribe read is stable (useSyncExternalStore).
		const next = this._buildSegments(parentId);
		const segments = cached && segmentsEqual(cached, next) ? cached : next;
		this._segments.set(parentId, segments);
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
		this._entries.clear();
		this._changeSubscribers.clear();
		this._documentSubscribers.clear();
		this._surfaceSubscribers.clear();
		this._segmentSubscribers.clear();
		this._segments.clear();
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
		this._entries.clear();
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
			this._collectListRuns(summary, ids, context);
		}
		const liveness = this._trackDeadIds(summary);
		this._updateDocument(summary.structural.length > 0 || liveness, ids);
		// AX1: the sibling lists a structural commit touched, walked run by run.
		const listParents = this._collectListSemantics(summary, previousRootIds, ids, context);
		// Sibling lists re-sync before blocks hear the commit, as the document
		// channel does: a removed block's node is gone before its slice is read.
		if (listParents.size > 0) this._refreshSegments(listParents, context);
		this._deliver("commit", ids, context);
	}

	/**
	 * Whether a block died or came back. Only `block-removed` ids are checked
	 * for liveness, so a text commit reads nothing (SCALE2).
	 */
	private _trackDeadIds(summary: ChangeSummary): boolean {
		let changed = false;
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
		const previous = this._selection;
		this._selection = this._editor.selection;
		const ids = new Set<string>([...endpoints(previous), ...endpoints(this._selection)]);
		this._reselect(ids);
		this._deliver("selection", ids);
	}

	private _onField(): void {
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
		this._deliver("decorations", changed ?? [...this._entries.keys()]);
	}

	private _onCompletion(): void {
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
						parents.push(this._cachedParentOf(change.blockId), this._editor.documentState.parentOf(change.blockId));
					}
					break;
				default:
					break;
			}
			// The parentId route: a root-order insert or removal can still change
			// a container's children.
			for (const id of structuralBlockIds(change)) {
				parents.push(this._editor.documentState.parentOf(id), this._cachedParentOf(id));
			}
		}
		return parents.filter((id): id is string => typeof id === "string");
	}

	private _cachedParentOf(blockId: string): string | null {
		for (const [id, entry] of this._entries) {
			if (entry.snapshot.childIds.includes(blockId)) return id;
		}
		return null;
	}

	/**
	 * Numbered runs around each structural position: every item whose ordinal
	 * may have moved is named, and the run's ordinals are computed once.
	 */
	private _collectListRuns(summary: ChangeSummary, ids: Set<string>, context: EventContext): void {
		const state = this._editor.documentState;
		for (const position of listPositions(this._editor, summary)) {
			for (const at of [position - 1, position, position + 1]) {
				const id = state.blockAt(at);
				if (id !== null && !context.ordinals.has(id)) this._addRun(id, ids, context);
			}
		}
	}

	private _addRun(blockId: string, ids: Set<string>, context: EventContext): void {
		if (this._editor.getBlock(blockId)?.type !== NUMBERED) return;
		for (const [runId, ordinal] of numberedRunOrdinals(this._editor, blockId)) {
			context.ordinals.set(runId, ordinal);
			ids.add(runId);
		}
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
		if (this._deadIds.size === 0) return rootIds;
		for (const id of this._deadIds) {
			if (this._editor.documentState.indexOf(id) < 0) this._deadIds.delete(id);
		}
		return rootIds.filter((id) => !this._deadIds.has(id));
	}

	/** The sibling list a parent renders: the live root ids, or `childrenOf` (RI6). */
	private _siblingsOf(parentId: string | null): readonly string[] {
		return parentId === null
			? this.getDocumentSnapshot().rootIds
			: this._editor.documentState.childrenOf(parentId);
	}

	/** A whole sibling list through `getListSegments`. */
	private _buildSegments(parentId: string | null): readonly BlockListSegment[] {
		return getListSegments(this._editor, this._siblingsOf(parentId));
	}

	/**
	 * Re-segments each subscribed parent the commit's list walk touched. A
	 * cached parent is patched from its previous segments and the runs the walk
	 * recomputed, so an edit reads only the runs around it (SCALE6).
	 */
	private _refreshSegments(parents: ReadonlySet<string | null>, context: EventContext): void {
		for (const parentId of parents) {
			const subscribers = this._segmentSubscribers.get(parentId);
			if (!subscribers) continue;
			const previous = this._segments.get(parentId);
			const next = previous
				? patchSegments(previous, this._siblingsOf(parentId), context)
				: this._buildSegments(parentId);
			if (previous && segmentsEqual(previous, next)) continue;
			this._segments.set(parentId, next);
			this._notifyAll(subscribers);
		}
	}

	// ── List semantics (AX1) ─────────────────────────────────

	private _isListItem(blockId: string, context: EventContext): boolean {
		let known = context.listItems.get(blockId);
		if (known === undefined) {
			known = isListItemType(this._editor.getBlock(blockId)?.type);
			context.listItems.set(blockId, known);
		}
		return known;
	}

	/**
	 * The run of consecutive list items around `siblings[index]`, with its
	 * semantics recorded in the context. A run is bounded by non-list siblings,
	 * so `getListItemSemantics` over it equals the whole-list result. O(run).
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
		return run;
	}

	/**
	 * One list item's semantics, from the run it sits in now. Outside a
	 * structural commit the previous slice still holds, so typing in a list
	 * item reads no run (W6.R4).
	 */
	private _semanticsFor(
		blockId: string,
		type: string | null,
		context: EventContext,
		previous: BlockListSlice | null | undefined,
		rootIds: readonly string[],
	): ListItemSemantics | null {
		if (!isListItemType(type)) return null;
		if (previous && !context.structural) return previous;
		const cached = context.semantics.get(blockId);
		if (cached) return cached;
		const parentId = this._editor.documentState.parentOf(blockId);
		const siblings = parentId === null ? rootIds : this._siblingsOf(parentId);
		const index = indexIn(siblings, blockId);
		if (index >= 0) this._walkRun(siblings, index, context);
		return context.semantics.get(blockId) ?? { level: 1, posinset: 1, setsize: 1, groupKey: blockId };
	}

	/**
	 * Walks the list runs a structural commit can have changed — around each
	 * changed position of each touched sibling list, and around each block whose
	 * list type, indent or parent changed — and names every item in them, so an
	 * item outside `affectedBlockIds` whose position or set size moved is
	 * notified. Returns the touched parents. A commit with no structural change
	 * reads nothing (W6.R4).
	 */
	private _collectListSemantics(
		summary: ChangeSummary,
		previousRootIds: readonly string[] | null,
		ids: Set<string>,
		context: EventContext,
	): ReadonlySet<string | null> {
		const touched = this._listTouchedParents(summary);
		for (const [parentId, blockIds] of touched) {
			const siblings = this._siblingsOf(parentId);
			const previous =
				parentId === null ? previousRootIds : (this._entries.get(parentId)?.snapshot.childIds ?? null);
			const around = (index: number) => {
				for (const at of [index - 1, index, index + 1]) {
					for (const runId of this._walkRun(siblings, at, context)) ids.add(runId);
				}
			};
			if (previous === null) {
				for (let index = 0; index < siblings.length; index += 1) around(index);
				continue;
			}
			const [from, to] = changedRange(previous, siblings);
			for (let index = from; index <= Math.max(from, to); index += 1) around(index);
			for (const blockId of blockIds) {
				const index = indexIn(siblings, blockId);
				if (index >= 0) around(index);
			}
		}
		return new Set(touched.keys());
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
		for (const change of summary.structural) {
			switch (change.type) {
				case "block-inserted":
					addCurrent(change.blockId);
					break;
				// A `parentId`-route child's summary names no parent; the
				// container that rendered it still lists it (AX1).
				case "block-removed":
					add(change.parentId);
					add(this._cachedParentOf(change.blockId));
					break;
				case "block-moved":
					add(change.fromParentId);
					addCurrent(change.blockId);
					break;
				case "block-split":
					addCurrent(change.blockId);
					addCurrent(change.newBlockId);
					break;
				case "blocks-merged":
					addCurrent(change.targetBlockId);
					addCurrent(change.sourceBlockId);
					break;
				case "block-props-changed":
					if (!change.keys.some((key) => LIST_SEMANTIC_PROPS.has(key))) break;
					addCurrent(change.blockId);
					if (change.keys.includes("parentId")) add(this._cachedParentOf(change.blockId));
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
	 * The context first reads build snapshots in. Attached, it is shared until
	 * the next structural commit, so a mount walks each list run once rather
	 * than once per item; detached, nothing invalidates it, so each read is fresh.
	 */
	private _readContext(): EventContext {
		if (this._sources.length === 0) return newContext();
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
			};
			entry.snapshot = this._buildSnapshot(blockId, entry, this._readContext());
			this._entries.set(blockId, entry);
		}
		return entry;
	}

	private _buildSnapshot(blockId: string, entry: Entry, context: EventContext): BlockSnapshot {
		const previous = entry.snapshot as BlockSnapshot | undefined;
		const editor = this._editor;
		const commit = buildCommitSlice(editor, blockId, entry.lastCommit, previous?.commit);
		// Read once: detached, each read rebuilds the root ids.
		const document = this.getDocumentSnapshot();
		const next: BlockSnapshot = {
			blockId,
			commit,
			selection: buildSelectionSlice(editor, this._selectionFor(), this._selectedFor(), blockId, previous?.selection),
			field: buildFieldSlice(editor, this._storeFor(), blockId, entry.domSyncVersion, previous?.field),
			decorations: editor.getDecorations().forBlock(blockId),
			childIds: this._childIdsFor(blockId, previous),
			list: buildListSlice(
				this._ordinalFor(blockId, commit.type, context),
				this._semanticsFor(blockId, commit.type, context, previous?.list, document.rootIds),
				previous?.list,
			),
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

	private _selectionFor(): SelectionState | null {
		return this._sources.length > 0 ? this._selection : this._editor.selection;
	}

	private _selectedFor(): ReadonlySet<string> {
		// Detached: compute on demand so a render-before-subscribe read is current.
		return this._sources.length > 0
			? this._selected
			: new Set(selectedBlockIds(this._editor, this._editor.selection));
	}

	private _storeFor(): FieldEditorStoreSnapshot | null {
		return this._sources.length > 0 ? this._store : (this._fieldEditor?.getSnapshot() ?? null);
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

	private _ordinalFor(blockId: string, type: string | null, context: EventContext): number | null {
		if (type !== NUMBERED) return null;
		if (!context.ordinals.has(blockId)) {
			for (const [id, ordinal] of numberedRunOrdinals(this._editor, blockId)) {
				context.ordinals.set(id, ordinal);
			}
		}
		return context.ordinals.get(blockId) ?? null;
	}

	private _deliver(kind: BlockNotifierEventKind, ids: Iterable<string>, context: EventContext = newContext()): void {
		this._dropUnsubscribed();
		const changed: string[] = [];
		for (const id of new Set(ids)) {
			const entry = this._entries.get(id);
			if (!entry) continue;
			const next = this._buildSnapshot(id, entry, context);
			if (next === entry.snapshot) continue;
			entry.snapshot = next;
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

	/** Snapshots read without a subscriber live until the next event (SCALE4). */
	private _dropUnsubscribed(): void {
		for (const [id, entry] of this._entries) {
			if (entry.subscribers.size === 0) this._entries.delete(id);
		}
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

/** Root-order positions a structural commit touched that can move list ordinals. */
function listPositions(editor: Editor, summary: ChangeSummary): Set<number> {
	const positions = new Set<number>();
	for (const change of summary.structural) {
		if (change.type === "block-props-changed" && !change.keys.some((key) => LIST_PROPS.has(key))) continue;
		for (const id of structuralBlockIds(change)) {
			const index = editor.documentState.indexOf(id);
			if (index >= 0) positions.add(index);
		}
		// Where a block left the root order: the run it left may renumber.
		const vacated = vacatedRootIndex(change);
		if (vacated !== null) positions.add(vacated);
	}
	return positions;
}

function vacatedRootIndex(change: ChangeSummary["structural"][number]): number | null {
	if (change.type === "block-removed" && change.parentId === null) return change.index;
	if (change.type === "block-moved" && change.fromParentId === null) return change.fromIndex;
	return null;
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
	const previousGroup = new Map<string, string>();
	for (const segment of previous) {
		if (segment.kind === "list") for (const blockId of segment.blockIds) previousGroup.set(blockId, segment.key);
	}
	const segments: BlockListSegment[] = [];
	let current = null as { key: string; blockIds: string[] } | null;
	for (const blockId of siblings) {
		const walked = context.semantics.get(blockId);
		const groupKey = walked
			? walked.groupKey
			: context.listItems.has(blockId)
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
