import type { BlockHandle } from "@input/pen-types";

import { useBlockSlice } from "./useBlockNotifier";

/**
 * The item's number, from the notifier's `list` slice: recomputed once per
 * touched run, so an item re-renders only when its own ordinal moves (SCALE6).
 */
export function useNumberedListItemValue(block: BlockHandle): number {
	return useBlockSlice(block.id, "list")?.ordinal ?? 1;
}
