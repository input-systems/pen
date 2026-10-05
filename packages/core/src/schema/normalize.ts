import type {
	Block,
	BlockSchema,
	CRDTDocument,
	DiagnosticEvent,
	LayoutSchema,
	PenDocument,
	SchemaEngine,
	SchemaRegistry,
} from "@input/pen-types";
import {
	getArrayProp,
	getMapProp,
	getTextProp,
	isCRDTMap,
	type CRDTUnknownArray,
	type CRDTUnknownMap,
} from "../editor/crdtShapes";
import type { RawCommitDelta } from "@input/pen-yjs";
import type { StoredBlockReader } from "../changes/blockIndex";
import { ParentIdIndex } from "./parentIdIndex";
import { NormalizePassIndex } from "./passIndex";

export function sortDeltaAttributes(
	attributes: Record<string, unknown>,
	registry: SchemaRegistry,
): Record<string, unknown> {
	const keys = Object.keys(attributes);
	if (keys.length < 2) return attributes;

	const sorted = [...keys].sort((a, b) => {
		const schemaA = registry.resolveInline(a);
		const schemaB = registry.resolveInline(b);
		if (schemaA?.system || schemaB?.system) return 0;
		return (schemaA?.priority ?? 0) - (schemaB?.priority ?? 0);
	});

	const result: Record<string, unknown> = {};
	for (const key of sorted) {
		result[key] = attributes[key];
	}
	return result;
}

// ── Internal Utilities ──────────────────────────────────────

export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;

	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
	}

	const keysA = Object.keys(a as Record<string, unknown>);
	const keysB = Object.keys(b as Record<string, unknown>);
	if (keysA.length !== keysB.length) return false;
	return keysA.every((k) =>
		deepEqual(
			(a as Record<string, unknown>)[k],
			(b as Record<string, unknown>)[k],
		),
	);
}

function getMapEntries(
	map: CRDTUnknownMap | null,
): Iterable<[string, unknown]> {
	return map?.entries?.() ?? [];
}

function getLayoutDefaultValue(
	layout: LayoutSchema | undefined,
	key: string,
): unknown {
	if (!layout) return undefined;

	switch (key) {
		case "modes":
			return layout.modes;
		case "defaultMode":
			return layout.defaultMode;
		case "allowedChildren":
			return layout.allowedChildren;
		case "minChildren":
			return layout.minChildren;
		case "maxChildren":
			return layout.maxChildren;
		default:
			return undefined;
	}
}

// ── SchemaEngineImpl ────────────────────────────────────────

const MAX_ITERATIONS = 1000;

type DiagnosticSink = (event: DiagnosticEvent) => void;

export class SchemaEngineImpl implements SchemaEngine {
	private readonly registry: SchemaRegistry;
	private readonly doc: PenDocument;
	private readonly crdtDoc: CRDTDocument;
	private readonly dirtyBlockIds = new Set<string>();
	private readonly deferredBlockIds = new Set<string>();
	/** Ids a commit this engine did not normalize placed or re-parented. */
	private readonly externalStructuralIds = new Set<string>();
	private onDiagnostic: DiagnosticSink | undefined;
	private passIndex: NormalizePassIndex | null = null;
	/** Rule 10's `parentId` candidates, built on the first delete it handles. */
	private parentIdIndex: ParentIdIndex | null = null;
	/**
	 * Blocks the open transaction's ops or pass may have written since the
	 * last observed commit: their `parentId` can be newer than the index's.
	 */
	private readonly unobservedBlockIds = new Set<string>();
	/** Whether this engine wrote structure since the last observed commit. */
	private wroteStructure = false;

	constructor(
		registry: SchemaRegistry,
		doc: PenDocument,
		crdtDoc: CRDTDocument,
		onDiagnostic?: DiagnosticSink,
	) {
		this.registry = registry;
		this.doc = doc;
		this.crdtDoc = crdtDoc;
		this.onDiagnostic = onDiagnostic;
	}

	setOnDiagnostic(onDiagnostic: DiagnosticSink | undefined): void {
		this.onDiagnostic = onDiagnostic;
	}

	markDirty(blockId: string): void {
		this.dirtyBlockIds.add(blockId);
		this.unobservedBlockIds.add(blockId);
	}

