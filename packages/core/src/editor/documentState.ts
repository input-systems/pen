// DocumentStateImpl's public members are the `DocumentState` interface, read
// through `editor.documentState`; fallow cannot follow interface dispatch.
// fallow-ignore-file unused-class-member
import type {
	CRDTArray,
	CRDTDocument,
	CRDTMap,
	DocumentState,
	DocumentProfile,
	PenDocument,
	SchemaRegistry,
	BlockHandle,
} from "@input/pen-types";
import type { YArrayDelta } from "@input/pen-yjs";
import type { StoredBlockReader } from "../changes/blockIndex";
import { createBlockHandle } from "../schema/handles";
import { PositionedList } from "./positionedList";

type CRDTBlockMap = CRDTMap<CRDTMap<unknown>>;

const EMPTY_CHILD_IDS: readonly string[] = Object.freeze([]);

/**
 * The root order with each id's position. A root order that lists an id
 * twice (COL4, until normalization repairs it) is held as a plain copy whose
 * index keeps each id's last entry, and rebuilds on every root edit.
 */
type RootOrder =
	| { readonly kind: "unique"; readonly list: PositionedList }
	| {
			readonly kind: "repeated";
			readonly ids: readonly string[];
			readonly index: ReadonlyMap<string, number>;
	  };

/**
 * The nested preorder. `repeats` records that the walk met a block twice
 * (an id listed by two arrays, COL4): a root edit cannot then tell which
 * entry renders it, so it drops the preorder instead of patching it.
 */
type Preorder = { readonly list: PositionedList; readonly repeats: boolean };

/** Ids the root order gained or lost since the last `incrementalUpdate`. */
type RootEdits = { readonly inserted: Set<string>; readonly removed: Set<string> };

function rootOrderOf(ids: string[]): RootOrder {
	const list = PositionedList.of([...ids]);
	if (list) return { kind: "unique", list };
	const index = new Map<string, number>();
	for (let at = 0; at < ids.length; at += 1) index.set(ids[at]!, at);
	return { kind: "repeated", ids, index };
}

function emptyRootEdits(): RootEdits {
	return { inserted: new Set(), removed: new Set() };
}

export class DocumentStateImpl implements DocumentState {
	private _roots: RootOrder;
	/** `blockOrder`'s array, copied on first read after a root edit so a held one never changes. */
	private _blockOrderSnapshot: readonly string[] | null = null;
	private _rootEdits: RootEdits = emptyRootEdits();
	private _parentIndex: Map<string, string>;
	private _childIndex: Map<string, string[]>;
	private _generation = 0;
	/** Nested preorder, built on first read; root edits patch it, `children` edits drop it. */
	private _preorder: Preorder | null = null;
	private _preorderSnapshot: readonly string[] | null = null;
	/**
	 * The top-level list (`blockOrder` without parent-claimed blocks), built
	 * on first read; root edits and `parentId` placements patch it, a rebuild
	 * drops it.
	 */
	private _topLevel: RootOrder | null = null;
	private _topLevelSnapshot: readonly string[] | null = null;
	private _documentProfile: DocumentProfile;
	private _doc: PenDocument;
	private _crdtDoc: CRDTDocument;
	private readonly _registry: SchemaRegistry;

	constructor(
		doc: PenDocument,
		crdtDoc: CRDTDocument,
		registry: SchemaRegistry,
		documentProfile: DocumentProfile,
	) {
		this._doc = doc;
		this._crdtDoc = crdtDoc;
		this._registry = registry;
		this._documentProfile = documentProfile;
		this._roots = rootOrderOf([]);
		this._parentIndex = new Map();
		this._childIndex = new Map();
		this.rebuild();
	}

	get blockOrder(): readonly string[] {
		const roots = this._roots;
		if (roots.kind === "repeated") return roots.ids;
		this._blockOrderSnapshot ??= roots.list.ids.slice();
		return this._blockOrderSnapshot;
	}

	private _rootIds(): readonly string[] {
		const roots = this._roots;
		return roots.kind === "unique" ? roots.list.ids : roots.ids;
	}

	private _inRootOrder(blockId: string): boolean {
		const roots = this._roots;
		return roots.kind === "unique"
			? roots.list.has(blockId)
			: roots.index.has(blockId);
	}

