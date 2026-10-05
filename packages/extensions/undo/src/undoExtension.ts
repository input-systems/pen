import type {
	Anchor,
	CRDTUndoStackItem,
	Editor,
	Extension,
	FieldEditor,
	HistoryAppliedEvent,
	OpOrigin,
	SelectionRecordState,
	SelectionState,
	SelectionWriteOptions,
	UndoHistoryMetadataController,
	UndoHistoryMetadataEntry,
	UndoHistoryMetadataRestoreContext,
	Unsubscribe,
} from "@input/pen-types";
import {
	UNDO_HISTORY_METADATA_CONTROLLER_SLOT_KEY,
	UNDO_HISTORY_RESTORE_SLOT_KEY,
} from "@input/pen-types";
import {
	deriveContentMoves,
	fieldEditorHostFacet,
	repairAnchor,
} from "@input/pen-core";
import { getOpOriginType } from "./origin";
import { UndoManagerImpl } from "./undoManager";

/**
 * Default undo/redo stack depth (CH7).
 * Y.UndoManager has no native cap; the Yjs adapter trims oldest stack
 * items past this limit so streaming writes cannot grow history without bound.
 */
export const DEFAULT_UNDO_MAX_DEPTH = 500;

export interface UndoExtensionOptions {
	groupTimeout?: number;
	trackedOrigins?: OpOrigin[];
	/**
	 * Maximum undo/redo stack items to retain.
	 * @default DEFAULT_UNDO_MAX_DEPTH
	 */
	maxDepth?: number;
}

/**
 * ## Yjs event ordering (confirmed from Yjs v13.6.29 source)
 *
 * ### User edits:
 *   When `captureTimeout > 0`, Yjs merges transactions within the timeout:
 *   - First transaction → new StackItem → emits "stack-item-added"
 *   - Subsequent transactions within captureTimeout → merged into existing
 *     StackItem → emits "stack-item-updated" (same item reference)
 *   - After idle timer fires → Pen calls stopCapturing() → next transaction
 *     starts a new StackItem
 *
 *   This gives us "undo by phrase" grouping driven by Yjs's captureTimeout
 *   (matching the spec's groupTimeout, default 400ms). Pen's idle timer
 *   adds additional boundaries at explicit points (paste, cut, drop,
 *   block switch, etc.) via stopCapturing().
 *
 * ### During undo():
 *   1. transact() reverses CRDT changes
 *   2. afterTransactionHandler → new StackItem pushed to redoStack
 *      → emits "stack-item-added" (kind="redo")
 *   3. popStackItem completes → emits "stack-item-popped" (kind="undo")
 *
 * ### During redo(): same pattern, stacks swapped.
 * All events fire synchronously within undo()/redo().
 *
 * ## Cursor metadata strategy
 *
 * Each StackItem carries two cursor snapshots in Yjs's built-in meta map:
 *
 *   - CURSOR_BEFORE: cursor state BEFORE the edit group
 *   - CURSOR_AFTER:  cursor state AFTER the edit group
 *
 * ### User edits:
 *   - `stack-item-added`: CURSOR_BEFORE captured synchronously (selection
 *     hasn't moved yet — Yjs fires this inside transact()). A microtask is
 *     scheduled to capture CURSOR_AFTER once the selection settles.
 *   - `stack-item-updated`: Yjs merged another transaction into the same
 *     group. We schedule a fresh microtask to overwrite CURSOR_AFTER with
 *     the latest cursor position. The CURSOR_BEFORE from the original
 *     `stack-item-added` is preserved (it represents the start of the group).
 *
 * ### Undo/redo cycles:
 *   `stack-item-added` fires first (new reverse item), then `stack-item-popped`.
 *   We stash the new item reference in `pendingReverseItem`. When
 *   `stack-item-popped` fires, we copy the popped item's metadata onto
 *   the reverse item (before→before, after→after).
 *
 *   `manager._isHistoryOperation` (set by UndoManagerImpl around undo/redo)
 *   tells us which branch to take — no microtask races, no parallel stacks.
 *
 * ### On stack-item-popped, we restore:
 *   - undo → CURSOR_BEFORE (cursor position before the edit was made)
 *   - redo → CURSOR_AFTER  (cursor position after the edit was made)
 *
 * ### Selection restore ordering:
 *   We restore the logical editor selection first, then emit a dedicated
 *   `historyApplied` editor event. The field-editor layer uses that event only
 *   to resync selection/caret state without coupling history lifecycle to the
 *   generic selectionChange path.
 */
