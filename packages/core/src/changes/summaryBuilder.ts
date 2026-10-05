import type {
	RawCommitDelta,
	StructuralOriginTag,
	YArrayDelta,
	YTextDelta,
} from "@input/pen-yjs";

import { affectedBlockIdsFromSummary } from "./affectedBlocks";
import type { BlockIndexSnapshot } from "./blockIndex";
import { sortIntoDocumentOrder } from "./documentOrder";
import type {
	BlockTextChange,
	ChangeSummary,
	StructuralChange,
	TextSplice,
} from "./types";

export interface ChangeSummaryState {
	readonly commitId: number;
	readonly blockText: readonly BlockTextChange[];
	readonly structural: readonly StructuralChange[];
	readonly index?: BlockIndexSnapshot;
	/** Positions in `index.roots`, when the index keeps them. */
	readonly rootIndexOf?: (blockId: string) => number;
}

export function createChangeSummary(state: ChangeSummaryState): ChangeSummary {
	const blockText = state.blockText;
	const structural = state.structural;
	const collected = affectedBlockIdsFromSummary({ blockText, structural });
	return {
		commitId: state.commitId,
		blockText,
		structural,
		affectedBlockIds:
			state.index && collected.length > 1
				? sortIntoDocumentOrder(state.index, collected, state.rootIndexOf)
				: collected,
	};
}

export function createEmptySummary(commitId: number): ChangeSummary {
	return createChangeSummary({
		commitId,
		blockText: [],
		structural: [],
	});
}

const IGNORABLE_BLOCK_KEYS = new Set(["content", "children"]);
const TABLE_KEYS = new Set(["tableColumns", "tableContent", "rows", "cells"]);

export function logicalLengthFromStored(stored: string): number {
	return stored.length;
}

/** Reads of the index and the document a summary may need beyond the snapshot. */
export interface SummaryLookups {
	/** Whether the block map is stored; asked only for entries that name no indexed block (COL4). */
	readonly blockExists?: (blockId: string) => boolean;
	/**
	 * Whether the pre-commit index lists the id in more than one array entry
	 * (COL4). Without it, a removal scans every array for another entry.
	 */
	readonly listedMoreThanOnce?: (blockId: string) => boolean;
	/** The id's position in the pre-commit root order. Without it, sorting the affected ids scans the order. */
	readonly rootIndexOf?: (blockId: string) => number;
}

export function buildChangeSummary(
	delta: RawCommitDelta,
	index: BlockIndexSnapshot,
	commitId: number,
	lookups: SummaryLookups = {},
): ChangeSummary {
	const structuralOrigin = readStructuralOrigin(delta.originTag);
	const blockText = buildTextChanges(delta, index);
	const structural = buildStructuralChanges(
		delta,
		index,
		structuralOrigin,
		lookups,
	);
	return createChangeSummary({
		commitId,
		blockText,
		structural,
		index,
		rootIndexOf: lookups.rootIndexOf,
	});
}

function buildTextChanges(
	delta: RawCommitDelta,
	index: BlockIndexSnapshot,
): BlockTextChange[] {
	const changes: BlockTextChange[] = [];
	for (const [blockId, textDeltaList] of delta.textDeltas) {
		for (const textDelta of textDeltaList) {
			const logicalLength = logicalLengthForTextDelta(
				blockId,
				textDelta,
				index,
			);
			const { splices, formatRanges } = textDeltaToSplices(
				textDelta,
				logicalLength,
			);
			if (splices.length === 0 && formatRanges.length === 0) continue;
			changes.push({ blockId, splices, formatRanges });
		}
	}
	return changes;
}

function logicalLengthForTextDelta(
	blockId: string,
	textDelta: YTextDelta,
	index: BlockIndexSnapshot,
): number {
	const storedLength = index.lengthById.get(blockId) ?? 0;
	if (storedLength > 0) return storedLength;
	if (index.typeById.get(blockId) !== "table") return storedLength;
	return preCommitLengthFromTextDelta(textDelta);
}

function preCommitLengthFromTextDelta(delta: YTextDelta): number {
	let length = 0;
	for (const op of delta) {
		if (op.retain != null) {
			length += op.retain;
			continue;
		}
		if (op.delete != null) {
			length += op.delete;
		}
	}
	return length;
}

