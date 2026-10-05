import { useBlockSlice } from "./useBlockNotifier";

/**
 * The item's number, from the notifier's `list` slice: recomputed once per
 * touched run, so an item re-renders only when its own ordinal moves (SCALE6).
 */
export function useNumberedListItemValue(blockId: string): number {
	return useBlockSlice(blockId, "list")?.ordinal ?? 1;
}
