import type { ListItemSemantics, ListSegment } from "@input/pen-core";

import type { BlockNotifier } from "../field-editor/blockNotifierTypes";

/**
 * AX1 list semantics for one editor: a read adapter over the block notifier's
 * list slice and list-segment channel, which compute them with core's
 * `getListItemSemantics` / `getListSegments`. It holds no subscription of its
 * own; a surface subscribes through `subscribeBlock` / `subscribeListSegments`.
 */
export interface ListSemanticsStore {
	getItem(blockId: string): ListItemSemantics | null;
	getSegments(parentId: string | null): readonly ListSegment[];
	dispose(): void;
}

export function createListSemanticsStore(notifier: BlockNotifier): ListSemanticsStore {
	return {
		getItem: (blockId) => notifier.getBlockSnapshot(blockId).list,
		getSegments: (parentId) => notifier.getListSegments(parentId),
		dispose: () => {},
	};
}