function textDeltaToSplices(
	delta: YTextDelta,
	_logicalLength: number,
): { splices: TextSplice[]; formatRanges: { from: number; to: number }[] } {
	const deletes: { from: number; to: number }[] = [];
	const inserts: { at: number; text: string; embed: boolean }[] = [];
	const formatRanges: { from: number; to: number }[] = [];
	let pos = 0;

	for (const op of delta) {
		if (op.retain != null) {
			if (op.attributes) {
				formatRanges.push({ from: pos, to: pos + op.retain });
			}
			pos += op.retain;
			continue;
		}
		if (op.delete != null) {
			deletes.push({ from: pos, to: pos + op.delete });
			pos += op.delete;
			continue;
		}
		if (op.insert !== undefined) {
			if (typeof op.insert === "string") {
				inserts.push({ at: pos, text: op.insert, embed: false });
			} else {
				inserts.push({ at: pos, text: "", embed: true });
			}
		}
	}

	const nextDeletes = deletes;
	const nextInserts = inserts;

	const splices: TextSplice[] = [
		...nextDeletes.map((item) => ({
			from: item.from,
			to: item.to,
			insertLength: 0,
		})),
		...nextInserts.map((item) => ({
			from: item.at,
			to: item.at,
			insertLength: item.embed ? 1 : item.text.length,
		})),
	];

	return {
		splices: mergeSplices(splices),
		formatRanges,
	};
}

