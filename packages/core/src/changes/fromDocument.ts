import type { PenDocument } from "@input/pen-types";

import {
	createBlockIndexSnapshot,
	emptyBlockIndexSnapshot,
	type BlockIndexSnapshot,
} from "./blockIndex";
import { asMap, readStringArray, storedText } from "./readStored";
import { logicalLengthFromStored } from "./summaryBuilder";

/**
 * Lengths to carry over from the previous index: every block except `named`
 * keeps its cached length instead of having its text read (SCALE2). A
 * structural commit cannot change the text of a block its summary does not name.
 */
export interface ReusedBlockLengths {
	readonly lengths: ReadonlyMap<string, number>;
	readonly named: ReadonlySet<string>;
}

/**
 * The block index read whole from the document: the naive build the
 * incremental advance (`BlockIndex.applyStructure`) must equal, and the
 * fallback it takes for a commit it does not advance in place.
 */
export function createBlockIndexSnapshotFromDocument(
	doc: PenDocument,
	reuse?: ReusedBlockLengths,
): BlockIndexSnapshot {
	if (!doc?.blockOrder || !doc.blocks) {
		return emptyBlockIndexSnapshot();
	}

	const roots = readStringArray(doc.blockOrder);
	const lengthById = new Map<string, number>();
	const typeById = new Map<string, string>();
	const childrenByParentId = new Map<string | null, readonly string[]>();
	childrenByParentId.set(null, roots);

	const visited = new Set<string>();
	const visit = (id: string) => {
		if (visited.has(id)) return;
		visited.add(id);
		const block = asMap(doc.blocks.get(id));
		if (!block) {
			lengthById.set(id, 0);
			return;
		}
		const type = block.get("type");
		typeById.set(id, typeof type === "string" ? type : "");
		const cached =
			reuse && !reuse.named.has(id) ? reuse.lengths.get(id) : undefined;
		lengthById.set(
			id,
			cached ?? logicalLengthFromStored(storedText(block.get("content"))),
		);
		const children = readStringArray(block.get("children"));
		childrenByParentId.set(id, children);
		for (const child of children) visit(child);
	};

	for (const root of roots) visit(root);
	if (typeof doc.blocks.keys === "function") {
		for (const id of doc.blocks.keys()) {
			if (typeof id === "string") visit(id);
		}
	}

	return createBlockIndexSnapshot({
		roots,
		lengthById,
		typeById,
		childrenByParentId,
	});
}