	get documentProfile(): DocumentProfile {
		return this._documentProfile;
	}

	get blockCount(): number {
		let count = 0;
		for (const _block of this.allBlocks()) {
			count += 1;
		}
		return count;
	}

	get generation(): number {
		return this._generation;
	}

	get isEmpty(): boolean {
		return this._rootIds().length === 0;
	}

	/**
	 * Document-wide traversal, including nested and layout children, matching
	 * `editor.blocks()`. Use `blockOrder` for the top-level sequence.
	 */
	get blocks(): Iterable<BlockHandle> {
		return this.allBlocks();
	}

	indexOf(blockId: string): number {
		const roots = this._roots;
		return roots.kind === "unique"
			? roots.list.indexOf(blockId)
			: (roots.index.get(blockId) ?? -1);
	}

	blockAt(index: number): string | null {
		return this._rootIds()[index] ?? null;
	}

	parentOf(blockId: string): string | null {
		return this._parentIndex.get(blockId) ?? null;
	}

	childrenOf(blockId: string): readonly string[] {
		return this._childIndex.get(blockId) ?? EMPTY_CHILD_IDS;
	}

	preorderIndexOf(blockId: string): number {
		return this._preorderCache().list.indexOf(blockId);
	}

	/** A fresh array after every change, so a held one never changes. */
	preorderBlockIds(): readonly string[] {
		this._preorderSnapshot ??= this._preorderCache().list.ids.slice();
		return this._preorderSnapshot;
	}

	rootBlockIds(): readonly string[] {
		const top = this._topLevelCache();
		if (top.kind === "repeated") return top.ids;
		this._topLevelSnapshot ??= top.list.ids.slice();
		return this._topLevelSnapshot;
	}

	rootBlockIndexOf(blockId: string): number {
		const top = this._topLevelCache();
		return top.kind === "unique"
			? top.list.indexOf(blockId)
			: (top.index.get(blockId) ?? -1);
	}

	private _topLevelCache(): RootOrder {
		this._topLevel ??= rootOrderOf(
			this._rootIds().filter((id) => !this._parentIndex.has(id)),
		);
		return this._topLevel;
	}

	private _dropTopLevel(): void {
		this._topLevel = null;
		this._topLevelSnapshot = null;
	}

	/** The held top-level list when it can be patched; a repeated one is dropped. */
	private _patchableTopLevel(): PositionedList | null {
		if (this._topLevel?.kind === "repeated") this._dropTopLevel();
		return this._topLevel?.kind === "unique" ? this._topLevel.list : null;
	}

	/** Takes `blockId` out of the held top-level list, if it lists it. */
	private _leaveTopLevel(blockId: string): void {
		const top = this._patchableTopLevel();
		if (!top?.has(blockId)) return;
		this._topLevelSnapshot = null;
		if (!top.splice(top.indexOf(blockId), 1)) this._dropTopLevel();
	}

	/**
	 * Puts a root the order gained at `index` into the held top-level list,
	 * after the nearest top-level root before it. O(the claimed blocks
	 * between them).
	 */
	private _joinTopLevel(roots: PositionedList, blockId: string, index: number): void {
		const top = this._patchableTopLevel();
		if (!top || this._parentIndex.has(blockId)) return;
		let at = 0;
		for (let k = index - 1; k >= 0; k -= 1) {
			const previous = roots.ids[k]!;
			if (top.has(previous)) {
				at = top.indexOf(previous) + 1;
				break;
			}
		}
		this._topLevelSnapshot = null;
		if (!top.splice(at, 0, [blockId])) this._dropTopLevel();
	}

	private _dropPreorder(): void {
		this._preorder = null;
		this._preorderSnapshot = null;
	}

	private _preorderCache(): Preorder {
		if (this._preorder) return this._preorder;
		const ids: string[] = [];
		const seen = new Set<string>();
		let repeats = false;
		const blocks = this._doc.blocks as CRDTBlockMap;
		const visit = (id: string): void => {
			if (seen.has(id)) {
				repeats = true;
				return;
			}
			// A dangling entry (COL4) names no block: skip it until the
			// structural pass removes it, as renderers do.
			const blockMap = blocks.get(id);
			if (!blockMap) return;
			seen.add(id);
			ids.push(id);
			const children = blockMap.get("children") as CRDTArray<string> | undefined;
			if (!children) return;
			for (let i = 0; i < children.length; i++) visit(children.get(i));
		};
		for (const id of this._rootIds()) visit(id);
		this._preorder = { list: PositionedList.of(ids)!, repeats };
		this._preorderSnapshot = null;
		return this._preorder;
	}