function buildStructuralChanges(
	delta: RawCommitDelta,
	index: BlockIndexSnapshot,
	structuralOrigin: StructuralOriginTag | null,
	{ blockExists, listedMoreThanOnce }: SummaryLookups,
): StructuralChange[] {
	const structural: StructuralChange[] = [];
	const edits = collectArrayEdits(delta, index, listedMoreThanOnce);
	const removed = edits.removed;
	addReplacedChildArrays(removed, delta, index);
	if (delta.arrivedChildArrays?.size) {
		addInsertedDescendants(edits.inserted, delta.arrivedChildArrays);
	}
	const splitNewId =
		structuralOrigin?.kind === "split" ? structuralOrigin.newBlockId : null;

	// COL4: an inserted entry can name no block — an undo restoring an
	// order entry a peer's delete orphaned, a peer's move re-inserting an
	// entry for a block deleted here (once, or again beside an earlier such
	// entry), or a move arriving with the delete of the block it moves. It is
	// no insert and no move. One the index never held is reported removed
	// where it sits; one it held is reported removed where it sat, by the
	// removal or deleted-map paths below. Asked only for entries whose map
	// neither arrived in the commit nor was stored, or was stored and left
	// in it, so an ordinary insert or move reads nothing (SCALE2).
	// A stored block whose entry an earlier commit removed without deleting
	// it (COL4: an orphan the next pass re-homes, an out-of-order delivery
	// whose re-insert lands late) brings its `children`-array subtree back
	// with its new entry, and no array edit names those descendants: each
	// one the commit does not place itself is reported inserted where the
	// pre-commit index holds it, mirroring the removal. Bounded by the
	// re-entering subtrees (SCALE2).
	const reentered = new Set<string>();
	const reportReenteredDescendants = (blockId: string) => {
		if (!index.typeById.has(blockId) || reentered.has(blockId)) return;
		reentered.add(blockId);
		const children = index.childrenByParentId.get(blockId) ?? [];
		for (let at = 0; at < children.length; at += 1) {
			const childId = children[at]!;
			if (insertedIds.has(childId) || removedIds.has(childId)) continue;
			if (!index.typeById.has(childId)) continue;
			structural.push({
				type: "block-inserted",
				blockId: childId,
				parentId: blockId,
				index: at,
			});
			reportReenteredDescendants(childId);
		}
	};

	const danglingInserted: ArrayInsert[] = [];
	const inserted: ArrayInsert[] = [];
	for (const item of edits.inserted) {
		const held = index.typeById.has(item.id);
		const mapChange = delta.blockMapChanges.get(item.id);
		if (
			blockExists &&
			item.id !== splitNewId &&
			(held ? mapChange?.size === 0 : mapChange === undefined) &&
			!blockExists(item.id)
		) {
			if (!held) danglingInserted.push(item);
			continue;
		}
		inserted.push(item);
	}

	const insertedIds = new Set(inserted.map((item) => item.id));
	const removedIds = new Set(removed.map((item) => item.id));
	const removedById = new Map(removed.map((item) => [item.id, item]));
	const mergeSourceId =
		structuralOrigin?.kind === "merge"
			? structuralOrigin.sourceBlockId
			: null;

	if (structuralOrigin?.kind === "split") {
		structural.push({
			type: "block-split",
			blockId: structuralOrigin.blockId,
			newBlockId: structuralOrigin.newBlockId,
			offset: structuralOrigin.offset,
		});
	}
	if (structuralOrigin?.kind === "merge") {
		// The source's array entry leaves with no `block-removed` (OB1); its
		// pre-commit position travels on the recipe instead.
		const vacated = removedById.get(structuralOrigin.sourceBlockId);
		structural.push({
			type: "blocks-merged",
			targetBlockId: structuralOrigin.targetBlockId,
			sourceBlockId: structuralOrigin.sourceBlockId,
			joinOffset:
				index.lengthById.get(structuralOrigin.targetBlockId) ?? 0,
			...(vacated
				? { sourceParentId: vacated.parentId, sourceIndex: vacated.index }
				: {}),
		});
	}

	for (const item of inserted) {
		if (item.id === splitNewId) continue;
		if (removedIds.has(item.id) || index.parentById.has(item.id)) {
			// An entry deleted and re-inserted moved, even back to the same
			// index: the index is pre-commit, `item.index` post-commit, and
			// another edit before it can make the two numbers agree.
			const removal = removedById.get(item.id);
			const fromParentId =
				removal?.parentId ?? index.parentById.get(item.id) ?? null;
			const fromIndex =
				removal?.index ??
				(index.childrenByParentId.get(fromParentId) ?? []).indexOf(
					item.id,
				);
			if (
				!removal &&
				!item.repair &&
				fromParentId === item.parentId &&
				fromIndex === item.index
			) {
				// A child an arrived array lists where the index held it
				// did not move. An array edit inserting an id the commit
				// removed nowhere adds a second entry (COL4: two peers moved
				// the block to one place) that landed directly before the
				// first: the list gained an entry, so it is reported.
				if (item.arrived) continue;
				structural.push({
					type: "block-inserted",
					blockId: item.id,
					parentId: item.parentId,
					index: item.index,
				});
				continue;
			}
			structural.push({
				type: "block-moved",
				blockId: item.id,
				fromParentId,
				fromIndex: Math.max(0, fromIndex),
				toParentId: item.parentId,
				toIndex: item.index,
			});
			continue;
		}
		structural.push({
			type: "block-inserted",
			blockId: item.id,
			parentId: item.parentId,
			index: item.index,
		});
		reportReenteredDescendants(item.id);
	}

	const reported = new Set<string>();
	const reportRemoved = (
		blockId: string,
		parentId: string | null,
		at: number,
	) => {
		if (reported.has(blockId)) return;
		reported.add(blockId);
		structural.push({ type: "block-removed", blockId, parentId, index: at });
		reportRemovedDescendants(blockId);
	};
	// A removed block takes its `children`-array subtree out of the document
	// with it: those entries live in the removed block, so no array edit names
	// them. Report each descendant the commit did not re-home elsewhere, so a
	// per-block index drops it. Bounded by the removed subtree (SCALE2).
	const reportRemovedDescendants = (blockId: string) => {
		const children = index.childrenByParentId.get(blockId) ?? [];
		for (let at = 0; at < children.length; at += 1) {
			const childId = children[at]!;
			if (insertedIds.has(childId) || childId === splitNewId) continue;
			reportRemoved(childId, blockId, at);
		}
	};

	// COL4: concurrent moves can list a block in two arrays; a repair that
	// removes one entry leaves it in the other, where it now renders.
	let listings: ReadonlyMap<string, readonly (string | null)[]> | null = null;
	const survivingParent = (item: (typeof removed)[number]) => {
		if (listedMoreThanOnce && !listedMoreThanOnce(item.id)) return undefined;
		listings ??= parentListings(index);
		for (const parentId of listings.get(item.id) ?? []) {
			if (parentId === item.parentId) continue;
			// A parent removed with it takes that entry out too.
			if (
				parentId !== null &&
				removedIds.has(parentId) &&
				!insertedIds.has(parentId)
			)
				continue;
			const alsoRemoved = removed.some(
				(other) => other.id === item.id && other.parentId === parentId,
			);
			if (!alsoRemoved) return parentId;
		}
		return undefined;
	};

	for (const item of removed) {
		if (item.id === mergeSourceId) continue;
		if (insertedIds.has(item.id)) continue;
		if (item.id === splitNewId) continue;
		const survivor = survivingParent(item);
		if (survivor !== undefined) {
			structural.push({
				type: "block-moved",
				blockId: item.id,
				fromParentId: item.parentId,
				fromIndex: item.index,
				toParentId: survivor,
				toIndex: Math.max(
					0,
					(index.childrenByParentId.get(survivor) ?? []).indexOf(
						item.id,
					),
				),
			});
			continue;
		}
		reportRemoved(item.id, item.parentId, item.index);
	}
	// Reported removed where it sits, as the COL4 delete-versus-move entry
	// below is, so per-block indexes and renderers skip it.
	for (const item of danglingInserted) {
		reportRemoved(item.id, item.parentId, item.index);
	}

	const newIds = new Set<string>([
		...inserted
			.filter((item) => !index.parentById.has(item.id))
			.map((item) => item.id),
		...(splitNewId ? [splitNewId] : []),
	]);

	// COL4: a remote delete against a concurrent move drops the block's map
	// entry while the move keeps its order entry, so no array edit names it.
	// The block is gone all the same; report it removed where it sat.
	if (blockExists) {
		for (const [blockId, keys] of delta.blockMapChanges) {
			if (
				keys.size > 0 ||
				removedIds.has(blockId) ||
				newIds.has(blockId)
			) {
				continue;
			}
			const parentId = index.parentById.get(blockId) ?? null;
			const at = (index.childrenByParentId.get(parentId) ?? []).indexOf(
				blockId,
			);
			if (!index.typeById.has(blockId)) {
				// The converse: a map arriving for an entry an array already
				// lists (an undo or redo restoring a block whose entry a peer
				// moved) brings the block back where that entry sits.
				if (at >= 0 && blockExists(blockId)) {
					structural.push({
						type: "block-inserted",
						blockId,
						parentId,
						index: at,
					});
				}
				continue;
			}
			if (blockExists(blockId)) continue;
			reportRemoved(blockId, parentId, Math.max(0, at));
		}
	}

	for (const [blockId, keys] of delta.blockMapChanges) {
		if (newIds.has(blockId)) continue;
		const keyList = [...keys];
		const residual = keyList.filter(
			(key) => !IGNORABLE_BLOCK_KEYS.has(key),
		);
		if (residual.length === 0) continue;

		// `table-changed` names a grid structure change only; a table's props
		// or meta change is `block-props-changed` like any other block's (A5).
		if (residual.some((key) => TABLE_KEYS.has(key))) {
			structural.push({ type: "table-changed", blockId });
		}
		const propKeys = residual.filter((key) => !TABLE_KEYS.has(key));
		if (propKeys.length > 0) {
			structural.push({
				type: "block-props-changed",
				blockId,
				keys: propKeys,
			});
		}
	}

	if (delta.appChanges.size > 0) {
		structural.push({
			type: "apps-changed",
			appIds: [...delta.appChanges],
		});
	}
	if (delta.metadataChanges.size > 0) {
		structural.push({
			type: "metadata-changed",
			namespaces: [...delta.metadataChanges],
		});
	}

	return structural;
}