export function undoExtension(options?: UndoExtensionOptions): Extension {
	let activeEditor: Editor | null = null;
	let manager: UndoManagerImpl | null = null;
	let unsubscribeStackItemAdded: (() => void) | null = null;
	let unsubscribeStackItemUpdated: (() => void) | null = null;
	let unsubscribeStackItemPopped: (() => void) | null = null;
	let unsubscribeCommit: Unsubscribe | null = null;
	let unsubscribeSelection: Unsubscribe | null = null;
	let historyRestoreRequestId = 0;
	const trackedOrigins = new Set<OpOrigin>(
		options?.trackedOrigins ?? DEFAULT_TRACKED_ORIGINS,
	);

	return {
		name: "undo",
		version: "0.0.0",

		activateClient: async (ctx) => {
			activeEditor = ctx.editor;
			const { adapter, crdtDoc } = ctx.editor.internals;

			const crdtUndo = adapter.createUndoManager(crdtDoc, {
				trackedOriginTypes: [...trackedOrigins].map(getOpOriginType),
				captureTimeout: options?.groupTimeout ?? 400,
				maxDepth: options?.maxDepth ?? DEFAULT_UNDO_MAX_DEPTH,
			});

			let pendingReverseItem: CRDTUndoStackItem | null = null;
			let activeUndoStackItem: CRDTUndoStackItem | null = null;
			let afterCaptureVersion = 0;
			const driftById = new Map<string, CursorDrift>();
			let driftSeq = 0;
			let liveCaret: DriftPair | null = heldDrift(
				ctx.editor,
				ctx.editor.selection,
			);
			unsubscribeSelection = ctx.editor.onSelectionChange((record) => {
				if (manager?._isHistoryOperation) {
					return;
				}
				liveCaret = heldDrift(ctx.editor, record.state);
			});
			function driftIdOf(stackItem: CRDTUndoStackItem): string | null {
				return stackItem.getMeta<string>(DRIFT_ID_KEY) ?? null;
			}
			function ensureDriftId(stackItem: CRDTUndoStackItem): string {
				const existing = driftIdOf(stackItem);
				if (existing) {
					return existing;
				}
				const id = `d${++driftSeq}`;
				stackItem.setMeta(DRIFT_ID_KEY, id);
				return id;
			}
			function readDrift(stackItem: CRDTUndoStackItem): CursorDrift | null {
				const id = driftIdOf(stackItem);
				return id ? (driftById.get(id) ?? null) : null;
			}
			const pendingMetadataEntries = new Map<
				string,
				UndoHistoryMetadataEntry<unknown>
			>();
			const metadataRestorers = new Map<
				string,
				(value: unknown | null, context: UndoHistoryMetadataRestoreContext) => void
			>();
			const trackedMetadataKeys = new Set<string>();
			function flushPendingMetadata(stackItem: CRDTUndoStackItem) {
				for (const [key, value] of pendingMetadataEntries) {
					stackItem.setMeta(resolveHistoryMetadataKey(key), value);
				}
				pendingMetadataEntries.clear();
			}
			const historyMetadataController: UndoHistoryMetadataController = {
				getCurrentEntryMetadata<T>(key: string): UndoHistoryMetadataEntry<T> | null {
					if (activeUndoStackItem) {
						return (
							activeUndoStackItem.getMeta(resolveHistoryMetadataKey(key)) ?? null
						) as UndoHistoryMetadataEntry<T> | null;
					}
					return (pendingMetadataEntries.get(key) ?? null) as
						| UndoHistoryMetadataEntry<T>
						| null;
				},
				setCurrentEntryMetadata(key, value) {
					trackedMetadataKeys.add(key);
					if (!activeUndoStackItem) {
						pendingMetadataEntries.set(
							key,
							value as UndoHistoryMetadataEntry<unknown>,
						);
						return true;
					}
					activeUndoStackItem.setMeta(resolveHistoryMetadataKey(key), value);
					return true;
				},
				registerMetadataRestorer(key, restore) {
					trackedMetadataKeys.add(key);
					metadataRestorers.set(
						key,
						restore as (
							value: unknown | null,
							context: UndoHistoryMetadataRestoreContext,
						) => void,
					);
					return () => {
						const currentRestore = metadataRestorers.get(key);
						if (currentRestore === restore) {
							metadataRestorers.delete(key);
						}
					};
				},
			};

			function scheduleCursorAfterCapture(stackItem: CRDTUndoStackItem) {
				const version = ++afterCaptureVersion;
				queueMicrotask(() => {
					if (afterCaptureVersion !== version) return;
					stackItem.setMeta(CURSOR_AFTER_KEY, captureCursor(ctx.editor));
					const id = ensureDriftId(stackItem);
					const existing = driftById.get(id) ?? emptyDrift();
					driftById.set(id, {
						...existing,
						after: heldDrift(ctx.editor, ctx.editor.selection),
					});
				});
			}

			unsubscribeStackItemAdded =
				crdtUndo.onStackItemAdded?.((stackItem, kind) => {
					if (manager?._isHistoryOperation) {
						pendingReverseItem = stackItem;
					} else {
						pendingReverseItem = null;
						activeUndoStackItem = stackItem;
						flushPendingMetadata(stackItem);
						stackItem.setMeta(
							CURSOR_BEFORE_KEY,
							captureCursor(ctx.editor),
						);
						const id = ensureDriftId(stackItem);
						driftById.set(id, {
							before: liveCaret,
							after: null,
						});
						scheduleCursorAfterCapture(stackItem);
					}
				}) ?? null;

			unsubscribeStackItemUpdated =
				crdtUndo.onStackItemUpdated?.((stackItem, kind) => {
					if (!manager?._isHistoryOperation) {
						activeUndoStackItem = stackItem;
						flushPendingMetadata(stackItem);
						scheduleCursorAfterCapture(stackItem);
					}
				}) ?? null;

			unsubscribeStackItemPopped =
				crdtUndo.onStackItemPopped?.((stackItem, kind) => {
					const poppedMeta = readCursorMeta(stackItem);

					if (pendingReverseItem) {
						pendingReverseItem.setMeta(
							CURSOR_BEFORE_KEY,
							poppedMeta.before,
						);
						pendingReverseItem.setMeta(
							CURSOR_AFTER_KEY,
							poppedMeta.after,
						);
						copyHistoryMetadata(
							stackItem,
							pendingReverseItem,
							trackedMetadataKeys,
						);
						const poppedId = driftIdOf(stackItem);
						if (poppedId) {
							pendingReverseItem.setMeta(DRIFT_ID_KEY, poppedId);
						}
						pendingReverseItem = null;
					}

					const cursor =
						kind === "undo" ? poppedMeta.before : poppedMeta.after;
					activeUndoStackItem = null;
					ctx.editor.internals.assignSlot(
						UNDO_HISTORY_RESTORE_SLOT_KEY,
						true,
					);
					try {
						const restoredSelection = cursor
							? mapStoredSelection(
									ctx.editor,
									cursor,
									kind === "undo"
										? (readDrift(stackItem)?.before ?? null)
										: (readDrift(stackItem)?.after ?? null),
								)
							: undefined;
						if (cursor) {
							restoreSelection(ctx.editor, restoredSelection);
						}
						const requestId = ++historyRestoreRequestId;
						for (const [key, restore] of metadataRestorers) {
							const metadata =
								stackItem.getMeta<UndoHistoryMetadataEntry<unknown>>(
									resolveHistoryMetadataKey(key),
								);
							const value = metadata
								? kind === "undo"
									? metadata.before
									: metadata.after
								: null;
							restore(value, {
								editor: ctx.editor,
								direction: kind,
								requestId,
							});
						}

						const mappedFocusBlockId =
							restoredSelection?.type === "text"
								? restoredSelection.focus.blockId
								: cursor?.focusBlockId;
						const historyApplied: HistoryAppliedEvent = {
							kind,
							selection: ctx.editor.selection,
							focusBlockId:
								mappedFocusBlockId ?? captureFocusBlockId(ctx.editor),
							requestId,
						};
						ctx.editor.internals.emit("historyApplied", historyApplied);
					} finally {
						ctx.editor.internals.assignSlot(
							UNDO_HISTORY_RESTORE_SLOT_KEY,
							false,
						);
					}
				}) ?? null;

			manager = new UndoManagerImpl(crdtUndo, trackedOrigins, {
				onListenerError(error) {
					ctx.editor.internals.emit("diagnostic", {
						code: "PEN_UNDO_001",
						level: "error",
						source: "undo",
						message: "Undo stack listener threw",
						remediation:
							"Inspect onStackChange subscribers and guard unsafe access.",
						error,
					});
				},
			});
			manager._onCaptureBoundary = () => {
				activeUndoStackItem = null;
			};
			manager.setGroupTimeout(options?.groupTimeout ?? 400);

			unsubscribeCommit = ctx.editor.on("commit", (event) => {
				const moves = deriveContentMoves(event.summary, undefined);
				if (moves.length === 0) {
					return;
				}
				const { commitId } = event.summary;
				for (const [id, drift] of driftById) {
					driftById.set(id, {
						before: repairDrift(ctx.editor, drift.before, moves, commitId),
						after: repairDrift(ctx.editor, drift.after, moves, commitId),
					});
				}
			});

			ctx.editor.internals.assignSlot(
				UNDO_HISTORY_METADATA_CONTROLLER_SLOT_KEY,
				historyMetadataController,
			);
			ctx.editor.internals.assignSlot("undo:manager", manager);
		},

		deactivateClient: async () => {
			activeEditor?.internals.assignSlot(
				UNDO_HISTORY_METADATA_CONTROLLER_SLOT_KEY,
				null,
			);
			activeEditor?.internals.assignSlot("undo:manager", null);
			activeEditor = null;
			unsubscribeStackItemAdded?.();
			unsubscribeStackItemAdded = null;
			unsubscribeStackItemUpdated?.();
			unsubscribeStackItemUpdated = null;
			unsubscribeStackItemPopped?.();
			unsubscribeStackItemPopped = null;
			unsubscribeCommit?.();
			unsubscribeCommit = null;
			unsubscribeSelection?.();
			unsubscribeSelection = null;
			if (manager) {
				manager._onCaptureBoundary = null;
			}
			manager?.destroy();
			manager = null;
		},

		observe: (events) => {
			if (!manager) return;

			for (const event of events) {
				if (manager.hasTrackedOrigin(event.origin)) {
					manager.resetIdleTimer();
				}
			}

			manager._notifyListeners();
		},
	};
}