	/**
	 * Removes the preorder span of the roots at `[at, at + count)`: from the
	 * first of them the preorder holds to the next root after them it holds.
	 * Without repeats each held root starts its own contiguous subtree, so
	 * the span is exactly their subtrees. O(span) plus array moves.
	 */
	private _removeRootSpans(
		preorder: PositionedList,
		roots: PositionedList,
		at: number,
		count: number,
	): boolean {
		let start = -1;
		for (let k = at; k < at + count && start < 0; k += 1) {
			start = preorder.indexOf(roots.ids[k]!);
		}
		if (start < 0) return true;
		const end = this._nextRootSpan(preorder, roots, at + count);
		if (end < start) return false;
		return preorder.splice(start, end - start) !== null;
	}

	/** Where the first root at `from` or after it that the preorder holds starts, or the end. */
	private _nextRootSpan(
		preorder: PositionedList,
		roots: PositionedList,
		from: number,
	): number {
		for (let k = from; k < roots.length; k += 1) {
			const position = preorder.indexOf(roots.ids[k]!);
			if (position >= 0) return position;
		}
		return preorder.length;
	}

	/**
	 * Walks a root the order gained, through `children` arrays as the full
	 * build does. Null when it meets a block the preorder already holds or
	 * meets one twice: the first entry would then win somewhere else.
	 */
	private _rootSubtree(
		preorder: PositionedList,
		rootId: string,
		readBlock: StoredBlockReader,
	): string[] | null {
		const ids: string[] = [];
		const seen = new Set<string>();
		let repeated = false;
		const visit = (id: string, isRoot: boolean): void => {
			if (repeated) return;
			if (seen.has(id) || preorder.has(id)) {
				repeated = true;
				return;
			}
			const blockMap = (isRoot ? readBlock(id) : (this._doc.blocks as CRDTBlockMap).get(id)) as
				| CRDTMap<unknown>
				| undefined;
			if (!blockMap) return;
			seen.add(id);
			ids.push(id);
			const children = blockMap.get("children") as CRDTArray<string> | undefined;
			if (!children) return;
			for (let i = 0; i < children.length; i++) visit(children.get(i), false);
		};
		visit(rootId, true);
		return repeated ? null : ids;
	}

	/**
	 * Skips an order or children entry whose block map is gone (COL4): a
	 * concurrent move can re-insert an entry a concurrent delete removed, and
	 * a handle for it would throw on every read until the structural pass
	 * removes the entry.
	 */
	*allBlocks(): Iterable<BlockHandle> {
		const seen = new Set<string>();
		for (const id of this._rootIds()) {
			yield* this._visitBlock(id, seen);
		}
	}

	rebuild(): void {
		this._dropPreorder();
		this._dropTopLevel();
		this._blockOrderSnapshot = null;
		this._rootEdits = emptyRootEdits();
		const order = this._doc.blockOrder;
		this._parentIndex = new Map();
		this._childIndex = new Map();

		const rootIds: string[] = [];
		for (let i = 0; i < order.length; i++) {
			rootIds.push(order.get(i) as string);
		}
		this._roots = rootOrderOf(rootIds);

		const nestedChildIds = new Set<string>();
		const parentIdChildIds: string[] = [];

		for (const [blockId, blockMap] of (
			this._doc.blocks as CRDTBlockMap
		).entries()) {
			const props = blockMap.get("props") as CRDTMap<unknown> | undefined;
			if (props?.get?.("parentId")) {
				this._parentIndex.set(blockId, props.get("parentId") as string);
				parentIdChildIds.push(blockId);
			}
			const children = blockMap.get("children") as
				| CRDTArray<string>
				| undefined;
			if (children && children.length > 0) {
				const childIds: string[] = [];
				for (let i = 0; i < children.length; i++) {
					const childId = children.get(i);
					this._parentIndex.set(childId, blockId);
					nestedChildIds.add(childId);
					childIds.push(childId);
				}
				this._childIndex.set(blockId, childIds);
			}
		}

		// the block map iterates in arbitrary order, so `parentId` children are
		// sorted back into `blockOrder` sequence before being indexed
		parentIdChildIds.sort((a, b) => this.indexOf(a) - this.indexOf(b));

		for (const childId of parentIdChildIds) {
			if (nestedChildIds.has(childId)) continue;
			const parentId = this._parentIndex.get(childId);
			if (parentId === undefined) continue;
			const siblings = this._childIndex.get(parentId);
			if (siblings === undefined) {
				this._childIndex.set(parentId, [childId]);
			} else {
				siblings.push(childId);
			}
		}

		this._generation++;
	}

