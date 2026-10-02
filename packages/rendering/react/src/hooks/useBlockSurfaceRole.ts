import { useBlockSlice } from "./useBlockNotifier";

/** The block's expanded-surface role, from its `field` slice (SCALE6). */
export function useBlockSurfaceRole(
	blockId: string,
): "editable-inline" | "structural" | "delegated" | null {
	return useBlockSlice(blockId, "field").expandedRole;
}