	/**
	 * A commit landed. A local apply's executors and this engine's repairs
	 * advanced the pass index at each write, so it is current. Any other
	 * commit (remote, undo) advances it by the commit's delta, in proportion
	 * to what the commit touched; one this engine also wrote into outside an
	 * apply (a deferred block's normalization) cannot be told apart from the
	 * delta, so the index is dropped and rebuilt on next read.
	 */
	observeCommit(
		delta: RawCommitDelta,
		localApply: boolean,
		readBlock: StoredBlockReader,
	): void {
		const wrote = this.wroteStructure;
		this.wroteStructure = false;
		this.parentIdIndex?.applyCommitDelta(delta, readBlock);
		this.unobservedBlockIds.clear();
		if (localApply || !this.passIndex) return;
		if (wrote || !this.passIndex.applyCommitDelta(readBlock, delta)) {
			this.invalidatePassIndex();
		}
	}

	/** The pass index, built on first read; the apply executors resolve positions through it. */
	structure(): NormalizePassIndex {
		return this.getPassIndex();
	}

	/** `blockIds` were inserted into `blockOrder` at `index`. */
	noteRootInserted(index: number, blockIds: readonly string[]): void {
		this.wroteStructure = true;
		this.passIndex?.rootInserted(index, blockIds);
	}

	/** `count` entries were deleted from `blockOrder` at `index`. */
	noteRootDeleted(index: number, count: number): void {
		this.wroteStructure = true;
		this.passIndex?.rootDeleted(index, count);
	}

	/**
	 * A block map was stored or deleted (`blockMap` is then `undefined`), or
	 * its `children` array written. The caller hands over the map it holds.
	 */
	noteBlockChanged(blockId: string, blockMap: unknown): void {
		this.wroteStructure = true;
		this.passIndex?.blockChanged(blockId, blockMap);
	}

	/**
	 * A remote or undo commit — one this engine did not normalize — placed,
	 * re-parented, created, or deleted these blocks. The next local pass runs
	 * the structural rules on them (COL4), because a cycle or a duplicate
	 * entry such a commit creates is never marked dirty by a local op.
	 * Proportional to the ids the commit named, never to the document.
	 */
	notifyExternalCommit(blockIds: Iterable<string>): void {
		for (const blockId of blockIds) {
			this.externalStructuralIds.add(blockId);
		}
	}

	deferBlock(blockId: string): void {
		this.deferredBlockIds.add(blockId);
	}

	undeferBlock(blockId: string): void {
		this.deferredBlockIds.delete(blockId);
		if (this.dirtyBlockIds.has(blockId)) {
			this.normalizeBlock(blockId);
			this.dirtyBlockIds.delete(blockId);
		}
	}

	normalizeDirty(): void {
		this.normalizeExternalStructure();
		let iterations = 0;

		while (this.dirtyBlockIds.size > 0 && iterations < MAX_ITERATIONS) {
			const snapshot = [...this.dirtyBlockIds];
			if (
				snapshot.every((blockId) => this.deferredBlockIds.has(blockId))
			) {
				break;
			}

			iterations++;
			this.dirtyBlockIds.clear();
			for (const blockId of snapshot) this.unobservedBlockIds.add(blockId);

			this.doc.adapter.transact(this.crdtDoc, () => {
				for (const blockId of snapshot) {
					if (this.deferredBlockIds.has(blockId)) {
						this.dirtyBlockIds.add(blockId);
						continue;
					}
					this.normalizeBlock(blockId);
				}
			});
		}

		if (iterations >= MAX_ITERATIONS) {
			// CH5: dirty-loop cap is a diagnostic, not a console site.
			this.onDiagnostic?.({
				code: "normalize-cap",
				level: "error",
				source: "schema",
				message:
					"SchemaEngine: normalizeDirty exceeded max iterations. " +
					"Possible infinite normalization loop.",
				remediation:
					"Check block schema normalize() implementations for a cycle that keeps marking blocks dirty.",
			});
		}
	}

	normalizeAll(): void {
		this.invalidatePassIndex();
		this.parentIdIndex = null;
		for (const blockId of this.doc.blocks.keys()) {
			this.dirtyBlockIds.add(blockId);
		}
		this.normalizeDirty();
	}

