import type { OpOrigin } from "@input/pen-types";
import { useMemo } from "react";

import { useBlockSlice } from "./useBlockNotifier";

interface BlockCommitState {
	revision: number;
	origin: OpOrigin | null;
	commitId: number;
}

/** Revision and last commit that named the block, from the `commit` slice (SCALE6). */
export function useBlockCommitState(blockId: string): BlockCommitState {
	const commit = useBlockSlice(blockId, "commit");
	return useMemo(
		() => ({ revision: commit.revision, origin: commit.lastOrigin, commitId: commit.lastCommitId }),
		[commit],
	);
}
