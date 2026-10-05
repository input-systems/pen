import { isCollapsed } from "@input/pen-core";
import type { SelectionState } from "@input/pen-types";

import type { BlockSelectionSlice } from "../field-editor/blockNotifierTypes";

export function isInlineAtomSelected(
	selection: SelectionState,
	blockId: string,
	offset: number,
): boolean {
	if (!isRangeWithinBlock(selection, blockId)) {
		return false;
	}
	const { anchor, focus } = selection;
	return coversAtom(Math.min(anchor.offset, focus.offset), Math.max(anchor.offset, focus.offset), offset);
}

/**
 * `isInlineAtomSelected` over a block notifier selection slice (SCALE6): the
 * atom is selected when a non-collapsed text range inside this one block
 * covers it.
 */
export function isInlineAtomSelectedInSlice(
	slice: Pick<BlockSelectionSlice, "isAnchor" | "isFocus" | "textRange">,
	offset: number,
): boolean {
	const range = slice.isAnchor && slice.isFocus ? slice.textRange : null;
	return range !== null && range.to !== "end" && coversAtom(range.from, range.to, offset);
}

/** A non-collapsed text selection with both ends in `blockId`. */
function isRangeWithinBlock(
	selection: SelectionState,
	blockId: string,
): selection is Extract<NonNullable<SelectionState>, { type: "text" }> {
	return (
		selection?.type === "text" &&
		!isCollapsed(selection) &&
		selection.anchor.blockId === blockId &&
		selection.focus.blockId === blockId
	);
}

function coversAtom(from: number, to: number, offset: number): boolean {
	return from <= offset && to >= offset + 1;
}