	private normalizeExternalStructure(): void {
		if (this.externalStructuralIds.size === 0) return;
		const blockIds = [...this.externalStructuralIds];
		this.externalStructuralIds.clear();
		for (const blockId of blockIds) this.unobservedBlockIds.add(blockId);
		this.doc.adapter.transact(this.crdtDoc, () => {
			for (const blockId of blockIds) {
				if (this.deferredBlockIds.has(blockId)) {
					this.externalStructuralIds.add(blockId);
					continue;
				}
				if (!this.getBlockMap(blockId)) continue;
				this.normalizeStructure(blockId);
				this.rehomeOrphan(blockId);
			}
		});
	}

	// ── COL4: Orphan re-home ────────────────────────────────
	// A repair that removes one entry of a block (Rules 9 and 11, the cycle
	// break) can meet a peer's concurrent move that removed the other, and
	// the merge leaves a live block in no array. Only ids an external commit
	// touched are checked, so a local delete of a container keeps its own
	// semantics. Every peer appends the block to the root order; the entries
	// peers append concurrently are duplicates Rule 9 removes once they meet.

	private rehomeOrphan(blockId: string): void {
		if (this.isInBlockOrder(blockId) || this.findParentWithChild(blockId)) {
			return;
		}
		this.insertIntoBlockOrder(blockId, this.blockOrder.length);
		this.dirtyBlockIds.add(blockId);
		this.onDiagnostic?.({
			code: "orphan-block-rehomed",
			level: "warn",
			source: "schema",
			message: `Block "${blockId}" was in no order or children array; appended it to the root order.`,
			remediation:
				"Concurrent structural edits and repairs removed every entry for a live block. Normalization re-homes it at the end of the root order so its content stays reachable on every peer.",
		});
	}

	// ── normalizeBlock Pipeline ─────────────────────────────

	private normalizeBlock(blockId: string): void {
		const blockMap = this.getBlockMap(blockId);
		if (!blockMap) {
			this.handleDeletedBlock(blockId);
			return;
		}

		const type = blockMap.get("type") as string;
		const schema = this.registry.resolve(type);
		if (!schema) return;

		// Phase 1: Structural rules
		this.normalizeStructure(blockId);

		// Phase 2: Block-level rules
		this.stripDefaultProps(blockId, schema);
		this.runBlockNormalize(blockId, schema);

		if (this.normalizeLayout(blockId, schema)) return;

		this.ensureContentExists(blockId, schema);

		// Phase 3: Inline content rules
		if (schema.content === "inline") {
			this.stripSuperfluousMarks(blockId);
		}
	}

	private normalizeStructure(blockId: string): void {
		this.removeDanglingEntries();
		this.deduplicateBlockIds(blockId);
		this.enforceCrossArrayMembership(blockId);
		this.keepOneNestingRoute(blockId);
		this.breakParentCycle(blockId);
	}

	// ── RI6: One nesting route per block ────────────────────
	// A `parentId` child sits in `blockOrder`; a `children` child does not.
	// A block in a `children` array that also carries `parentId` (a move into
	// a container, or `set-props parentId` on a container's child, either
	// concurrent or local) is on both routes, and which parent the index
	// reports would depend on map iteration order. The `children` array is
	// where the block is stored, so it wins on every peer and the prop is
	// cleared. A `parentId` naming that same container agrees with the array
	// (convertBlockOps re-asserts it, and stored documents carry it), so it
	// is left alone.

	private keepOneNestingRoute(blockId: string): void {
		const container = this.findParentWithChild(blockId);
		if (!container) return;
		const parentId = this.readParentIdProp(blockId);
		if (!parentId || parentId === container) return;
		const blockMap = this.getBlockMap(blockId);
		const props = blockMap ? getMapProp(blockMap, "props") : null;
		props?.delete?.("parentId");
		this.onDiagnostic?.({
			code: "nesting-route-conflict",
			level: "warn",
			source: "schema",
			message: `Block "${blockId}" is in the children of "${container}" and also named "${parentId}" as its parentId; cleared the parentId.`,
			remediation:
				"Move a block out of a container's children before giving it a parentId. A block has one nesting route; the children array it is stored in wins.",
		});
	}

	// ── Rule 2: Strip Superfluous Wrappers ──────────────────

