import * as Y from "yjs";

import {
	APPS,
	BLOCKS,
	BLOCK_ORDER,
	METADATA,
	isYjsCRDTDocument,
	isYjsDoc,
} from "./document";
import type { YjsCRDTDocument } from "./document";

export type YTextDeltaOp = {
	insert?: string | object;
	delete?: number;
	retain?: number;
	attributes?: Record<string, unknown>;
};

export type YTextDelta = readonly YTextDeltaOp[];

export type YArrayDeltaOp = {
	insert?: readonly unknown[];
	delete?: number;
	retain?: number;
};

export type YArrayDelta = readonly YArrayDeltaOp[];

export type StructuralOriginTag =
	| {
			kind: "split";
			blockId: string;
			newBlockId: string;
			offset: number;
	  }
	| {
			kind: "merge";
			targetBlockId: string;
			sourceBlockId: string;
	  };

export interface RawCommitDelta {
	readonly originTag: unknown;
	readonly textDeltas: ReadonlyMap<string, readonly YTextDelta[]>;
	readonly blockOrderDelta: YArrayDelta;
	readonly childArrayDeltas: ReadonlyMap<string, YArrayDelta>;
	readonly blockMapChanges: ReadonlyMap<string, ReadonlySet<string>>;
	/**
	 * Each non-empty `children` array created in this transaction: on a block
	 * whose map arrived whole (an undo restoring a container, a peer's
	 * insert), or set on an existing block by its first child. Yjs reports no
	 * array delta for an array created inside the transaction.
	 */
	readonly arrivedChildArrays?: ReadonlyMap<string, readonly string[]>;
	/**
	 * Block-map entries this transaction changed whose map is absent after
	 * it: deleted, or stored and deleted within it. Read from the one block
	 * map read the arrived-content pass makes.
	 */
	readonly absentBlockIds?: ReadonlySet<string>;
	readonly appChanges: ReadonlySet<string>;
	readonly metadataChanges: ReadonlySet<string>;
}

export const STRUCTURAL_ORIGIN_META_KEY = "structural";

type YTypeItem = {
	parent: unknown;
	parentSub: string | null;
};

type YTypeHandle = {
	_item?: YTypeItem;
};

type SummarySourceState = {
	listeners: Set<(delta: RawCommitDelta) => void>;
	handler: (txn: Y.Transaction) => void;
};

const sources = new WeakMap<Y.Doc, SummarySourceState>();

function resolveYDoc(doc: YjsCRDTDocument | Y.Doc): Y.Doc {
	if (isYjsCRDTDocument(doc)) return doc.ydoc;
	if (isYjsDoc(doc)) return doc;
	throw new Error("createSummarySource expects a Yjs document");
}

function getTypeItem(ytype: object): YTypeItem | undefined {
	return (ytype as YTypeHandle)._item;
}

function resolveSharedKey(ytype: object, shared: object): string | null {
	let current: object | null = ytype;
	while (current != null) {
		const item = getTypeItem(current);
		if (item == null) break;
		if (item.parent === shared && item.parentSub != null) {
			return item.parentSub;
		}
		current = (item.parent as object | null) ?? null;
	}
	return null;
}

function addKeys(
	target: Map<string, Set<string>>,
	id: string,
	keys: Iterable<string | null>,
): void {
	let set = target.get(id);
	if (!set) {
		set = new Set();
		target.set(id, set);
	}
	for (const key of keys) {
		if (key != null) set.add(key);
	}
}

function snapshotTextDelta(delta: readonly YTextDeltaOp[]): YTextDelta {
	return delta.map((op) => ({
		...op,
		attributes: op.attributes ? { ...op.attributes } : undefined,
	}));
}

function snapshotArrayDelta(delta: readonly YArrayDeltaOp[]): YArrayDelta {
	return delta.map((op) => ({
		...op,
		insert: op.insert ? [...op.insert] : undefined,
	}));
}