// ── Constants ────────────────────────────────────────────────

const DEFAULT_TRACKED_ORIGINS: OpOrigin[] = [
	"user",
	"ai",
	"import",
];
const CURSOR_BEFORE_KEY = "pen:cursor-before";
const CURSOR_AFTER_KEY = "pen:cursor-after";
const DRIFT_ID_KEY = "pen:cursor-drift-id";
const HISTORY_METADATA_PREFIX = "pen:history-metadata:";

// ── Cursor snapshot types ────────────────────────────────────

interface CursorSnapshot {
	selection: StoredSelection;
	focusBlockId: string | null;
	commitId: number;
}

interface DriftPair {
	anchor: Anchor;
	focus: Anchor;
}

interface CursorDrift {
	before: DriftPair | null;
	after: DriftPair | null;
}

interface CursorMeta {
	before: CursorSnapshot | null;
	after: CursorSnapshot | null;
}

type StoredSelection =
	| {
		type: "text";
		anchor: { blockId: string; offset: number };
		focus: { blockId: string; offset: number };
	}
	| {
		type: "block";
		blockIds: string[];
	}
	| {
		type: "app";
		appId: string;
	}
	| {
		type: "cell";
		blockId: string;
		anchor: { row: number; col: number };
		head: { row: number; col: number };
	}
	| null;