	private stripSuperfluousMarks(blockId: string): void {
		const blockMap = this.getBlockMap(blockId);
		if (!blockMap) return;

		const content = getTextProp(blockMap, "content");
		if (typeof content?.toDelta !== "function") return;

		const deltas = content.toDelta();
		if (deltas.length < 2) return;

		let offset = 0;
		for (const delta of deltas) {
			const len =
				typeof delta.insert === "string" ? delta.insert.length : 1;
			if (delta.attributes) {
				for (const [mark, value] of Object.entries(delta.attributes)) {
					const schema = this.registry.resolveInline(mark);
					if (schema?.system) continue;
					if (value === null || value === false) {
						content.format(offset, len, { [mark]: null });
					}
				}
			}
			offset += len;
		}
	}

	// ── Rule 3: No Empty Containers ─────────────────────────

	private ensureContentExists(blockId: string, schema: BlockSchema): void {
		if (schema.content !== "inline") return;

		const blockMap = this.getBlockMap(blockId);
		if (!blockMap) return;

		if (getTextProp(blockMap, "content")) return;
		blockMap.set("content", this.doc.adapter.createText());
	}

	// ── Rule 4: Strip Default Props ─────────────────────────

	private stripDefaultProps(blockId: string, schema: BlockSchema): void {
		const blockMap = this.getBlockMap(blockId);
		if (!blockMap) return;

		const props = getMapProp(blockMap, "props");
		if (!props) return;

		for (const [key, propSchema] of Object.entries(schema.propSchema)) {
			if (typeof props.has === "function") {
				if (!props.has(key)) continue;
			} else if (props.get(key) === undefined) {
				continue;
			}
			const value = props.get(key);
			const defaultValue = (propSchema as Record<string, unknown>)
				.default;
			if (defaultValue !== undefined && deepEqual(value, defaultValue)) {
				props.delete?.(key);
			}
		}
	}

	// ── Rule 5: Block-Type-Specific Normalization ───────────

	private runBlockNormalize(blockId: string, schema: BlockSchema): void {
		if (!schema.normalize) return;

		const blockMap = this.getBlockMap(blockId);
		if (!blockMap) return;

		const type = blockMap.get("type") as string;
		const props = this.readPropsWithDefaults(blockMap, schema);
		const content = getTextProp(blockMap, "content");

		const block: Block = {
			id: blockId,
			type,
			props,
			content:
				content && typeof content.toString === "function"
					? content.toString()
					: "",
		};

		const normalized = schema.normalize(block);
		if (normalized === block) return;

		const propsMap = getMapProp(blockMap, "props");
		if (propsMap && normalized.props !== block.props) {
			for (const [key, value] of Object.entries(normalized.props)) {
				if (!deepEqual(value, block.props[key])) {
					propsMap.set(key, value);
				}
			}
		}
	}

	// ── Rule 6: Layout Normalization ────────────────────────

	private normalizeLayout(blockId: string, schema: BlockSchema): boolean {
		if (!schema.layout) return false;

		const blockMap = this.getBlockMap(blockId);
		if (!blockMap) return false;

		const children = getArrayProp<string>(blockMap, "children");
		if (!children) return false;

		// Empty layout container -> collapse
		if (children.length === 0) {
			this.deleteBlock(blockId);
			this.removeFromBlockOrder(blockId);
			return true;
		}

		// Single-child row/column -> unwrap
		const layoutMap = getMapProp(blockMap, "layout");
		const layoutDir = (layoutMap?.get("direction") as string) ?? "column";
		if (
			children.length === 1 &&
			(layoutDir === "row" || layoutDir === "column")
		) {
			const childId = children.get(0);
			const idx = this.getBlockOrderIndex(blockId);
			this.removeFromBlockOrder(blockId);
			if (idx >= 0) this.insertIntoBlockOrder(childId, idx);
			this.deleteBlock(blockId);
			this.dirtyBlockIds.add(childId);
			return true;
		}

		// Strip layout props that match defaults
		const layoutProps = getMapProp(blockMap, "layout");
		if (layoutProps) {
			for (const [key, value] of [...getMapEntries(layoutProps)]) {
				const defaultValue = getLayoutDefaultValue(schema.layout, key);
				if (
					defaultValue !== undefined &&
					deepEqual(value, defaultValue)
				) {
					layoutProps.delete?.(key);
				}
			}
		}

		return false;
	}

	// ── Rule 9: No Duplicate Block IDs ──────────────────────

	private deduplicateBlockIds(blockId: string): void {
		this.deduplicateBlockOrder(blockId);

		const blockMap = this.getBlockMap(blockId);
		const children = blockMap
			? getArrayProp<string>(blockMap, "children")
			: null;
		if (children) {
			this.deduplicateChildren(blockId, children);
		}
	}

