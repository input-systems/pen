import type { BlockHandle, Editor } from "@input/pen-types";

const NUMBERED = "numberedListItem";

function indentOf(block: BlockHandle): number {
	const indent = block.props?.indent;
	return typeof indent === "number" && indent >= 0 ? indent : 0;
}

function startOf(block: BlockHandle): number | undefined {
	const start = block.props?.start;
	return typeof start === "number" && start > 0 ? start : undefined;
}

/** A numbered item's value when nothing precedes it: its `start`, or 1. */
export function standaloneOrdinal(block: BlockHandle | null): number | null {
	if (block?.type !== NUMBERED) return null;
	return startOf(block) ?? 1;
}

/**
 * Ordinals for every `numberedListItem` among `siblingIds`, a stretch of one
 * sibling list (`getRootBlockIds` or `documentState.childrenOf`, as AX1 list
 * segments use) that starts at a run boundary. An item counts the numbered
 * items before it at its indent, back to a shallower item or its run's
 * start, from the nearest `start`; any other block ends a run. Values follow
 * `getNumberedListItemValue`. O(n).
 */
export function numberedOrdinals(editor: Editor, siblingIds: readonly string[]): Map<string, number> {
	const ordinals = new Map<string, number>();
	const lastByIndent = new Map<number, number>();
	for (const id of siblingIds) {
		const block = editor.getBlock(id);
		if (block?.type !== NUMBERED) {
			lastByIndent.clear();
			continue;
		}
		const indent = indentOf(block);
		for (const level of [...lastByIndent.keys()]) {
			if (level > indent) lastByIndent.delete(level);
		}
		const value = startOf(block) ?? (lastByIndent.get(indent) ?? 0) + 1;
		lastByIndent.set(indent, value);
		ordinals.set(id, value);
	}
	return ordinals;
}
