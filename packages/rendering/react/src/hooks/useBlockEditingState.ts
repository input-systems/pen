import { useBlockSlice } from "./useBlockNotifier";

/** Whether the field editor's focus is this block, from its `field` slice (SCALE6). */
export function useBlockEditingState(blockId: string): boolean {
	return useBlockSlice(blockId, "field").isFieldFocus;
}