	private deduplicateBlockOrder(blockId: string): void {
		const index = this.getPassIndex();
		if ((index.rootCount.get(blockId) ?? 0) <= 1) return;
		const indices = index.rootIndicesOf(blockId);
		for (let i = indices.length - 2; i >= 0; i--) {
			this.blockOrder.delete(indices[i]!, 1);
			this.noteRootDeleted(indices[i]!, 1);
		}
	}

	// Every id listed more than once in this block's `children` keeps its
	// last entry, as `blockOrder` does. Concurrent moves of one block into
	// the same parent each insert an entry. Reads only this block's array.
	private deduplicateChildren(
		blockId: string,
		children: CRDTUnknownArray<string>,
	): void {
		const indicesById = new Map<string, number[]>();
		for (let i = 0; i < children.length; i++) {
			const id = children.get(i);
			const indices = indicesById.get(id);
			if (indices) {
				indices.push(i);
			} else {
				indicesById.set(id, [i]);
			}
		}
		const doomed: number[] = [];
		for (const indices of indicesById.values()) {
			doomed.push(...indices.slice(0, -1));
		}
		if (doomed.length === 0) return;
		doomed.sort((a, b) => b - a);
		for (const index of doomed) {
			children.delete(index, 1);
		}
		this.noteBlockChanged(blockId, this.doc.blocks.get(blockId));
	}

	// ── Rule 12: No Dangling Structural Entries ─────────────
	// A concurrent move re-inserts the order entry a concurrent delete
	// removed, so an entry can outlive its block map (COL4). The pass index
	// records those entries while it walks the arrays anyway, and this rule
	// runs where the structural rules first read that index, so it adds no
	// walk and no build: a cached index that is clean costs nothing. Every peer
	// removes the same entries from the same state, and concurrent deletes of
	// one Y.Array item are a no-op, so the repair converges and is idempotent.

	private removeDanglingEntries(): void {
		const index = this.getPassIndex();
		if (index.unstoredListed.size === 0) return;
		const dangling = index.danglingEntries((blockId) =>
			this.isDeletedBlock(blockId),
		);
		if (dangling.length === 0) return;

		const removed = new Map<string, Set<string>>();
		for (let i = dangling.length - 1; i >= 0; i--) {
			const entry = dangling[i]!;
			const array = this.structuralArray(entry.parentId);
			if (!array || array.get(entry.index) !== entry.blockId) continue;
			array.delete(entry.index, 1);
			if (entry.parentId === null) this.noteRootDeleted(entry.index, 1);
			else {
				this.noteBlockChanged(
					entry.parentId,
					this.doc.blocks.get(entry.parentId),
				);
			}
			const arrayName =
				entry.parentId === null
					? "blockOrder"
					: `children of "${entry.parentId}"`;
			const arrays = removed.get(entry.blockId) ?? new Set<string>();
			arrays.add(arrayName);
			removed.set(entry.blockId, arrays);
		}

		for (const [blockId, arrays] of removed) {
			this.onDiagnostic?.({
				code: "dangling-block-reference",
				level: "warn",
				source: "schema",
				message: `Removed entries for missing block "${blockId}" from ${[...arrays].sort().join(", ")}.`,
				remediation:
					"A concurrent move re-inserted an entry for a block another peer deleted. Normalization removes the entry so every peer converges without it; renderers skip such an entry until then.",
			});
		}
	}

	private structuralArray(
		parentId: string | null,
	): CRDTUnknownArray<string> | null {
		if (parentId === null) return this.blockOrder;
		const parentMap = this.getBlockMap(parentId);
		return parentMap ? getArrayProp<string>(parentMap, "children") : null;
	}

	// ── Rule 10: Orphan Promotion ───────────────────────────
	// The candidates are the blocks the `parentId` index lists under the
	// deleted id as of the last observed commit, plus every block the open
	// transaction may have written since, so a delete reads its `parentId`
	// children rather than every stored block (SCALE2).

	private handleDeletedBlock(blockId: string): void {
		this.parentIdIndex ??= this.buildParentIdIndex();
		const candidates = new Set(this.parentIdIndex.childrenOf(blockId));
		for (const id of this.unobservedBlockIds) candidates.add(id);
		for (const id of candidates) {
			const rawBlockMap = this.doc.blocks.get(id);
			if (!isCRDTMap(rawBlockMap)) continue;
			const props = getMapProp(rawBlockMap, "props");
			if (!props) continue;
			const parentId = props.get("parentId");
			if (parentId === blockId) {
				props.delete?.("parentId");
				this.dirtyBlockIds.add(id);
				this.unobservedBlockIds.add(id);
			}
		}
	}

