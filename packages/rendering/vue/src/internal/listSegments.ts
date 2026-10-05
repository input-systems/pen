import type { BlockListSegment } from "@input/pen-dom/field-editor/store";
import {
  LIST_GROUP_ATTRIBUTES,
  listGroupKey,
} from "@input/pen-dom/utils/dataAttributes";
import { h, type VNode } from "vue";

/**
 * One sibling list's vnodes (AX1, D7): each run of list items inside a
 * `div[data-pen-list-group][role="list"]` keyed by its segment, every other
 * block as `renderBlock` returns it.
 */
export function renderListSegments(
  segments: readonly BlockListSegment[],
  renderBlock: (blockId: string) => VNode,
): VNode[] {
  return segments.map((segment) =>
    segment.kind === "block"
      ? renderBlock(segment.blockId)
      : h(
          "div",
          { key: listGroupKey(segment.key), ...LIST_GROUP_ATTRIBUTES },
          segment.blockIds.map(renderBlock),
        ),
  );
}
