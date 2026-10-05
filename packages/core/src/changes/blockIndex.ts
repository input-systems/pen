import type { PenDocument } from "@input/pen-types";
import type { RawCommitDelta, YArrayDelta } from "@input/pen-yjs";

import { asMap, readStringArray, storedText } from "./readStored";
import { logicalLengthFromStored } from "./summaryBuilder";
import type { BlockTextChange, TextSplice } from "./types";

export interface BlockIndexSnapshot {
	readonly lengthById: ReadonlyMap<string, number>;
	readonly typeById: ReadonlyMap<string, string>;
	readonly parentById: ReadonlyMap<string, string | null>;
	readonly childrenByParentId: ReadonlyMap<string | null, readonly string[]>;
	readonly roots: readonly string[];
}

export interface BlockIndex {
	snapshot(): BlockIndexSnapshot;
	/**
	 * Advance block lengths for a commit that changed text only. Structural
	 * commits go through `applyStructure`, so the index still resolves its
	 * shape from storage rather than from summary replay.
	 */
	applyTextLengths(blockText: readonly BlockTextChange[]): void;
	/**
	 * Advance the index in place for a structural commit, in proportion to
	 * what it touched (SCALE2): the root order's delta is applied to the held
	 * roots, each touched `children` array is advanced by its delta or re-read
	 * with its owner, and `named` blocks have their text length re-read.
	 * Returns false, leaving the index to be replaced from the document, for a
	 * commit it cannot advance exactly: an id listed in more than one array
	 * entry (COL4), whose parent the full build resolves by visit order, or a
	 * delta that does not fit the held arrays.
	 */
	applyStructure(
		doc: PenDocument,
		delta: RawCommitDelta,
		named: ReadonlySet<string>,
	): boolean;
	/** Whether the index lists the id in more than one array entry (COL4). */
	listedMoreThanOnce(blockId: string): boolean;
	/** Takes ownership of a freshly built snapshot; the caller must not keep it. */
	replace(snapshot: BlockIndexSnapshot): void;
}

/** The clone the index holds; `snapshot()` hands it out read-only. */
interface OwnedBlockIndexSnapshot extends BlockIndexSnapshot {
	readonly lengthById: Map<string, number>;
	readonly typeById: Map<string, string>;
	readonly parentById: Map<string, string | null>;
	readonly childrenByParentId: Map<string | null, readonly string[]>;
	roots: readonly string[];
}

export function emptyBlockIndexSnapshot(): BlockIndexSnapshot {
	return {
		lengthById: new Map(),
		typeById: new Map(),
		parentById: new Map(),
		childrenByParentId: new Map([[null, []]]),
		roots: [],
	};
}

export function createBlockIndexSnapshot(input: {
	readonly roots: readonly string[];
	readonly lengthById?:
		| ReadonlyMap<string, number>
		| Readonly<Record<string, number>>;
	readonly typeById?:
		| ReadonlyMap<string, string>
		| Readonly<Record<string, string>>;
	readonly childrenByParentId?: ReadonlyMap<string | null, readonly string[]>;
}): BlockIndexSnapshot {
	const lengthById = toNumberMap(input.lengthById);
	const typeById = toStringMap(input.typeById);
	const childrenByParentId = new Map<string | null, readonly string[]>(
		input.childrenByParentId ?? [[null, input.roots]],
	);
	if (!childrenByParentId.has(null)) {
		childrenByParentId.set(null, input.roots);
	}
	const parentById = new Map<string, string | null>();
	for (const [parentId, children] of childrenByParentId) {
		for (const childId of children) {
			parentById.set(childId, parentId);
		}
	}
	const roots = [...(childrenByParentId.get(null) ?? input.roots)];
	return {
		lengthById,
		typeById,
		parentById,
		childrenByParentId,
		roots,
	};
}

export function createEmptyBlockIndex(): BlockIndex {
	return createBlockIndex(emptyBlockIndexSnapshot());
}