function eventForType(
	txn: Y.Transaction,
	ytype: object,
): { delta: unknown; target: unknown } | undefined {
	for (const [type, events] of txn.changedParentTypes) {
		if ((type as object) !== ytype) continue;
		for (const event of events) {
			if (event.target === ytype) return event;
		}
	}
	for (const events of txn.changedParentTypes.values()) {
		for (const event of events) {
			if (event.target === ytype) return event;
		}
	}
	return undefined;
}

function isStructuralOriginTag(value: unknown): value is StructuralOriginTag {
	if (value == null || typeof value !== "object") return false;
	const kind = (value as { kind?: unknown }).kind;
	return kind === "split" || kind === "merge";
}

function readOriginTag(txn: Y.Transaction): unknown {
	const origin = txn.origin;
	if (origin != null && typeof origin === "object") {
		const tagged = (origin as { structural?: unknown }).structural;
		if (isStructuralOriginTag(tagged)) return origin;
	}

	const fromMeta = txn.meta.get(STRUCTURAL_ORIGIN_META_KEY);
	if (!isStructuralOriginTag(fromMeta)) return origin;

	if (origin != null && typeof origin === "object") {
		return { ...(origin as object), structural: fromMeta };
	}
	return {
		type: origin ?? "user",
		structural: fromMeta,
	};
}

function transactionToRawCommitDelta(txn: Y.Transaction): RawCommitDelta {
	const blocks = txn.doc.getMap(BLOCKS) as Y.Map<Y.Map<unknown>>;
	const blockOrder = txn.doc.getArray(BLOCK_ORDER);
	const apps = txn.doc.getMap(APPS) as Y.Map<Y.Map<unknown>>;
	const metadata = txn.doc.getMap(METADATA);

	const textDeltas = new Map<string, YTextDelta[]>();
	const childArrayDeltas = new Map<string, YArrayDelta>();
	const blockMapChanges = new Map<string, Set<string>>();
	const arrivedChildArrays = new Map<string, readonly string[]>();
	const entryChangedBlockIds = new Set<string>();
	const appChanges = new Set<string>();
	const metadataChanges = new Set<string>();
	let blockOrderDelta: YArrayDelta = [];

	for (const [ytype, keys] of txn.changed) {
		if ((ytype as unknown) === (blockOrder as unknown)) {
			const event = eventForType(txn, ytype);
			if (event) {
				blockOrderDelta = snapshotArrayDelta(
					event.delta as YArrayDeltaOp[],
				);
			}
			continue;
		}

		if ((ytype as unknown) === (blocks as unknown)) {
			for (const key of keys) {
				if (key == null) continue;
				addKeys(blockMapChanges, key, []);
				entryChangedBlockIds.add(key);
			}
			continue;
		}

		if ((ytype as unknown) === (apps as unknown)) {
			for (const key of keys) {
				if (key != null) appChanges.add(key);
			}
			continue;
		}

		if ((ytype as unknown) === (metadata as unknown)) {
			for (const key of keys) {
				if (key != null) metadataChanges.add(key);
			}
			continue;
		}

		if (ytype instanceof Y.Text) {
			const blockId = resolveSharedKey(ytype, blocks);
			const event = eventForType(txn, ytype);
			if (blockId && event) {
				const snapshot = snapshotTextDelta(
					event.delta as YTextDeltaOp[],
				);
				const existing = textDeltas.get(blockId);
				if (existing) {
					existing.push(snapshot);
				} else {
					textDeltas.set(blockId, [snapshot]);
				}
			}
			continue;
		}

		if (ytype instanceof Y.Array) {
			const item = getTypeItem(ytype);
			const blockId = resolveSharedKey(ytype, blocks);
			if (blockId && item?.parentSub === "children") {
				const event = eventForType(txn, ytype);
				if (event) {
					childArrayDeltas.set(
						blockId,
						snapshotArrayDelta(event.delta as YArrayDeltaOp[]),
					);
				}
				continue;
			}
			if (blockId && item?.parentSub) {
				addKeys(blockMapChanges, blockId, [item.parentSub]);
			}
			continue;
		}

		if (ytype instanceof Y.Map) {
			const appId = resolveSharedKey(ytype, apps);
			if (appId) {
				appChanges.add(appId);
				continue;
			}

			const item = getTypeItem(ytype);
			const blockId = resolveSharedKey(ytype, blocks);
			if (!blockId) continue;

			if (item?.parent === blocks) {
				addKeys(blockMapChanges, blockId, keys);
				// A `children` array set on an existing block (created on its
				// first child) arrives whole, like a new block's.
				if (keys.has("children")) {
					addArrivedChildren(
						arrivedChildArrays,
						blockId,
						(ytype as Y.Map<unknown>).get("children"),
					);
				}
				continue;
			}

			if (item?.parentSub === "props" || item?.parentSub === "meta") {
				addKeys(blockMapChanges, blockId, keys);
				continue;
			}

			if (item?.parentSub) {
				addKeys(blockMapChanges, blockId, [item.parentSub]);
			}
		}
	}

	const absentBlockIds = addArrivedBlockContent(
		blocks,
		entryChangedBlockIds,
		textDeltas,
		arrivedChildArrays,
	);

	return {
		originTag: readOriginTag(txn),
		textDeltas,
		blockOrderDelta,
		childArrayDeltas,
		blockMapChanges,
		arrivedChildArrays,
		absentBlockIds,
		appChanges,
		metadataChanges,
	};
}

