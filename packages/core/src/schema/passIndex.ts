import type { PenDocument } from "@input/pen-types";
import type { RawCommitDelta } from "@input/pen-yjs";
import type { StoredBlockReader } from "../changes/blockIndex";
import {
	getArrayProp,
	isCRDTMap,
	type CRDTUnknownArray,
} from "../editor/crdtShapes";
import { PositionedList } from "../editor/positionedList";

/** An array entry naming a block; `parentId` is `null` for `blockOrder`. */
export type StructuralEntry = {
	parentId: string | null;
	blockId: string;
	index: number;
};

function readIds(array: CRDTUnknownArray<string>): string[] {
	const values = array.toArray?.() ?? readEach(array);
	return values.filter((id): id is string => typeof id === "string");
}

function readEach(array: CRDTUnknownArray<string>): string[] {
	const values: string[] = [];
	for (let i = 0; i < array.length; i++) values.push(array.get(i));
	return values;
}

function insertSorted(values: string[], value: string): void {
	let at = 0;
	while (at < values.length && values[at]! < value) at += 1;
	values.splice(at, 0, value);
}

/**
 * The structure the normalization pass reads: the root order, each stored
 * block's `children`, which arrays list each id, and which ids are stored.
 * Built from the whole document once, then advanced at every structural
 * write — the apply executors, the pass's own repairs, and a remote or undo
 * commit's delta — so a structural commit reads what it changed rather than
 * the document (SCALE2). `build` is the full read the advance must equal.
 */
export class NormalizePassIndex {
	/** `blockOrder`, entry for entry. */
	readonly rootIds: string[];
	/** Entries per id in `blockOrder`. */
	readonly rootCount: Map<string, number>;
	/** Each stored block's `children` array, entry for entry. */
	readonly childrenByParent: Map<string, string[]>;
	/** The parents whose `children` list each id, sorted, so every peer resolves the same one. */
	readonly parentsByChild: Map<string, string[]>;
	/** Ids with a `doc.blocks` entry. */
	readonly liveIds: Set<string>;
	/** Listed ids with no `doc.blocks` entry: deleted (dangling) or not yet arrived (COL4). */
	readonly unstoredListed: Set<string>;
	/** Ids `blockOrder` lists more than once (COL4). */
	private repeatedRoots = 0;
	/**
	 * Each root's position, while no id is listed twice: built on first
	 * lookup over `rootIds` itself, which it then splices, so resolving a
	 * position reads no scan of the order (SCALE2).
	 */
	private positions: PositionedList | null = null;

	private constructor(rootIds: string[]) {
		this.rootIds = rootIds;
		this.rootCount = new Map();
		this.childrenByParent = new Map();
		this.parentsByChild = new Map();
		this.liveIds = new Set();
		this.unstoredListed = new Set();
	}

	static build(doc: PenDocument): NormalizePassIndex {
		const order = doc.blockOrder as unknown as CRDTUnknownArray<string>;
		const index = new NormalizePassIndex(readIds(order));
		for (const id of index.rootIds) {
			const count = (index.rootCount.get(id) ?? 0) + 1;
			index.rootCount.set(id, count);
			if (count === 2) index.repeatedRoots += 1;
		}
		for (const [id, rawBlockMap] of doc.blocks.entries()) {
			index.liveIds.add(id);
			if (!isCRDTMap(rawBlockMap)) continue;
			const children = getArrayProp<string>(rawBlockMap, "children");
			if (children) index.childrenByParent.set(id, readIds(children));
		}
		for (const [parentId, children] of index.childrenByParent) {
			for (const childId of children) index.addParent(childId, parentId);
		}
		for (const id of index.rootCount.keys()) index.settle(id);
		for (const id of index.parentsByChild.keys()) index.settle(id);
		return index;
	}

	isInRootOrder(blockId: string): boolean {
		return this.rootCount.has(blockId);
	}

	/** The first `blockOrder` index holding the id, or -1. */
	rootIndexOf(blockId: string): number {
		const positions = this.rootPositions();
		return positions ? positions.indexOf(blockId) : this.rootIds.indexOf(blockId);
	}

	/** The last `blockOrder` index holding the id, or -1. */
	rootLastIndexOf(blockId: string): number {
		const positions = this.rootPositions();
		return positions ? positions.indexOf(blockId) : this.rootIds.lastIndexOf(blockId);
	}

	/** Every `blockOrder` index holding the id, ascending. */
	rootIndicesOf(blockId: string): number[] {
		const count = this.rootCount.get(blockId) ?? 0;
		if (count === 1) {
			const at = this.rootIndexOf(blockId);
			if (at >= 0) return [at];
		}
		const indices: number[] = [];
		for (let at = 0; indices.length < count; at += 1) {
			at = this.rootIds.indexOf(blockId, at);
			if (at < 0) break;
			indices.push(at);
		}
		return indices;
	}