/**
 * A `children` key replaced or removed on a block the index already held —
 * two peers' concurrent first-child inserts each create an array and Yjs
 * keeps one, or an undo takes back the array a first child created — drops
 * every entry of the array it replaced, and no array edit names them. Each
 * entry the new array (`arrivedChildArrays`, absent when empty or gone) does
 * not list is reported removed from the old one; one the commit placed
 * elsewhere reads as a move. Bounded by the replaced arrays (SCALE2).
 */
function addReplacedChildArrays(
	removed: { id: string; parentId: string | null; index: number }[],
	delta: RawCommitDelta,
	index: BlockIndexSnapshot,
): void {
	for (const [blockId, keys] of delta.blockMapChanges) {
		if (!keys.has("children") || !index.typeById.has(blockId)) continue;
		// An array edited in place reports its own delta.
		if (delta.childArrayDeltas.has(blockId)) continue;
		const pre = index.childrenByParentId.get(blockId) ?? [];
		if (pre.length === 0) continue;
		const kept = new Set(delta.arrivedChildArrays?.get(blockId) ?? []);
		for (let at = 0; at < pre.length; at += 1) {
			const childId = pre[at]!;
			if (!kept.has(childId)) removed.push({ id: childId, parentId: blockId, index: at });
		}
	}
}