/**
 * Report a block that arrived carrying text as an insert of that text.
 *
 * Yjs leaves a type created inside a transaction out of `txn.changed`, so a
 * block whose content was written at construction produces no text delta of
 * its own. Every observer downstream would see the block appear and its text
 * arrive from nowhere — which is what left AN14's remote pairing with a delete
 * and nothing to pair it against when a peer split a block.
 *
 * The same holds for a `children` array the block arrived with: its entries
 * are returned per block, read from the one block map read. Returns the
 * changed entries whose map that read found absent.
 */
function addArrivedBlockContent(
	blocks: Y.Map<Y.Map<unknown>>,
	entryChangedBlockIds: ReadonlySet<string>,
	textDeltas: Map<string, YTextDelta[]>,
	arrivedChildArrays: Map<string, readonly string[]>,
): Set<string> {
	const absent = new Set<string>();
	for (const blockId of entryChangedBlockIds) {
		const block = blocks.get(blockId);
		if (!block) absent.add(blockId);
		addArrivedChildren(arrivedChildArrays, blockId, block?.get("children"));
		if (textDeltas.has(blockId)) continue;
		const content = block?.get("content");
		if (!(content instanceof Y.Text) || content.length === 0) continue;
		textDeltas.set(blockId, [
			snapshotTextDelta(content.toDelta() as YTextDeltaOp[]),
		]);
	}
	return absent;
}

function addArrivedChildren(
	arrivedChildArrays: Map<string, readonly string[]>,
	blockId: string,
	children: unknown,
): void {
	if (!(children instanceof Y.Array) || children.length === 0) return;
	arrivedChildArrays.set(
		blockId,
		children.toArray().filter((id): id is string => typeof id === "string"),
	);
}

export function createSummarySource(
	doc: YjsCRDTDocument | Y.Doc,
	onDelta: (delta: RawCommitDelta) => void,
): () => void {
	const ydoc = resolveYDoc(doc);
	let state = sources.get(ydoc);
	if (!state) {
		const listeners = new Set<(delta: RawCommitDelta) => void>();
		const handler = (txn: Y.Transaction) => {
			if (txn.changed.size === 0 || listeners.size === 0) return;
			const delta = transactionToRawCommitDelta(txn);
			for (const listener of listeners) {
				listener(delta);
			}
		};
		ydoc.on("afterTransaction", handler);
		state = { listeners, handler };
		sources.set(ydoc, state);
	}

	state.listeners.add(onDelta);
	return () => {
		const current = sources.get(ydoc);
		if (!current) return;
		current.listeners.delete(onDelta);
		if (current.listeners.size === 0) {
			ydoc.off("afterTransaction", current.handler);
			sources.delete(ydoc);
		}
	};
}
