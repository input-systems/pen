import type { BlockIndexSnapshot } from "./blockIndex";

/**
 * Each id's position in its sibling list at every level from the root order
 * down, or `null` for an id no array under the root order reaches (unlisted,
 * under an orphan, or on a parent cycle).
 */
function documentPath(
	index: BlockIndexSnapshot,
	blockId: string,
): number[] | null {
	const path: number[] = [];
	const seen = new Set<string>();
	let current = blockId;
	for (;;) {
		if (seen.has(current)) return null;
		seen.add(current);
		const parentId = index.parentById.get(current);
		if (parentId === undefined) return null;
		const siblings =
			parentId === null ? index.roots : index.childrenByParentId.get(parentId);
		const at = siblings?.indexOf(current) ?? -1;
		if (at < 0) return null;
		path.push(at);
		if (parentId === null) return path.reverse();
		current = parentId;
	}
}

function comparePaths(left: number[] | null, right: number[] | null): number {
	if (left === null || right === null) {
		if (left === right) return 0;
		return left === null ? 1 : -1;
	}
	const length = Math.min(left.length, right.length);
	for (let level = 0; level < length; level += 1) {
		const difference = left[level]! - right[level]!;
		if (difference !== 0) return difference;
	}
	// An ancestor precedes its descendants.
	return left.length - right.length;
}

/**
 * Sorts ids into document (preorder) order by their ancestor paths, so the
 * cost is the ids' depth times their sibling lists, never the document
 * (SCALE2). Ids the root order does not reach keep their relative order
 * after the rest.
 */
export function sortIntoDocumentOrder(
	index: BlockIndexSnapshot,
	blockIds: readonly string[],
): string[] {
	const paths = new Map<string, number[] | null>();
	for (const blockId of blockIds) paths.set(blockId, documentPath(index, blockId));
	return [...blockIds].sort((left, right) =>
		comparePaths(paths.get(left)!, paths.get(right)!),
	);
}