	/** The full read the held `parentId` index must equal; the cache property calls it too. */
	private buildParentIdIndex(): ParentIdIndex {
		return ParentIdIndex.build(this.doc);
	}

	// ── COL4: Parent-cycle break ─────────────────────────────
	// When a parent chain reaches itself, clear the edge whose owning
	// block id sorts lowest so every peer computes the same repair.

	private breakParentCycle(blockId: string): void {
		const cycle = this.walkParentCycle(blockId);
		if (!cycle) return;

		// One block can own two edges of a cycle (its `parentId` and an
		// entry in its `children`), so the child id breaks a tie: the choice
		// depends on the cycle alone, never on where the walk entered it.
		let ownerToClear: string | undefined;
		let childToClear: string | undefined;
		for (const childId of cycle) {
			const parentId = this.parentOf(childId);
			if (!parentId) continue;
			const ownerId = this.parentEdgeOwner(childId, parentId);
			if (
				ownerToClear === undefined ||
				ownerId < ownerToClear ||
				(ownerId === ownerToClear && childId < childToClear!)
			) {
				ownerToClear = ownerId;
				childToClear = childId;
			}
		}

		if (childToClear === undefined) return;
		const parentId = this.parentOf(childToClear);
		if (!parentId) return;
		const viaChildren = this.readParentIdProp(childToClear) !== parentId;
		this.clearParentEdge(childToClear, parentId);
		// A cleared `children` edge detaches the child and the subtree under
		// it: re-home it at the end of the root order so it stays a member.
		// Peers that repair concurrently each append one entry; Rule 9 keeps
		// the last of them once the repairs meet.
		if (
			viaChildren &&
			!this.isInBlockOrder(childToClear) &&
			!this.findParentWithChild(childToClear)
		) {
			this.insertIntoBlockOrder(childToClear, this.blockOrder.length);
		}
		this.dirtyBlockIds.add(childToClear);
		this.dirtyBlockIds.add(parentId);
		this.onDiagnostic?.({
			code: "parent-cycle",
			level: "warn",
			source: "schema",
			message: `Parent cycle broken by clearing the edge owned by "${ownerToClear}".`,
			remediation:
				"Concurrent structural edits produced a parent cycle. The lexicographically lowest owning block id loses that parent edge so every peer repairs the same way.",
		});
	}

	private walkParentCycle(startId: string): string[] | null {
		const seen: string[] = [];
		const seenSet = new Set<string>();
		let current: string | null = startId;

		while (current) {
			if (seenSet.has(current)) {
				return seen.slice(seen.indexOf(current));
			}
			if (!this.getBlockMap(current)) {
				return null;
			}
			seen.push(current);
			seenSet.add(current);
			current = this.parentOf(current);
		}

		return null;
	}

	private parentOf(blockId: string): string | null {
		const fromProp = this.readParentIdProp(blockId);
		if (fromProp) return fromProp;
		return this.findParentWithChild(blockId);
	}

	private readParentIdProp(blockId: string): string | null {
		const blockMap = this.getBlockMap(blockId);
		if (!blockMap) return null;
		const props = getMapProp(blockMap, "props");
		const parentId = props?.get("parentId");
		return typeof parentId === "string" && parentId.length > 0
			? parentId
			: null;
	}

	private parentEdgeOwner(childId: string, parentId: string): string {
		return this.readParentIdProp(childId) === parentId ? childId : parentId;
	}

	private clearParentEdge(childId: string, parentId: string): void {
		if (this.readParentIdProp(childId) === parentId) {
			const blockMap = this.getBlockMap(childId);
			const props = blockMap ? getMapProp(blockMap, "props") : null;
			props?.delete?.("parentId");
			return;
		}

		const parentMap = this.getBlockMap(parentId);
		const children = parentMap
			? getArrayProp<string>(parentMap, "children")
			: null;
		if (!children) return;
		for (let i = children.length - 1; i >= 0; i--) {
			if (children.get(i) === childId) {
				children.delete(i, 1);
			}
		}
		this.noteBlockChanged(parentId, parentMap);
	}