	clear(): void {
		this._dropPreorder();
		this._dropTopLevel();
		this._roots = rootOrderOf([]);
		this._blockOrderSnapshot = null;
		this._rootEdits = emptyRootEdits();
		this._parentIndex.clear();
		this._childIndex.clear();
		this._generation++;
	}

	/**
	 * Advances the root order by a transaction's `blockOrder` delta, in
	 * proportion to the edit rather than to the order (SCALE2). Called for
	 * every transaction before its commit is dispatched. A delta that does not
	 * fit the held order, or an order that lists an id twice (COL4), rebuilds.
	 */
	applyRootDelta(
		delta: YArrayDelta,
		readBlock: StoredBlockReader = (blockId) =>
			(this._doc.blocks as CRDTBlockMap).get(blockId),
	): void {
		if (delta.length === 0) return;
		const roots = this._roots;
		if (
			roots.kind !== "unique" ||
			!this._advanceRoots(roots.list, delta, readBlock)
		) {
			this.rebuild();
			return;
		}
		this._blockOrderSnapshot = null;
		this._preorderSnapshot = null;
		this._generation++;
	}

	/**
	 * Applies the delta to the root order and, when held, to the preorder:
	 * each removed root's subtree span leaves it and each gained root's
	 * subtree enters it ahead of the next root's span. A preorder it cannot
	 * patch exactly is dropped and rebuilt on next read.
	 */
	private _advanceRoots(
		list: PositionedList,
		delta: YArrayDelta,
		readBlock: StoredBlockReader,
	): boolean {
		if (this._preorder?.repeats) this._dropPreorder();
		const order = this._doc.blockOrder as CRDTArray<string>;
		// Deletes in pre-commit indexes, inserts in post-commit ones. Every
		// delete goes first, so a move within the order (an insert ahead of
		// the delete it pairs with) never lists its block twice.
		const deletes: [at: number, count: number][] = [];
		const inserts: [at: number, ids: string[]][] = [];
		let before = 0;
		let after = 0;
		for (const op of delta) {
			if (op.retain != null) {
				before += op.retain;
				after += op.retain;
			} else if (op.delete != null) {
				deletes.push([before, op.delete]);
				before += op.delete;
			} else if (op.insert) {
				const ids = op.insert.filter(
					(id): id is string => typeof id === "string",
				);
				if (ids.length !== op.insert.length) return false;
				inserts.push([after, ids]);
				after += ids.length;
			}
		}
		for (let k = deletes.length - 1; k >= 0; k -= 1) {
			const [at, count] = deletes[k]!;
			const preorder = this._preorder?.list;
			if (
				preorder &&
				at + count <= list.length &&
				!this._removeRootSpans(preorder, list, at, count)
			) {
				this._dropPreorder();
			}
			const removed = list.splice(at, count);
			if (!removed) return false;
			for (const id of removed) {
				this._rootEdits.removed.add(id);
				this._leaveTopLevel(id);
			}
		}
		const placed: [string, number][] = [];
		for (const [at, ids] of inserts) {
			if (!list.splice(at, 0, ids)) return false;
			ids.forEach((id, k) => {
				placed.push([id, at + k]);
				this._rootEdits.inserted.add(id);
			});
		}
		if (list.length !== order.length) return false;
		// A delta applied to an order that already held it lands its inserts
		// elsewhere; reading back where they landed catches that in O(inserts).
		for (const [id, index] of placed) {
			if (order.get(index) !== id) return false;
		}
		// Ascending, so each gained root finds the ones before it placed.
		for (const [id, index] of placed) this._joinTopLevel(list, id, index);
		for (const [id, index] of placed) {
			const preorder = this._preorder?.list;
			if (!preorder) break;
			const subtree = this._rootSubtree(preorder, id, readBlock);
			const at = this._nextRootSpan(preorder, list, index + 1);
			if (!subtree || !preorder.splice(at, 0, subtree)) this._dropPreorder();
		}
		return true;
	}

