import type {
	CellSelection,
	Decoration,
	InlineCompletionSuggestion,
	OpOrigin,
	Unsubscribe,
} from "@input/pen-types";

/** Model state of one block. `revision` is `editor.getBlockRevision(blockId)`. */
export interface BlockCommitSlice {
	readonly exists: boolean;
	readonly type: string | null;
	readonly props: Readonly<Record<string, unknown>> | null;
	readonly revision: number;
	/** Origin and id of the last commit that named this block; null until one does. */
	readonly lastOrigin: OpOrigin | null;
	readonly lastCommitId: number;
}

/**
 * This block's share of the editor selection. `inSelection` is exactly
 * `isBlockSelected(documentState.blockOrder, selection, blockId)`: a text
 * selection's range over `blockOrder` (children-array children are not in
 * it), a block selection's ids, a cell selection's table.
 */
export interface BlockSelectionSlice {
	readonly inSelection: boolean;
	readonly isAnchor: boolean;
	readonly isFocus: boolean;
	/** A collapsed text selection whose focus is in this block. */
	readonly caretHere: boolean;
	/** This block's part of a text selection; `to: "end"` for a block the range continues past. */
	readonly textRange: { readonly from: number; readonly to: number | "end" } | null;
	readonly cell: CellSelection | null;
}

/** Field-editor state as it concerns one block. */
export interface BlockFieldSlice {
	readonly isFieldFocus: boolean;
	readonly isEditing: boolean;
	readonly isComposing: boolean;
	/** The block's expanded-mode role when it is active in an expanded surface, else null. */
	readonly expandedRole: "editable-inline" | "structural" | "delegated" | null;
	/** Bumped by `markDomSynced(blockId)` only. */
	readonly domSyncVersion: number;
	readonly activeCell: { readonly row: number; readonly col: number } | null;
}

/** List-run state of one block. W6 adds its run fields here. */
export interface BlockListSlice {
	/** `numberedListItem` value with `getNumberedListItemValue`'s semantics; null for other types. */
	readonly ordinal: number | null;
}

/** One list segment of a sibling list. */
export type BlockListSegment =
	| { readonly kind: "list"; readonly key: string; readonly blockIds: readonly string[] }
	| { readonly kind: "block"; readonly blockId: string };

export interface BlockSnapshot {
	readonly blockId: string;
	readonly commit: BlockCommitSlice;
	readonly selection: BlockSelectionSlice;
	readonly field: BlockFieldSlice;
	/** Identity from `editor.getDecorations().forBlock(blockId)`. */
	readonly decorations: readonly Decoration[];
	/** Identity-stable copy of `documentState.childrenOf(blockId)`. */
	readonly childIds: readonly string[];
	/** null for blocks that are not list items. */
	readonly list: BlockListSlice | null;
	readonly isPlaceholderTarget: boolean;
	/** The visible inline completion when it targets this block, else null. */
	readonly inlineCompletion: InlineCompletionSuggestion | null;
}

/** List-level field state. Never changes on a DOM sync. */
export interface SurfaceSnapshot {
	readonly mode: "inactive" | "single" | "expanded" | "block";
	readonly activeBlockIds: readonly string[];
	readonly focusBlockId: string | null;
	readonly isFocused: boolean;
	readonly isEditing: boolean;
	readonly isComposing: boolean;
}

/** Document-level state, identity-stable while unchanged. */
export interface DocumentSnapshot {
	/** `getRootBlockIds(editor)`, recomputed only on structural commits. */
	readonly rootIds: readonly string[];
	readonly isEmpty: boolean;
	readonly placeholderTargetBlockId: string | null;
}

export type BlockNotifierEventKind =
	| "commit"
	| "selection"
	| "field"
	| "decorations"
	| "completion"
	| "domSync";

/** Plain counters, always on, like `DomScheduler.diagnostics.measureNowCount` (SCH2). */
export interface BlockNotifierDiagnostics {
	/** Live subscriptions the notifier holds on the editor, the store and the completion controller. */
	readonly sourceSubscriptions: number;
	readonly blockSubscribers: number;
	readonly changeSubscribers: number;
	readonly cachedSnapshots: number;
	/** Per-block callbacks invoked since creation. */
	readonly deliveries: number;
	/** Distinct blocks notified by the last event of each kind. */
	readonly lastFanout: Readonly<Record<BlockNotifierEventKind, number>>;
}

/**
 * Per-block fan-out of commit, selection, field-editor, decoration and inline
 * completion state (SCALE6). A binding subscribes per block here instead of
 * per block on the editor, so a mounted surface holds a constant number of
 * editor-level subscriptions and an event notifies only the blocks whose own
 * state changed.
 */
export interface BlockNotifier {
	subscribeBlock(blockId: string, onChange: () => void): Unsubscribe;
	getBlockSnapshot(blockId: string): BlockSnapshot;
	/** One callback per event with the distinct ids notified by it. */
	subscribeChanges(onChange: (blockIds: readonly string[]) => void): Unsubscribe;
	subscribeDocument(onChange: () => void): Unsubscribe;
	getDocumentSnapshot(): DocumentSnapshot;
	subscribeSurface(onChange: () => void): Unsubscribe;
	getSurfaceSnapshot(): SurfaceSnapshot;
	/** Parent-keyed channel for sibling loops; `null` is the root list. */
	subscribeListSegments(parentId: string | null, onChange: () => void): Unsubscribe;
	getListSegments(parentId: string | null): readonly BlockListSegment[];
	/** Bump one block's `field.domSyncVersion`; null means the surface's focus or active blocks. */
	markDomSynced(blockId: string | null): void;
	readonly diagnostics: BlockNotifierDiagnostics;
	/** Drop every subscriber and source subscription. A later subscribe re-attaches. */
	destroy(): void;
}
