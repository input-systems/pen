import type { Decoration } from "@input/pen-types";

import { useBlockSlice } from "./useBlockNotifier";

/** The block's decorations, identity-stable while unchanged (SCALE2, SCALE6). */
export function useBlockDecorations(blockId: string): readonly Decoration[] {
	return useBlockSlice(blockId, "decorations");
}
