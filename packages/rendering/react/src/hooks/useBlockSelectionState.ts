import { useBlockSlice } from "./useBlockNotifier";

/** Whether the block is in the selection, from its `selection` slice (SCALE6). */
export function useBlockSelectionState(blockId: string): boolean {
	return useBlockSlice(blockId, "selection").inSelection;
}