	/**
	 * Indexes the blocks a commit named. `readBlock` is the commit's shared
	 * block-map reader, when the change-summary source installed one.
	 */
	incrementalUpdate(
		affectedBlocks: readonly string[],
		readBlock: StoredBlockReader | null = null,
	): void {
		const rootEdits = this._rootEdits;
		this._rootEdits = emptyRootEdits();
		if (this._doc.blockOrder.length !== this._rootIds().length) {
			this.rebuild();
			return;
		}
		const blockIds = new Set(affectedBlocks);
		for (const blockId of rootEdits.inserted) blockIds.add(blockId);
		for (const blockId of rootEdits.removed) blockIds.add(blockId);
		let structural = false;
		const touchedParents = new Set<string>();
		const blocks = this._doc.blocks as CRDTBlockMap;
		for (const blockId of blockIds) {
			// Read once and handed to every check below (SCALE2 counts).
			const blockMap = (
				readBlock ? readBlock(blockId) : blocks.get(blockId)
			) as CRDTMap<unknown> | undefined;
			const placed = this._placeRootEdit(blockId, blockMap, rootEdits);
			if (placed === "rebuild") {
				this.rebuild();
				return;
			}
			if (placed === "forgotten") {
				// A removed root's span already left the preorder; a nested
				// block's parent array changed under it.
				if (this._preorder?.list.has(blockId)) this._dropPreorder();
				structural = true;
				continue;
			}
			if (placed === "placed") structural = true;
			this._dropPreorderIfChildrenTouched(blockId, blockMap);
			if (this._needsRebuild(blockId, blockMap)) {
				this.rebuild();
				return;
			}
			// A block without indexed children gaining an array is caught by
			// `_childrenChanged`; only indexed parents can have reordered.
			if (this._childIndex.has(blockId)) touchedParents.add(blockId);
			const cachedParent = this._parentIndex.get(blockId);
			if (cachedParent !== undefined) touchedParents.add(cachedParent);
		}
		let reordered = false;
		for (const parentId of touchedParents) {
			const order = this._childOrderChange(parentId);
			if (order === "rebuild") {
				this.rebuild();
				return;
			}
			if (order) {
				this._childIndex.set(parentId, order);
				reordered = true;
			}
		}
		if (reordered) this._dropPreorder();
		if (reordered || structural) this._generation++;
	}

	/**
	 * Indexes what a commit did to one block at the root level without a
	 * rebuild: a removed block leaves the parent and child indexes, a block
	 * the root order gained under a `parentId` joins its parent's children in
	 * root order. Returns `"forgotten"` for a removed block, `"placed"` when
	 * the indexes changed, `"same"` when the checks that follow decide, and
	 * `"rebuild"` for a removed block that still had children indexed.
	 */
	private _placeRootEdit(
		blockId: string,
		blockMap: CRDTMap<unknown> | undefined,
		rootEdits: RootEdits,
	): "forgotten" | "placed" | "same" | "rebuild" {
		const cachedParent = this._parentIndex.get(blockId);
		if (!blockMap) {
			// A dangling root entry (COL4) is the liveness checks' to judge.
			if (this._inRootOrder(blockId)) return "same";
			if (this._childIndex.has(blockId)) return "rebuild";
			if (cachedParent === undefined) return "forgotten";
			// A dangling `children` entry still lists it there.
			if (this._arrayLists(cachedParent, blockId)) return "same";
			this._parentIndex.delete(blockId);
			this._setChildren(
				cachedParent,
				(this._childIndex.get(cachedParent) ?? []).filter(
					(childId) => childId !== blockId,
				),
			);
			return "forgotten";
		}
		if (!rootEdits.inserted.has(blockId)) return "same";
		const parentId = readParentIdProp(blockMap);
		if (parentId === null || (cachedParent !== undefined && cachedParent !== parentId)) {
			return "same";
		}
		this._parentIndex.set(blockId, parentId);
		this._placeParentIdChild(parentId, blockId);
		this._leaveTopLevel(blockId);
		return "placed";
	}