	// ── Rule 11: No Cross-Array Membership ──────────────────

	private enforceCrossArrayMembership(blockId: string): void {
		this.keepOneChildrenParent(blockId);
		const inBlockOrder = this.isInBlockOrder(blockId);
		const parentEntry = this.findParentWithChild(blockId);

		if (inBlockOrder && parentEntry) {
			this.removeFromBlockOrder(blockId);
		}
	}

	// Concurrent moves of one block under different parents leave it in every
	// parent's `children`. The parent whose id sorts lowest keeps it, so every
	// peer computes the same repair from the same state (COL4).
	private keepOneChildrenParent(blockId: string): void {
		const parents = this.getPassIndex().parentsByChild.get(blockId);
		if (!parents || parents.length < 2) return;
		// Sorted by the index, so the first is the lowest id.
		const keep = parents[0]!;
		for (const parentId of [...parents]) {
			if (parentId === keep) continue;
			const parentMap = this.getBlockMap(parentId);
			const children = parentMap
				? getArrayProp<string>(parentMap, "children")
				: null;
			if (!children) continue;
			for (let i = children.length - 1; i >= 0; i--) {
				if (children.get(i) === blockId) {
					children.delete(i, 1);
				}
			}
			this.noteBlockChanged(parentId, parentMap);
			this.dirtyBlockIds.add(parentId);
		}
	}

	private isInBlockOrder(blockId: string): boolean {
		return this.getPassIndex().isInRootOrder(blockId);
	}

	/** The lowest-id parent whose `children` lists the block. */
	private findParentWithChild(blockId: string): string | null {
		return this.getPassIndex().parentsByChild.get(blockId)?.[0] ?? null;
	}

	// ── Block Order Helpers ─────────────────────────────────

	private removeFromBlockOrder(blockId: string): void {
		const index = this.getPassIndex().rootLastIndexOf(blockId);
		if (index < 0) return;
		this.blockOrder.delete(index, 1);
		this.noteRootDeleted(index, 1);
	}

	private insertIntoBlockOrder(blockId: string, index: number): void {
		this.blockOrder.insert(index, [blockId]);
		this.noteRootInserted(index, [blockId]);
	}

	private getBlockOrderIndex(blockId: string): number {
		return this.getPassIndex().rootIndexOf(blockId);
	}

	// ── Read Helpers ────────────────────────────────────────

	private readPropsWithDefaults(
		blockMap: CRDTUnknownMap,
		schema: BlockSchema,
	): Record<string, unknown> {
		const props: Record<string, unknown> = {};

		if (schema.propSchema) {
			for (const [key, propDef] of Object.entries(schema.propSchema)) {
				props[key] = (propDef as Record<string, unknown>).default;
			}
		}

		for (const [key, value] of getMapEntries(
			getMapProp(blockMap, "props"),
		)) {
			props[key] = value;
		}

		return props;
	}

	private get blockOrder(): CRDTUnknownArray<string> {
		return this.doc.blockOrder as unknown as CRDTUnknownArray<string>;
	}

	private get blocksMap(): CRDTUnknownMap {
		return this.doc.blocks as unknown as CRDTUnknownMap;
	}

	private getBlockMap(blockId: string): CRDTUnknownMap | null {
		const blockMap = this.doc.blocks.get(blockId);
		return isCRDTMap(blockMap) ? blockMap : null;
	}

	private deleteBlock(blockId: string): void {
		this.blocksMap.delete?.(blockId);
		this.noteBlockChanged(blockId, undefined);
	}

	private getPassIndex(): NormalizePassIndex {
		if (!this.passIndex) {
			this.passIndex = this.buildPassIndex();
		}
		return this.passIndex;
	}

	private invalidatePassIndex(): void {
		this.passIndex = null;
	}

	/** The full read the held index must equal; the cache property calls it too. */
	private buildPassIndex(): NormalizePassIndex {
		return NormalizePassIndex.build(this.doc);
	}

	/**
	 * An absent block is dangling only once its block map was deleted: an
	 * order entry from one client can arrive before the block map another
	 * client wrote, and removing that entry would orphan the block when its
	 * map lands (COL4). Asked only for absent ids, so a clean pass asks nothing.
	 */
	private isDeletedBlock(blockId: string): boolean {
		return this.doc.adapter.isBlockDeleted?.(this.crdtDoc, blockId) ?? true;
	}
}
