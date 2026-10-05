import { useBlockSlice } from "./useBlockNotifier";

/** A container's child ids, identity-stable while unchanged (SCALE6). */
export function useChildBlockIds(parentBlockId: string): readonly string[] {
	return useBlockSlice(parentBlockId, "childIds");
}
