import { isListItemType } from "@input/pen-core";
import type { BlockListSlice } from "@input/pen-dom/field-editor/store";
import { listItemHostAttributes } from "@input/pen-dom/utils/dataAttributes";
import type { Unsubscribe } from "@input/pen-types";
import { useCallback, useSyncExternalStore } from "react";

import { useBlockNotifier } from "./useBlockNotifier";

const NO_SUBSCRIPTION = (): Unsubscribe => () => {};
const serverSlice = (): BlockListSlice | null => null;

/**
 * AX1: the block host's `role="listitem"`, `aria-level`, `aria-posinset` and
 * `aria-setsize`, from the notifier's `list` slice; null for a block that is
 * not a list item. Only a list item subscribes: another block's slice stays
 * null until its type changes, which re-renders it through its commit slice
 * (SCALE6: a keystroke in a paragraph pays no extra delivery).
 */
export function useListItemSemantics(
	blockId: string,
	blockType: string | null,
): Readonly<Record<string, string>> | null {
	const notifier = useBlockNotifier();
	const isListItem = isListItemType(blockType);
	const subscribe = useCallback(
		(onChange: () => void) =>
			notifier && isListItem ? notifier.subscribeBlock(blockId, onChange) : NO_SUBSCRIPTION(),
		[notifier, blockId, isListItem],
	);
	const getSnapshot = useCallback(
		() => (notifier && isListItem ? notifier.getBlockSnapshot(blockId).list : null),
		[notifier, blockId, isListItem],
	);
	return listItemHostAttributes(useSyncExternalStore(subscribe, getSnapshot, serverSlice));
}
