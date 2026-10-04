import type {
	CRDTUndoCaptureKey,
	CRDTUndoManager,
	CRDTUndoStackItem,
	OpOriginType,
	UndoManagerOptions,
} from "@input/pen-types";
import { HISTORY_ORIGIN_TAG } from "@input/pen-types";
import * as Y from "yjs";

import type { YjsCRDTDocument } from "./document";
import { canonicalOrigin, HISTORY_OPERATION_KIND } from "./events";

/**
 * Default undo/redo stack depth (CH7).
 * Y.UndoManager has no native cap; oldest items are trimmed past this limit.
 */
export const DEFAULT_UNDO_MAX_DEPTH = 500;

/**
 * Y.UndoManager decides whether to capture a transaction with
 * `trackedOrigins.has(transaction.origin)`, which is identity-based. The apply
 * pipeline tags transactions with a freshly built structured origin so that
 * `groupId` / `requestId` survive into the transaction, so neither the bare
 * type string nor the interned canonical object is ever the same reference.
 * Matching on the discriminant keeps both properties: structured origins reach
 * Yjs intact, and only the tracked types are captured.
 */
class TrackedOriginSet extends Set<unknown> {
	override has(origin: unknown): boolean {
		if (super.has(origin)) {
			return true;
		}
		if (typeof origin !== "object" || origin === null) {
			return false;
		}
		const { type } = origin as { type?: unknown };
		return typeof type === "string" && super.has(type);
	}
}

export function createYjsUndoManager(
	doc: YjsCRDTDocument,
	options?: UndoManagerOptions,
): CRDTUndoManager {
	const { blockOrder, blocks } = doc.penDocument;
	const trackedOriginTypes = options?.trackedOriginTypes ?? ["user", "ai"];
	const trackedOrigins = new TrackedOriginSet(trackedOriginTypes);
	for (const type of trackedOriginTypes) {
		if (typeof type === "string") {
			trackedOrigins.add(canonicalOrigin(type as OpOriginType));
		}
	}
	const maxDepth = options?.maxDepth ?? DEFAULT_UNDO_MAX_DEPTH;

	// AIB4: Yjs never merges on its own (captureTimeout 0). Merging is keyed:
	// a tracked transaction joins the open stack item for its capture key, so
	// an explicit AI group collects every write of its action while user
	// typing interleaved with it forms its own items.
	const undoManager = new Y.UndoManager([blockOrder, blocks], {
		trackedOrigins,
		captureTimeout: 0,
		doc: doc.ydoc,
	});
	let windowMs = options?.captureTimeout ?? 0;
	let currentKey: CRDTUndoCaptureKey | null = null;
	const openItems = new Map<string, OpenCapture>();

	(undoManager as unknown as Record<string, unknown>)[HISTORY_ORIGIN_TAG] =
		true;

	const trimStack = (stack: Y.UndoManager["undoStack"]) => {
		while (maxDepth >= 0 && stack.length > maxDepth) {
			stack.shift();
		}
	};

	const addedListeners = new Set<StackItemListener>();
	const updatedListeners = new Set<StackItemListener>();
	const dispatch = (
		listeners: Set<StackItemListener>,
		stackItem: StackItem,
		type: "undo" | "redo",
	) => {
		for (const listener of listeners) {
			listener(wrapStackItem(stackItem), type);
		}
	};

	/** Joins `added` into the open item for its key; returns the item now on top. */
	const captureKeyed = (added: StackItem, origin: unknown): StackItem | null => {
		const key = currentKey ?? captureKeyFromOrigin(origin);
		const now = Date.now();
		const open = openItems.get(key.key);
		const stack = undoManager.undoStack;
		// An explicit group joins its item wherever it sits, unless a later step
		// deleted text the group inserted: moving the group past that step would
		// let undoing it bring the deleted text back, so the group closes and
		// this write starts its next step. An origin key only joins the item
		// directly beneath the new one, so typing never merges across another
		// action's step and undo stays in time order.
		const beneath = stack[stack.length - 2];
		const joinable =
			open != null &&
			stack.includes(open.item) &&
			(open.explicit
				? !laterStepDeletesInsertions(stack, open.item, added)
				: beneath === open.item && now - open.lastChange < windowMs);
		if (!joinable) {
			openItems.set(key.key, { item: added, lastChange: now, explicit: key.explicit });
			return null;
		}
		mergeStackItem(open.item, added);
		stack.splice(stack.indexOf(added), 1);
		stack.splice(stack.indexOf(open.item), 1);
		stack.push(open.item);
		open.lastChange = now;
		return open.item;
	};

	const dropTrimmedOpenItems = () => {
		for (const [key, open] of openItems) {
			if (!undoManager.undoStack.includes(open.item)) {
				openItems.delete(key);
			}
		}
	};

	undoManager.on(
		"stack-item-added",
		(event: { stackItem: StackItem; type: "undo" | "redo"; origin: unknown }) => {
			const isCapture =
				event.type === "undo" && !undoManager.undoing && !undoManager.redoing;
			const merged = isCapture ? captureKeyed(event.stackItem, event.origin) : null;
			trimStack(event.type === "undo" ? undoManager.undoStack : undoManager.redoStack);
			dropTrimmedOpenItems();
			if (merged != null) {
				dispatch(updatedListeners, merged, event.type);
			} else {
				dispatch(addedListeners, event.stackItem, event.type);
			}
		},
	);

	let destroyed = false;

	function wrapStackItem(stackItem: StackItem): CRDTUndoStackItem {
		return {
		getMeta<T>(key: string): T | undefined {
			return stackItem.meta.get(key) as T | undefined;
		},
		setMeta(key: string, value: unknown): void {
			stackItem.meta.set(key, value);
		},
		};
	}

	return {
		addTrackedOrigin(origin) {
			undoManager.addTrackedOrigin(origin);
			if (typeof origin === "string") {
				const token = canonicalOrigin(origin as OpOriginType);
				if (token) undoManager.addTrackedOrigin(token);
			}
		},
		removeTrackedOrigin(origin) {
			undoManager.removeTrackedOrigin(origin);
			if (typeof origin === "string") {
				const token = canonicalOrigin(origin as OpOriginType);
				if (token) undoManager.removeTrackedOrigin(token);
			}
		},
		undo() {
			openItems.clear();
			if (undoManager.undoStack.length === 0) return false;
			return withHistoryKind(undoManager, "undo", () => {
				undoManager.undo();
				return true;
			});
		},
		redo() {
			openItems.clear();
			if (undoManager.redoStack.length === 0) return false;
			return withHistoryKind(undoManager, "redo", () => {
				undoManager.redo();
				return true;
			});
		},
		canUndo() {
			return undoManager.undoStack.length > 0;
		},
		canRedo() {
			return undoManager.redoStack.length > 0;
		},
		stopCapturing() {
			undoManager.stopCapturing();
			for (const [key, open] of openItems) {
				if (!open.explicit) {
					openItems.delete(key);
				}
			}
		},
		setCaptureTimeout(ms) {
			windowMs = ms;
		},
		setCaptureKey(key) {
			const previous = currentKey;
			currentKey = key;
			return previous;
		},
		onStackItemAdded(callback) {
			addedListeners.add(callback);
			return () => {
				addedListeners.delete(callback);
			};
		},
		onStackItemUpdated(callback) {
			updatedListeners.add(callback);
			return () => {
				updatedListeners.delete(callback);
			};
		},
		onStackItemPopped(callback) {
			const handler = (event: { stackItem: StackItem; type: "undo" | "redo" }) => {
				openItems.forEach((open, key) => {
					if (open.item === event.stackItem) {
						openItems.delete(key);
					}
				});
				callback(wrapStackItem(event.stackItem), event.type);
			};

			undoManager.on("stack-item-popped", handler);
			return () => {
				undoManager.off("stack-item-popped", handler);
			};
		},
		destroy() {
			if (destroyed) {
				return;
			}
			destroyed = true;
			openItems.clear();
			addedListeners.clear();
			updatedListeners.clear();
			undoManager.destroy();
		},
	};
}