export function createBlockIndex(initial: BlockIndexSnapshot): BlockIndex {
	let current = cloneSnapshot(initial);
	/** Array entries per id, built on the first structural read after a replace. */
	let listings: Listings | null = null;
	const listingsOf = (): Listings => {
		listings ??= countListings(current);
		return listings;
	};
	return {
		snapshot() {
			return current;
		},
		applyTextLengths(blockText) {
			for (const change of blockText) {
				const previous = current.lengthById.get(change.blockId) ?? 0;
				current.lengthById.set(
					change.blockId,
					lengthAfterSplices(previous, change.splices),
				);
			}
		},
		applyStructure(doc, delta, named) {
			const advanced = advanceStructure(
				current,
				listingsOf(),
				doc,
				delta,
				named,
			);
			// A refused advance may have moved some entries; the caller
			// replaces the whole index, and the counts are rebuilt from it.
			if (!advanced) listings = null;
			return advanced;
		},
		listedMoreThanOnce(blockId) {
			return (listingsOf().count.get(blockId) ?? 0) > 1;
		},
		replace(snapshot) {
			// Fresh from createBlockIndexSnapshot, which already built new maps;
			// cloning again would copy every entry a second time.
			current = snapshot as OwnedBlockIndexSnapshot;
			listings = null;
		},
	};
}

interface Listings {
	/** Entries naming each id across the root order and every stored `children` array. */
	readonly count: Map<string, number>;
	/** Ids with more than one entry; the incremental advance refuses while any exists. */
	multiListed: number;
}

function countListings(snapshot: BlockIndexSnapshot): Listings {
	const count = new Map<string, number>();
	let multiListed = 0;
	for (const children of snapshot.childrenByParentId.values()) {
		for (const childId of children) {
			const next = (count.get(childId) ?? 0) + 1;
			count.set(childId, next);
			if (next === 2) multiListed += 1;
		}
	}
	return { count, multiListed };
}

type Entry = readonly [childId: string, parentId: string | null];

/**
 * The commit's array edits as entries removed and added, applied to a copy
 * of `pre`. Null when an op runs past the held array or inserts a non-id.
 */
function applyArrayDelta(
	pre: readonly string[],
	delta: YArrayDelta,
	parentId: string | null,
	removed: Entry[],
	added: Entry[],
): string[] | null {
	const next = pre.slice();
	let at = 0;
	for (const op of delta) {
		if (op.retain != null) {
			at += op.retain;
			if (at > next.length) return null;
		} else if (op.delete != null) {
			if (at + op.delete > next.length) return null;
			for (const childId of next.splice(at, op.delete)) {
				removed.push([childId, parentId]);
			}
		} else if (op.insert) {
			const ids: string[] = [];
			for (const value of op.insert) {
				if (typeof value !== "string") return null;
				ids.push(value);
				added.push([value, parentId]);
			}
			next.splice(at, 0, ...ids);
			at += ids.length;
		}
	}
	return next;
}

function readLength(block: { get(key: string): unknown }): number {
	return logicalLengthFromStored(storedText(block.get("content")));
}

/** Block-map keys that change the block's type or replace its `children` array. */
function rereadsBlock(keys: ReadonlySet<string>): boolean {
	return keys.size === 0 || keys.has("type") || keys.has("children");
}

/**
 * The advance `applyStructure` documents. Every structure the full build
 * derives without regard to visit order — the type and length of each stored
 * block, each stored block's `children`, the length-0 entry of a listed id
 * with no block map, and each singly listed id's parent — is a function of the
 * arrays and maps the delta names, so only those are read.
 */
