import type { PenDocument } from "@input/pen-types";
import type { RawCommitDelta } from "@input/pen-yjs";
import type { StoredBlockReader } from "../changes/blockIndex";
import { getMapProp, isCRDTMap } from "../editor/crdtShapes";

const EMPTY_IDS: ReadonlySet<string> = new Set();

function readParentId(rawBlockMap: unknown): string | null {
	if (!isCRDTMap(rawBlockMap)) return null;
	const parentId = getMapProp(rawBlockMap, "props")?.get("parentId");
	return typeof parentId === "string" ? parentId : null;
}

/** Block-map keys after which a block's `parentId` prop must be re-read. */
function rereadsParentId(keys: ReadonlySet<string>): boolean {
	return keys.size === 0 || keys.has("props") || keys.has("parentId");
}

/**
 * Which stored blocks name each id in their `parentId` prop, as of the last
 * observed transaction: the candidates normalization Rule 10 clears when that
 * id is deleted, so a delete reads its `parentId` children rather than every
 * stored block (SCALE2). Built from the document once, then advanced by every
 * transaction's delta — local, remote and undo alike — re-reading only the
 * blocks whose map or props the delta names. `build` is the full read the
 * advance must equal.
 */
export class ParentIdIndex {
	private readonly childrenByParentId = new Map<string, Set<string>>();
	private readonly parentIdByChild = new Map<string, string>();

	static build(doc: PenDocument): ParentIdIndex {
		const index = new ParentIdIndex();
		for (const [blockId, rawBlockMap] of doc.blocks.entries()) {
			index.set(blockId, readParentId(rawBlockMap));
		}
		return index;
	}

	/** The stored blocks whose `parentId` named `parentId` at the last observed transaction. */
	childrenOf(parentId: string): ReadonlySet<string> {
		return this.childrenByParentId.get(parentId) ?? EMPTY_IDS;
	}

	applyCommitDelta(delta: RawCommitDelta, readBlock: StoredBlockReader): void {
		for (const [blockId, keys] of delta.blockMapChanges) {
			if (rereadsParentId(keys)) this.set(blockId, readParentId(readBlock(blockId)));
		}
	}

	private set(blockId: string, parentId: string | null): void {
		const previous = this.parentIdByChild.get(blockId);
		if (previous === (parentId ?? undefined)) return;
		if (previous !== undefined) {
			const siblings = this.childrenByParentId.get(previous);
			siblings?.delete(blockId);
			if (siblings?.size === 0) this.childrenByParentId.delete(previous);
			this.parentIdByChild.delete(blockId);
		}
		if (parentId === null) return;
		this.parentIdByChild.set(blockId, parentId);
		let siblings = this.childrenByParentId.get(parentId);
		if (!siblings) {
			siblings = new Set();
			this.childrenByParentId.set(parentId, siblings);
		}
		siblings.add(blockId);
	}
}
