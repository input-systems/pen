import type { ChangeSummary, StructuralChange } from "./types";

export function affectedBlockIdsFromSummary(
	summary: Pick<ChangeSummary, "blockText" | "structural">,
	documentOrder?: readonly string[],
): string[] {
	const ids = new Set<string>();
	for (const text of summary.blockText) {
		ids.add(text.blockId);
	}
	for (const change of summary.structural) {
		addStructuralBlockIds(ids, change);
	}
	const collected = [...ids];
	// Ranking exists to order several ids against each other; building a rank
	// over the whole document to sort one id is O(document) per commit
	// (SCALE2), and the common commit touches exactly one block.
	if (collected.length < 2 || !documentOrder || documentOrder.length === 0) {
		return collected;
	}
	const rank = new Map<string, number>();
	for (let index = 0; index < documentOrder.length; index += 1) {
		rank.set(documentOrder[index]!, index);
	}
	return collected.sort((left, right) => {
		const leftRank = rank.get(left) ?? Number.MAX_SAFE_INTEGER;
		const rightRank = rank.get(right) ?? Number.MAX_SAFE_INTEGER;
		return leftRank - rightRank;
	});
}

function addStructuralBlockIds(
	ids: Set<string>,
	change: StructuralChange,
): void {
	switch (change.type) {
		case "block-inserted":
		case "block-removed":
		case "block-moved":
		case "block-props-changed":
		case "table-changed":
			ids.add(change.blockId);
			return;
		case "block-split":
			ids.add(change.blockId);
			ids.add(change.newBlockId);
			return;
		case "blocks-merged":
			ids.add(change.targetBlockId);
			ids.add(change.sourceBlockId);
			return;
		case "apps-changed":
		case "metadata-changed":
			return;
		default: {
			const _exhaustive: never = change;
			return _exhaustive;
		}
	}
}

/** Blocks a commit removed: deleted blocks and the source of a merge. */
export function summaryRemovedBlockIds(
	summary: Pick<ChangeSummary, "structural">,
): string[] {
	const removed: string[] = [];
	for (const change of summary.structural) {
		if (change.type === "block-removed") removed.push(change.blockId);
		else if (change.type === "blocks-merged") removed.push(change.sourceBlockId);
	}
	return removed;
}

/**
 * Every block a commit may have changed: its affected ids plus the blocks it
 * removed, so a per-block index can drop them (SCALE2). O(|summary|).
 */
export function summaryTouchedBlockIds(
	summary: Pick<ChangeSummary, "affectedBlockIds" | "structural">,
): string[] {
	return [...summary.affectedBlockIds, ...summaryRemovedBlockIds(summary)];
}