	/**
	 * Puts a `parentId` child among its parent's children: after the parent's
	 * `children` array entries, in root order among the other `parentId`
	 * children, as `rebuild` sorts them. O(its siblings).
	 */
	private _placeParentIdChild(parentId: string, blockId: string): void {
		const siblings = (this._childIndex.get(parentId) ?? []).filter(
			(childId) => childId !== blockId,
		);
		const array = (this._doc.blocks as CRDTBlockMap)
			.get(parentId)
			?.get("children") as CRDTArray<string> | undefined;
		const position = this.indexOf(blockId);
		let at = Math.min(array?.length ?? 0, siblings.length);
		while (at < siblings.length && this.indexOf(siblings[at]!) < position) {
			at += 1;
		}
		siblings.splice(at, 0, blockId);
		this._setChildren(parentId, siblings);
	}

	private _setChildren(parentId: string, childIds: string[]): void {
		if (childIds.length > 0) this._childIndex.set(parentId, childIds);
		else this._childIndex.delete(parentId);
	}

	private _arrayLists(parentId: string, blockId: string): boolean {
		const children = (this._doc.blocks as CRDTBlockMap)
			.get(parentId)
			?.get("children") as CRDTArray<string> | undefined;
		if (!children) return false;
		for (let i = 0; i < children.length; i++) {
			if (children.get(i) === blockId) return true;
		}
		return false;
	}

	/**
	 * A reorder within one `children` array moves no block's parent, and a
	 * local move names the moved block rather than its parent, so each touched
	 * parent's array is compared with the index in O(its children) (SCALE2).
	 * Returns the new child list, `null` when the order is current, or
	 * `"rebuild"` when the cached list holds a child the array no longer has.
	 */
	private _childOrderChange(parentId: string): string[] | "rebuild" | null {
		const children = (this._doc.blocks as CRDTBlockMap)
			.get(parentId)
			?.get("children") as CRDTArray<string> | undefined;
		if (!children) return null;
		const cached = this._childIndex.get(parentId) ?? EMPTY_CHILD_IDS;
		let current = cached.length >= children.length;
		for (let i = 0; current && i < children.length; i++) {
			current = cached[i] === children.get(i);
		}
		// Entries after the array's are the `parentId` route's children.
		for (let i = children.length; current && i < cached.length; i++) {
			current = this._isParentIdChild(cached[i] as string, parentId);
		}
		if (current) return null;
		const next: string[] = [];
		const inArray = new Set<string>();
		for (let i = 0; i < children.length; i++) {
			const childId = children.get(i);
			next.push(childId);
			inArray.add(childId);
		}
		for (const childId of cached) {
			if (inArray.has(childId)) continue;
			if (!this._isParentIdChild(childId, parentId)) return "rebuild";
			next.push(childId);
		}
		return next;
	}

	private _isParentIdChild(blockId: string, parentId: string): boolean {
		const props = (this._doc.blocks as CRDTBlockMap)
			.get(blockId)
			?.get("props") as CRDTMap<unknown> | undefined;
		return props?.get?.("parentId") === parentId;
	}

	/** A children array can reorder, or vanish, without moving any block's parent. */
	private _dropPreorderIfChildrenTouched(
		blockId: string,
		blockMap: CRDTMap<unknown> | undefined,
	): void {
		if (
			this._preorder &&
			(this._childIndex.has(blockId) ||
				blockMap?.get("children") !== undefined)
		) {
			this._dropPreorder();
		}
	}

	private _needsRebuild(
		blockId: string,
		blockMap: CRDTMap<unknown> | undefined,
	): boolean {
		return (
			this._positionChanged(blockId, blockMap) ||
			this._parentChanged(blockId, blockMap) ||
			this._childrenChanged(blockId, blockMap)
		);
	}

