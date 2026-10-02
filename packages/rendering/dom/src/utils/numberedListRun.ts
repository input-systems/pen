import { getNumberedListItemValue } from "@input/pen-core";
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

/**
 * Ordinals for every item of the numbered run around `blockId`, in O(run)
 * with `documentState.indexOf` / `blockAt` (SCALE2). The run is the maximal
 * stretch of consecutive `numberedListItem` blocks in `blockOrder`; values
 * follow `getNumberedListItemValue`. A block outside `blockOrder` (a
 * children-array child) has no `prev`, so its value is its own.
 */
export function numberedRunOrdinals(editor: Editor, blockId: string): Map<string, number> {
	const ordinals = new Map<string, number>();
	const state = editor.documentState;
	const index = state.indexOf(blockId);
	if (index < 0) {
		const value = getNumberedListItemValue(editor.getBlock(blockId));
		if (value !== null) ordinals.set(blockId, value);
		return ordinals;
	}
	const isNumbered = (at: number) => {
		const id = state.blockAt(at);
		return id !== null && editor.getBlock(id)?.type === NUMBERED;
	};
	let start = index;
	while (start > 0 && isNumbered(start - 1)) start -= 1;
	const lastByIndent = new Map<number, number>();
	for (let at = start; isNumbered(at); at += 1) {
		const id = state.blockAt(at) as string;
		const block = editor.getBlock(id) as BlockHandle;
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