function withHistoryKind(
	undoManager: Y.UndoManager,
	kind: "undo" | "redo",
	run: () => boolean,
): boolean {
	const target = undoManager as unknown as Record<string, unknown>;
	target[HISTORY_OPERATION_KIND] = kind;
	try {
		return run();
	} finally {
		delete target[HISTORY_OPERATION_KIND];
	}
}

type StackItem = Y.UndoManager["undoStack"][number];

type StackItemListener = (
	stackItem: CRDTUndoStackItem,
	kind: "undo" | "redo",
) => void;

interface OpenCapture {
	item: StackItem;
	lastChange: number;
	explicit: boolean;
}

/**
 * The key a tracked transaction captures under when the caller declared
 * none: a structured origin with a `groupId` is an explicit group, anything
 * else groups by origin type.
 */
function captureKeyFromOrigin(origin: unknown): CRDTUndoCaptureKey {
	const structured =
		typeof origin === "object" && origin !== null
			? (origin as { type?: unknown; groupId?: unknown })
			: null;
	if (typeof structured?.groupId === "string") {
		return { key: `group:${structured.groupId}`, explicit: true };
	}
	const type =
		typeof origin === "string" ? origin : String(structured?.type ?? "unknown");
	return { key: `origin:${type}`, explicit: false };
}

/**
 * Whether a step between `item` and the newly added `added` deleted content
 * that `item` inserted (AIB4).
 */
function laterStepDeletesInsertions(
	stack: StackItem[],
	item: StackItem,
	added: StackItem,
): boolean {
	const from = stack.indexOf(item) + 1;
	const to = stack.indexOf(added);
	for (let index = from; index < to; index += 1) {
		if (deleteSetsOverlap(stack[index]!.deletions, item.insertions)) {
			return true;
		}
	}
	return false;
}

function deleteSetsOverlap(a: Y.DeleteSet, b: Y.DeleteSet): boolean {
	for (const [client, rangesA] of a.clients) {
		const rangesB = b.clients.get(client);
		if (rangesB == null) {
			continue;
		}
		for (const rangeA of rangesA) {
			for (const rangeB of rangesB) {
				if (
					rangeA.clock < rangeB.clock + rangeB.len &&
					rangeB.clock < rangeA.clock + rangeA.len
				) {
					return true;
				}
			}
		}
	}
	return false;
}

/** Folds `source` into `target`; `target.meta` (owned by pen-undo) is kept. */
function mergeStackItem(target: StackItem, source: StackItem): void {
	target.insertions = Y.mergeDeleteSets([target.insertions, source.insertions]);
	target.deletions = Y.mergeDeleteSets([target.deletions, source.deletions]);
}
