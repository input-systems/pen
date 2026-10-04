import React from "react";
import type { BlockListSegment } from "@input/pen-dom/field-editor/store";
import {
	LIST_GROUP_ATTRIBUTES,
	listGroupKey,
} from "@input/pen-dom/utils/dataAttributes";
import { EditorBlock } from "./block";

/**
 * One sibling list's elements (AX1, D7): each run of list items inside a
 * `div[data-pen-list-group][role="list"]` keyed by its segment, every other
 * block as is. `renderAfter` interleaves non-block content (autocomplete
 * previews) after a block; inside a run it ends the group, and the rest of
 * the run opens a new wrapper — numbering is the model's either way.
 */
export function renderListSegments(
	segments: readonly BlockListSegment[],
	renderAfter?: (blockId: string) => readonly React.ReactElement[],
): React.ReactElement[] {
	const elements: React.ReactElement[] = [];
	for (const segment of segments) {
		if (segment.kind === "block") {
			elements.push(<EditorBlock key={segment.blockId} blockId={segment.blockId} />);
			elements.push(...(renderAfter?.(segment.blockId) ?? []));
			continue;
		}
		let groupKey = segment.key;
		let items: React.ReactElement[] = [];
		const closeGroup = () => {
			if (items.length === 0) return;
			elements.push(
				<div key={listGroupKey(groupKey)} {...LIST_GROUP_ATTRIBUTES}>
					{items}
				</div>,
			);
			items = [];
		};
		segment.blockIds.forEach((blockId, index) => {
			items.push(<EditorBlock key={blockId} blockId={blockId} />);
			const after = renderAfter?.(blockId) ?? [];
			if (after.length === 0) return;
			closeGroup();
			elements.push(...after);
			groupKey = segment.blockIds[index + 1] ?? groupKey;
		});
		closeGroup();
	}
	return elements;
}