	/**
	 * Entries naming a block whose map was deleted (`isDeleted`), ordered by
	 * array and then index, so removing them back to front keeps every
	 * remaining index valid. Walks only the arrays that list such an id.
	 */
	danglingEntries(isDeleted: (blockId: string) => boolean): StructuralEntry[] {
		const entries: StructuralEntry[] = [];
		for (const blockId of this.unstoredListed) {
			if (!isDeleted(blockId)) continue;
			for (const index of this.rootIndicesOf(blockId)) {
				entries.push({ parentId: null, blockId, index });
			}
			for (const parentId of this.parentsByChild.get(blockId) ?? []) {
				const children = this.childrenByParent.get(parentId) ?? [];
				for (let index = 0; index < children.length; index += 1) {
					if (children[index] === blockId) {
						entries.push({ parentId, blockId, index });
					}
				}
			}
		}
		return entries.sort(
			(left, right) =>
				compareParents(left.parentId, right.parentId) ||
				left.index - right.index,
		);
	}

	rootInserted(index: number, blockIds: readonly string[]): void {
		// A refused splice (an id now listed twice) changed nothing.
		if (!this.positions?.splice(index, 0, blockIds)) {
			this.positions = null;
			this.rootIds.splice(index, 0, ...blockIds);
		}
		for (const blockId of blockIds) {
			const count = (this.rootCount.get(blockId) ?? 0) + 1;
			this.rootCount.set(blockId, count);
			if (count === 2) this.repeatedRoots += 1;
			this.settle(blockId);
		}
	}

	rootDeleted(index: number, count: number): void {
		let removed = this.positions?.splice(index, count) ?? null;
		if (!removed) {
			this.positions = null;
			removed = this.rootIds.splice(index, count);
		}
		for (const blockId of removed) {
			const remaining = (this.rootCount.get(blockId) ?? 1) - 1;
			if (remaining > 0) this.rootCount.set(blockId, remaining);
			else this.rootCount.delete(blockId);
			if (remaining === 1) this.repeatedRoots -= 1;
			this.settle(blockId);
		}
	}

	/** The held positions, rebuilt once no id is listed twice; null while one is. */
	private rootPositions(): PositionedList | null {
		if (this.repeatedRoots > 0) {
			this.positions = null;
			return null;
		}
		this.positions ??= PositionedList.of(this.rootIds);
		return this.positions;
	}

	/**
	 * Re-reads one block's liveness and `children` array from its stored map
	 * (`undefined` once deleted): after the map was stored or deleted, or its
	 * array was written. O(its children).
	 */
	blockChanged(blockId: string, rawBlockMap: unknown): void {
		if (rawBlockMap === undefined) this.liveIds.delete(blockId);
		else this.liveIds.add(blockId);
		const array = isCRDTMap(rawBlockMap)
			? getArrayProp<string>(rawBlockMap, "children")
			: null;
		const previous = this.childrenByParent.get(blockId) ?? [];
		const next = array ? readIds(array) : null;
		if (next) this.childrenByParent.set(blockId, next);
		else this.childrenByParent.delete(blockId);
		const listed = new Set(next ?? []);
		for (const childId of previous) {
			if (!listed.has(childId)) this.removeParent(childId, blockId);
		}
		for (const childId of listed) this.addParent(childId, blockId);
		this.settle(blockId);
		for (const childId of previous) this.settle(childId);
		for (const childId of listed) this.settle(childId);
	}

	/**
	 * Advances the index by a commit the pass did not write (remote, undo).
	 * Returns false when the root delta does not fit the held order, so the
	 * caller drops the index.
	 */
	applyCommitDelta(
		readBlock: StoredBlockReader,
		delta: RawCommitDelta,
	): boolean {
		let at = 0;
		for (const op of delta.blockOrderDelta) {
			if (op.retain != null) {
				at += op.retain;
				if (at > this.rootIds.length) return false;
			} else if (op.delete != null) {
				if (at + op.delete > this.rootIds.length) return false;
				this.rootDeleted(at, op.delete);
			} else if (op.insert) {
				const ids = op.insert.filter(
					(id): id is string => typeof id === "string",
				);
				if (ids.length !== op.insert.length) return false;
				this.rootInserted(at, ids);
				at += ids.length;
			}
		}
		const changed = new Set<string>(delta.childArrayDeltas.keys());
		for (const [blockId, keys] of delta.blockMapChanges) {
			if (keys.size === 0 || keys.has("children")) changed.add(blockId);
		}
		for (const blockId of delta.arrivedChildArrays?.keys() ?? []) {
			changed.add(blockId);
		}
		for (const blockId of changed) {
			this.blockChanged(blockId, readBlock(blockId));
		}
		return true;
	}

	private addParent(childId: string, parentId: string): void {
		const parents = this.parentsByChild.get(childId);
		if (!parents) this.parentsByChild.set(childId, [parentId]);
		else if (!parents.includes(parentId)) insertSorted(parents, parentId);
	}

	private removeParent(childId: string, parentId: string): void {
		const parents = this.parentsByChild.get(childId);
		const at = parents?.indexOf(parentId) ?? -1;
		if (!parents || at < 0) return;
		if (parents.length === 1) this.parentsByChild.delete(childId);
		else parents.splice(at, 1);
	}

	private settle(blockId: string): void {
		const listed =
			this.rootCount.has(blockId) || this.parentsByChild.has(blockId);
		if (listed && !this.liveIds.has(blockId)) {
			this.unstoredListed.add(blockId);
		} else {
			this.unstoredListed.delete(blockId);
		}
	}
}

function compareParents(left: string | null, right: string | null): number {
	if (left === right) return 0;
	if (left === null) return -1;
	if (right === null) return 1;
	return left < right ? -1 : 1;
}
