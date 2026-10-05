import type { Editor } from "@input/pen-types";
import { useMemo } from "react";

import { useBlockSlice } from "./useBlockNotifier";

interface BlockModelSnapshot {
	exists: boolean;
	id: string;
	type: string | null;
	props: Readonly<Record<string, unknown>> | null;
	revision: number;
	tableRowCount: number;
	tableColumnCount: number;
}

/** The block's model, from the notifier's `commit` slice (SCALE6). */
export function useBlockModel(editor: Editor, blockId: string): BlockModelSnapshot {
	const commit = useBlockSlice(blockId, "commit");
	// Identity follows the slice, so memoized consumers bail out when it is unchanged.
	return useMemo(() => {
		const table = commit.exists ? editor.getBlock(blockId)?.as("table") : null;
		return {
			exists: commit.exists,
			id: blockId,
			type: commit.type,
			props: commit.props,
			revision: commit.revision,
			tableRowCount: table?.tableRowCount() ?? 0,
			tableColumnCount: table?.tableColumnCount() ?? 0,
		};
	}, [editor, blockId, commit]);
}