// ── Capture / Restore ────────────────────────────────────────

function emptyDrift(): CursorDrift {
	return { before: null, after: null };
}

/**
 * The selection authority's own anchors for a text selection (AS1), held as
 * drift. They carry the assoc undo needs, and the authority already declines
 * an endpoint with no text to anchor, such as a divider or table, so undo
 * mints nothing per selection change.
 */
function heldDrift(
	editor: Editor,
	selection: SelectionState | SelectionRecordState,
): DriftPair | null {
	if (selection?.type !== "text") {
		return null;
	}
	const { from, to } = editor.internals.selectionAnchors();
	if (!from || !to) {
		return null;
	}
	return { anchor: from, focus: to };
}

function repairDrift(
	editor: Editor,
	pair: DriftPair | null,
	moves: ReturnType<typeof deriveContentMoves>,
	commitId: number,
): DriftPair | null {
	if (!pair || moves.length === 0) {
		return pair;
	}
	return {
		anchor: repairDriftAnchor(editor, pair.anchor, moves, commitId),
		focus: repairDriftAnchor(editor, pair.focus, moves, commitId),
	};
}

/**
 * AN14 for one drift anchor. An anchor the authority held going into the
 * commit was already repaired by it from the pre-commit target and then
 * resolved, which overwrote that target; repairing it again here would read
 * the after-commit position against the move's pre-commit range, so undo
 * takes the authority's result. Any other anchor still carries its own target.
 */