/**
 * A block inserted with a `children` array — an undo restoring a deleted
 * container, a peer's insert — brings that subtree into the document, and no
 * array edit names it: the array arrived inside the new block map, and the
 * summary source reads it from there (`arrivedChildArrays`). Each
 * descendant is added as an insert into its parent's array, so it reports
 * `block-inserted`, or `block-moved` when it sat elsewhere before, and a
 * per-block index reads it. An entry is added once per array, so a block
 * the same commit also lists in another array (concurrent moves into two
 * containers, COL4) reports both. Bounded by the inserted subtrees (SCALE2).
 */
function addInsertedDescendants(
	inserted: ArrayInsert[],
	arrivedChildArrays: ReadonlyMap<string, readonly string[]>,
): void {
	const entryKey = (parentId: string | null, blockId: string) =>
		`${parentId ?? ""}\u0000${blockId}`;
	const listed = new Set(inserted.map((item) => entryKey(item.parentId, item.id)));
	const walked = new Set<string>();
	const visit = (blockId: string) => {
		if (walked.has(blockId)) return;
		walked.add(blockId);
		const children = arrivedChildArrays.get(blockId) ?? [];
		for (let at = 0; at < children.length; at += 1) {
			const childId = children[at]!;
			const key = entryKey(blockId, childId);
			if (!listed.has(key)) {
				listed.add(key);
				inserted.push({ id: childId, parentId: blockId, index: at, arrived: true });
			}
			visit(childId);
		}
	};
	// A child the index already held there reads as an unmoved move and is
	// dropped with the other no-op moves. An array set on a block that was
	// already present (created by its first child) is walked from its owner.
	for (const item of [...inserted]) visit(item.id);
	for (const blockId of arrivedChildArrays.keys()) visit(blockId);
}

/** Every array (`null` for the root order) that lists each id before the commit. */
function parentListings(
	index: BlockIndexSnapshot,
): Map<string, (string | null)[]> {
	const listings = new Map<string, (string | null)[]>();
	for (const [parentId, children] of index.childrenByParentId) {
		for (const childId of children) {
			const parents = listings.get(childId);
			if (!parents) listings.set(childId, [parentId]);
			else if (!parents.includes(parentId)) parents.push(parentId);
		}
	}
	return listings;
}

/**
 * An id an array edit placed. `repair` marks the surviving entry of a
 * duplicate the commit removed (COL4): it reports as a move even when the
 * surviving entry is where the block already rendered, because its sibling
 * list lost an entry. `arrived` marks an entry of an array that arrived
 * whole, which names a block the index may already hold there.
 */
interface ArrayInsert {
	readonly id: string;
	readonly parentId: string | null;
	readonly index: number;
	readonly repair?: boolean;
	/** Read from an array that arrived whole (`arrivedChildArrays`), not from an array edit. */
	readonly arrived?: boolean;
}

function collectArrayEdits(
	delta: RawCommitDelta,
	index: BlockIndexSnapshot,
	listedMoreThanOnce: SummaryLookups["listedMoreThanOnce"],
): {
	inserted: ArrayInsert[];
	removed: { id: string; parentId: string | null; index: number }[];
} {
	const inserted: ArrayInsert[] = [];
	const removed: { id: string; parentId: string | null; index: number }[] =
		[];

	const rootEdits = interpretArrayDelta(
		index.roots,
		delta.blockOrderDelta,
		listedMoreThanOnce,
	);
	inserted.push(
		...rootEdits.inserted.map((item) => ({ ...item, parentId: null })),
	);
	removed.push(
		...rootEdits.removed.map((item) => ({ ...item, parentId: null })),
	);

	for (const [parentId, arrayDelta] of delta.childArrayDeltas) {
		const pre = index.childrenByParentId.get(parentId) ?? [];
		const edits = interpretArrayDelta(pre, arrayDelta, listedMoreThanOnce);
		inserted.push(...edits.inserted.map((item) => ({ ...item, parentId })));
		removed.push(...edits.removed.map((item) => ({ ...item, parentId })));
	}

	return { inserted, removed };
}

