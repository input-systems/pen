import {
	getSelectionBlockRange,
	isCollapsed,
	isMultiBlock,
} from "@input/pen-core";
import type { SelectionState, TextSelection } from "@input/pen-types";
import type { GeometryReaderHost } from "../geometry/geometryReader";
import { measureWithRoot } from "../geometry/rootGeometry";
import { rectToDOMRect, unionRects, type Rect } from "../geometry/types";

/**
 * Bounding rect of the selected text, for placing a floating surface.
 *
 * A selection that spans blocks is measured block by block. The range rects
 * of the whole span include the border box of every block it fully covers,
 * which is the column width rather than where the text is, and a surface
 * centred on that floats away from the selection.
 */
export function resolveSelectionRect(
	root: HTMLElement,
	selection: SelectionState | null,
): DOMRect | null {
	if (!selection || selection.type !== "text" || isCollapsed(selection)) {
		return null;
	}

	return measureWithRoot(root, ({ reader }) => {
		const rangeRects = isMultiBlock(selection)
			? rangeRectsByBlock(reader, selection)
			: reader.rangeRects({
					anchor: selection.anchor,
					focus: selection.focus,
				});
		if (rangeRects.length > 0) {
			const merged = unionRects(rangeRects);
			if (merged.width === 0 && merged.height === 0) {
				return null;
			}
			return rectToDOMRect(merged);
		}

		const anchorRect = reader.caretRect(selection.anchor, "downstream");
		const focusRect = reader.caretRect(selection.focus, "downstream");
		if (!anchorRect || !focusRect) {
			return null;
		}
		return rectToDOMRect(unionRects([anchorRect, focusRect]));
	});
}

function rangeRectsByBlock(
	reader: GeometryReaderHost,
	selection: TextSelection,
): readonly Rect[] {
	const blockRange = getSelectionBlockRange(reader.blockIds(), selection);
	const first = blockRange[0];
	const last = blockRange[blockRange.length - 1];
	if (!first || !last || first === last) {
		return reader.rangeRects({
			anchor: selection.anchor,
			focus: selection.focus,
		});
	}

	const start =
		selection.anchor.blockId === first ? selection.anchor : selection.focus;
	const end =
		selection.focus.blockId === last ? selection.focus : selection.anchor;
	const rects: Rect[] = [];
	for (const blockId of blockRange) {
		const from = blockId === first ? start.offset : 0;
		const to =
			blockId === last ? end.offset : blockEndOffset(reader, blockId);
		if (to <= from) {
			continue;
		}
		rects.push(
			...reader.rangeRects({
				anchor: { blockId, offset: from },
				focus: { blockId, offset: to },
			}),
		);
	}
	return rects;
}

function blockEndOffset(reader: GeometryReaderHost, blockId: string): number {
	let end = 0;
	for (const line of reader.lineBoxes(blockId)) {
		end = Math.max(end, line.endOffset);
	}
	return end;
}