function repairDriftAnchor(
	editor: Editor,
	anchor: Anchor,
	moves: ReturnType<typeof deriveContentMoves>,
	commitId: number,
): Anchor {
	return (
		editor.internals.selectionAnchorRepair(anchor, commitId) ??
		repairAnchor(editor, anchor, moves)
	);
}

function captureCursor(editor: Editor): CursorSnapshot {
	return {
		selection: captureSelection(editor.selection),
		focusBlockId: captureFocusBlockId(editor),
		commitId: 0,
	};
}

function mapStoredSelection(
	editor: Editor,
	snapshot: CursorSnapshot,
	drift: DriftPair | null,
): StoredSelection {
	const selection = snapshot.selection;
	if (!selection || selection.type !== "text") {
		return selection;
	}
	if (!drift) {
		return selection;
	}
	const anchor = editor.anchors.resolve(drift.anchor);
	const focus = editor.anchors.resolve(drift.focus);
	if (!anchor || !focus) {
		return selection;
	}
	return {
		type: "text",
		anchor: { blockId: anchor.blockId, offset: anchor.offset },
		focus: { blockId: focus.blockId, offset: focus.offset },
	};
}

function captureSelection(selection: SelectionState): StoredSelection {
	if (!selection) return null;
	switch (selection.type) {
		case "text":
			return {
				type: "text",
				anchor: { ...selection.anchor },
				focus: { ...selection.focus },
			};
		case "block":
			return { type: "block", blockIds: [...selection.blockIds] };
		case "app":
			return { type: "app", appId: selection.appId };
		case "cell":
			return {
				type: "cell",
				blockId: selection.blockId,
				anchor: { ...selection.anchor },
				head: { ...selection.head },
			};
	}
	return null;
}

function captureFocusBlockId(editor: {
	selection: SelectionState;
	facet: Editor["facet"];
}): string | null {
	const fe =
		(editor.facet(fieldEditorHostFacet) as FieldEditor | null) ?? null;
	if (fe?.focusBlockId) return fe.focusBlockId;

	const sel = editor.selection;
	if (!sel) return null;
	if (sel.type === "text") return sel.focus.blockId;
	if (sel.type === "block") return sel.blockIds[0] ?? null;
	if (sel.type === "cell") return sel.blockId;
	return null;
}

/** Undo and redo restore the selection with origin `restore` (S3, D17). */
const RESTORE = { origin: "restore" } as const;

function restoreSelection(
	editor: {
		setSelection(
			selection: SelectionState,
			options?: SelectionWriteOptions,
		): void;
		selectBlocks(blockIds: string[], options?: SelectionWriteOptions): void;
		selectTextRange(
			anchor: { blockId: string; offset: number },
			focus: { blockId: string; offset: number },
			options?: SelectionWriteOptions,
		): void;
	},
	selection: StoredSelection | undefined,
): void {
	if (selection == null) {
		editor.setSelection(null, RESTORE);
		return;
	}
	if (selection.type === "text") {
		editor.selectTextRange(selection.anchor, selection.focus, RESTORE);
		return;
	}
	if (selection.type === "block") {
		editor.selectBlocks(selection.blockIds, RESTORE);
		return;
	}
	editor.setSelection(selection, RESTORE);
}

function readCursorMeta(stackItem: {
	getMeta<T>(key: string): T | undefined;
}): CursorMeta {
	return {
		before: stackItem.getMeta<CursorSnapshot>(CURSOR_BEFORE_KEY) ?? null,
		after: stackItem.getMeta<CursorSnapshot>(CURSOR_AFTER_KEY) ?? null,
	};
}

function resolveHistoryMetadataKey(key: string): string {
	return `${HISTORY_METADATA_PREFIX}${key}`;
}

function copyHistoryMetadata(
	source: CRDTUndoStackItem,
	target: CRDTUndoStackItem,
	keys: Iterable<string>,
): void {
	for (const key of keys) {
		const metadata = source.getMeta<UndoHistoryMetadataEntry<unknown>>(
			resolveHistoryMetadataKey(key),
		);
		if (metadata === undefined) {
			continue;
		}
		target.setMeta(resolveHistoryMetadataKey(key), metadata);
	}
}