	/**
	 * A children-array block has no blockOrder position; one the index already
	 * knows is checked through its parent instead of rebuilding on every edit
	 * inside it (SCALE2).
	 */
	private _positionChanged(
		blockId: string,
		blockMap: CRDTMap<unknown> | undefined,
	): boolean {
		const cachedIndex = this.indexOf(blockId);
		if (cachedIndex < 0) {
			return !this._isIndexedNestedChild(blockId, blockMap);
		}
		return this._doc.blockOrder.get(cachedIndex) !== blockId;
	}

	updateDocument(
		doc: PenDocument,
		crdtDoc: CRDTDocument,
		documentProfile: DocumentProfile,
	): void {
		this._doc = doc;
		this._crdtDoc = crdtDoc;
		this._documentProfile = documentProfile;
		this.rebuild();
	}

	setDocumentProfile(documentProfile: DocumentProfile): void {
		if (this._documentProfile === documentProfile) {
			return;
		}
		this._documentProfile = documentProfile;
		this._generation++;
	}

	private *_visitBlock(
		blockId: string,
		seen: Set<string>,
	): Iterable<BlockHandle> {
		if (seen.has(blockId)) return;
		seen.add(blockId);
		const blockMap = (this._doc.blocks as CRDTBlockMap).get(blockId);
		if (!blockMap) return;
		yield createBlockHandle(
			blockId,
			this._doc,
			this._crdtDoc,
			this._registry,
		);
		const children = blockMap.get("children") as
			| CRDTArray<string>
			| undefined;
		if (!children) return;
		for (let i = 0; i < children.length; i++) {
			yield* this._visitBlock(children.get(i), seen);
		}
	}

	/**
	 * Whether `blockId`'s parent differs from the index, in O(children of the
	 * cached parent) rather than a scan of every block (SCALE2). A block newly
	 * adopted into a `children` array is caught on the adopting parent, which
	 * the commit names as affected because its array changed
	 * (`_childrenChanged`); this method catches a `parentId` change and a
	 * block that left its cached parent's array.
	 */
	private _parentChanged(
		blockId: string,
		blockMap: CRDTMap<unknown> | undefined,
	): boolean {
		const cached = this._parentIndex.get(blockId);
		if (this._livenessMoved(blockId, blockMap !== undefined)) return true;
		const props = blockMap?.get("props") as CRDTMap<unknown> | undefined;
		const parentId = props?.get?.("parentId");
		if (typeof parentId === "string" && parentId !== "") {
			return parentId !== cached;
		}
		if (cached === undefined) {
			return false;
		}
		const parentMap = (this._doc.blocks as CRDTBlockMap).get(cached);
		const children = parentMap?.get("children") as
			| CRDTArray<string>
			| undefined;
		if (!children) return true;
		for (let i = 0; i < children.length; i++) {
			if (children.get(i) === blockId) return false;
		}
		return true;
	}

	/**
	 * A root entry whose block map left or arrived without an array edit: a
	 * remote delete against a concurrent move keeps the order entry (COL4),
	 * and an order entry can arrive before its block map. The preorder skips
	 * an entry without a block map, so it is rebuilt. A nested entry's
	 * liveness is caught by `_positionChanged`. Reads nothing new.
	 */
	private _livenessMoved(blockId: string, stored: boolean): boolean {
		if (!this._preorder || !this._inRootOrder(blockId)) return false;
		return this._preorder.list.has(blockId) !== stored;
	}

	private _isIndexedNestedChild(
		blockId: string,
		blockMap: CRDTMap<unknown> | undefined,
	): boolean {
		const parentId = this._parentIndex.get(blockId);
		return (
			parentId !== undefined &&
			(this._childIndex.get(parentId)?.includes(blockId) ?? false) &&
			blockMap !== undefined
		);
	}

	private _childrenChanged(
		blockId: string,
		blockMap: CRDTMap<unknown> | undefined,
	): boolean {
		const children = blockMap?.get("children") as
			| CRDTArray<string>
			| undefined;
		if (!children) return false;

		for (let i = 0; i < children.length; i++) {
			const childId = children.get(i);
			if (this._parentIndex.get(childId) !== blockId) {
				return true;
			}
		}

		return false;
	}
}

function readParentIdProp(blockMap: CRDTMap<unknown>): string | null {
	const props = blockMap.get("props") as CRDTMap<unknown> | undefined;
	const parentId = props?.get?.("parentId");
	return typeof parentId === "string" && parentId !== "" ? parentId : null;
}