function advanceStructure(
	index: OwnedBlockIndexSnapshot,
	listings: Listings,
	doc: PenDocument,
	delta: RawCommitDelta,
	named: ReadonlySet<string>,
): boolean {
	if (listings.multiListed > 0 || !doc?.blocks) return false;
	const removed: Entry[] = [];
	const added: Entry[] = [];

	if (delta.blockOrderDelta.length > 0) {
		const roots = applyArrayDelta(
			index.roots,
			delta.blockOrderDelta,
			null,
			removed,
			added,
		);
		if (!roots) return false;
		index.roots = roots;
		index.childrenByParentId.set(null, roots);
	}

	const reread = new Map<string, ReadonlySet<string>>();
	for (const [blockId, keys] of delta.blockMapChanges) {
		if (rereadsBlock(keys)) reread.set(blockId, keys);
	}
	for (const blockId of delta.arrivedChildArrays?.keys() ?? []) {
		if (!reread.has(blockId)) reread.set(blockId, new Set(["children"]));
	}
	for (const [parentId, arrayDelta] of delta.childArrayDeltas) {
		if (reread.has(parentId)) continue;
		const pre = index.childrenByParentId.get(parentId);
		const next = pre
			? applyArrayDelta(pre, arrayDelta, parentId, removed, added)
			: null;
		if (next) index.childrenByParentId.set(parentId, next);
		else reread.set(parentId, new Set(["children"]));
	}

	const settle = new Set<string>();
	for (const [blockId, keys] of reread) {
		settle.add(blockId);
		const pre = index.childrenByParentId.get(blockId);
		for (const childId of pre ?? []) removed.push([childId, blockId]);
		const block = asMap(doc.blocks.get(blockId));
		if (!block) {
			index.childrenByParentId.delete(blockId);
			index.typeById.delete(blockId);
			continue;
		}
		const wasStored = index.typeById.has(blockId);
		const type = block.get("type");
		index.typeById.set(blockId, typeof type === "string" ? type : "");
		if (!wasStored || keys.size === 0 || named.has(blockId)) {
			index.lengthById.set(blockId, readLength(block));
		}
		const children = readStringArray(block.get("children"));
		index.childrenByParentId.set(blockId, children);
		for (const childId of children) added.push([childId, blockId]);
	}

	// Every removal first, so a move within the commit never counts its
	// block twice.
	for (const [childId, parentId] of removed) {
		settle.add(childId);
		const count = listings.count.get(childId) ?? 0;
		if (count !== 1 || index.parentById.get(childId) !== parentId) {
			return false;
		}
		listings.count.delete(childId);
		index.parentById.delete(childId);
	}
	for (const [childId, parentId] of added) {
		settle.add(childId);
		if (listings.count.has(childId)) return false;
		listings.count.set(childId, 1);
		index.parentById.set(childId, parentId);
	}

	// A listed id without a block map holds length 0; an id neither listed
	// nor stored leaves the index.
	for (const blockId of settle) {
		if (index.typeById.has(blockId)) continue;
		if (listings.count.has(blockId)) index.lengthById.set(blockId, 0);
		else index.lengthById.delete(blockId);
	}
	for (const blockId of named) {
		if (reread.has(blockId) || !index.typeById.has(blockId)) continue;
		const block = asMap(doc.blocks.get(blockId));
		if (block) index.lengthById.set(blockId, readLength(block));
	}
	return true;
}

function lengthAfterSplices(
	length: number,
	splices: readonly TextSplice[],
): number {
	let next = length;
	for (const splice of splices) {
		next += splice.insertLength - (splice.to - splice.from);
	}
	return Math.max(0, next);
}

function cloneSnapshot(snapshot: BlockIndexSnapshot): OwnedBlockIndexSnapshot {
	const childrenByParentId = cloneChildren(snapshot.childrenByParentId);
	return {
		lengthById: new Map(snapshot.lengthById),
		typeById: new Map(snapshot.typeById),
		parentById: new Map(snapshot.parentById),
		childrenByParentId,
		roots: [...snapshot.roots],
	};
}

function cloneChildren(
	childrenByParentId: ReadonlyMap<string | null, readonly string[]>,
): Map<string | null, string[]> {
	const next = new Map<string | null, string[]>();
	for (const [parentId, children] of childrenByParentId) {
		next.set(parentId, [...children]);
	}
	return next;
}

function toNumberMap(
	value:
		| ReadonlyMap<string, number>
		| Readonly<Record<string, number>>
		| undefined,
): Map<string, number> {
	if (!value) return new Map();
	if (value instanceof Map) return new Map(value);
	return new Map(Object.entries(value));
}

function toStringMap(
	value:
		| ReadonlyMap<string, string>
		| Readonly<Record<string, string>>
		| undefined,
): Map<string, string> {
	if (!value) return new Map();
	if (value instanceof Map) return new Map(value);
	return new Map(Object.entries(value));
}