function interpretArrayDelta(
	pre: readonly string[],
	delta: YArrayDelta,
	listedMoreThanOnce: SummaryLookups["listedMoreThanOnce"],
): {
	inserted: Omit<ArrayInsert, "parentId">[];
	removed: { id: string; index: number }[];
} {
	const inserted: Omit<ArrayInsert, "parentId">[] = [];
	const removed: { id: string; index: number }[] = [];
	let oldIndex = 0;
	let newIndex = 0;

	for (const op of delta) {
		if (op.retain != null) {
			oldIndex += op.retain;
			newIndex += op.retain;
			continue;
		}
		if (op.delete != null) {
			for (let i = 0; i < op.delete; i++) {
				const id = pre[oldIndex];
				if (id != null) removed.push({ id, index: oldIndex });
				oldIndex += 1;
			}
			continue;
		}
		if (op.insert) {
			for (const value of op.insert) {
				if (typeof value === "string") {
					inserted.push({ id: value, index: newIndex });
					newIndex += 1;
				}
			}
		}
	}

	// A repair of a duplicate entry (COL4) removes one entry and leaves the
	// block listed at the other: that is a move to the surviving entry.
	const survivors = survivingDuplicates(
		pre,
		delta,
		removed,
		listedMoreThanOnce,
	);
	if (survivors.size === 0) return { inserted, removed };
	for (const [id, at] of survivors)
		inserted.push({ id, index: at, repair: true });
	return {
		inserted,
		removed: removed.filter((item) => !survivors.has(item.id)),
	};
}

/**
 * The post-commit index of each removed id the array still holds at another
 * entry. Reads only the in-memory pre-commit array, and walks the delta only
 * when the array lost an id it held more than once.
 */
function survivingDuplicates(
	pre: readonly string[],
	delta: YArrayDelta,
	removed: readonly { id: string; index: number }[],
	listedMoreThanOnce: SummaryLookups["listedMoreThanOnce"],
): Map<string, number> {
	const survivors = new Map<string, number>();
	if (removed.length === 0) return survivors;
	// An id the index lists once cannot sit in this array twice, so an
	// ordinary removal reads no array (SCALE2).
	if (
		listedMoreThanOnce &&
		!removed.some((item) => listedMoreThanOnce(item.id))
	) {
		return survivors;
	}
	const removedIds = new Set(removed.map((item) => item.id));
	let repeated = false;
	const seen = new Set<string>();
	for (const id of pre) {
		if (!removedIds.has(id)) continue;
		if (seen.has(id)) {
			repeated = true;
			break;
		}
		seen.add(id);
	}
	if (!repeated) return survivors;
	const keep = (id: string | undefined, at: number) => {
		if (id !== undefined && removedIds.has(id) && !survivors.has(id))
			survivors.set(id, at);
	};
	let oldIndex = 0;
	let newIndex = 0;
	for (const op of delta) {
		if (op.retain != null) {
			for (let i = 0; i < op.retain; i++)
				keep(pre[oldIndex + i], newIndex + i);
			oldIndex += op.retain;
			newIndex += op.retain;
		} else if (op.delete != null) {
			oldIndex += op.delete;
		} else if (op.insert) {
			newIndex += op.insert.length;
		}
	}
	for (let i = oldIndex; i < pre.length; i++)
		keep(pre[i], newIndex + i - oldIndex);
	return survivors;
}

function mergeSplices(splices: readonly TextSplice[]): TextSplice[] {
	if (splices.length === 0) return [];
	const sorted = [...splices].sort((a, b) => a.from - b.from || a.to - b.to);
	const merged: { from: number; to: number; insertLength: number }[] = [];
	for (const splice of sorted) {
		const last = merged[merged.length - 1];
		if (last && splice.from <= last.to) {
			last.to = Math.max(last.to, splice.to);
			last.insertLength += splice.insertLength;
			continue;
		}
		merged.push({
			from: splice.from,
			to: splice.to,
			insertLength: splice.insertLength,
		});
	}
	return merged;
}

function readStructuralOrigin(tag: unknown): StructuralOriginTag | null {
	if (tag == null || typeof tag !== "object") return null;
	const structural = (tag as { structural?: unknown }).structural;
	if (!isStructuralOriginTag(structural)) return null;
	return structural;
}

function isStructuralOriginTag(value: unknown): value is StructuralOriginTag {
	if (value == null || typeof value !== "object") return false;
	const kind = (value as { kind?: unknown }).kind;
	return kind === "split" || kind === "merge";
}
