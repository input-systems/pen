import { isCollapsed } from "@input/pen-core";
import type { SelectionState } from "@input/pen-types";

/**
 * The contenteditable backend's PH1 echo restores (W3.R4 removes them one
 * engine-gated change at a time). Each decides whether a mapped read is the
 * engine echoing an earlier write rather than the user.
 */

export type ProjectedDomOffsets = {
	readonly anchorOffset: number;
	readonly focusOffset: number;
};

export type RestoreDecisionSelection =
	| {
			readonly type: "text";
			readonly anchor: {
				readonly blockId: string;
				readonly offset: number;
			};
			readonly focus: {
				readonly blockId: string;
				readonly offset: number;
			};
	  }
	| {
			readonly type: "block";
			readonly blockIds: readonly string[];
	  };

/**
 * Contenteditable restore predicate. A 0..length range on the focused
 * block against a collapsed authority caret is an echo, not a select-all.
 * Moved from the CE backend; the boolean is unchanged.
 */
export function isFullBlockEchoAgainstCollapsedCaret(
	selection: RestoreDecisionSelection,
	currentSelection: SelectionState | null,
	getBlockLength: (blockId: string) => number | null,
): boolean {
	if (selection.type === "block") {
		return false;
	}
	if (selection.anchor.blockId !== selection.focus.blockId) {
		return false;
	}

	if (
		currentSelection?.type !== "text" ||
		!isCollapsed(currentSelection) ||
		currentSelection.focus.blockId !== selection.anchor.blockId
	) {
		return false;
	}

	const blockLength = getBlockLength(selection.anchor.blockId);
	if (blockLength == null) {
		return false;
	}

	const selectionStart = Math.min(
		selection.anchor.offset,
		selection.focus.offset,
	);
	const selectionEnd = Math.max(
		selection.anchor.offset,
		selection.focus.offset,
	);
	return selectionStart === 0 && selectionEnd === blockLength;
}

/**
 * Contenteditable restore predicate. A collapsed DOM caret that does not
 * match the programmatic/user-dom stamp is a stale projection, not a move.
 * Moved from the CE backend; the boolean is unchanged.
 */
export function isCollapsedDomAgainstProjectedOffsets(
	selection: RestoreDecisionSelection,
	getProjectedOffsets: (blockId: string) => ProjectedDomOffsets | null,
): boolean {
	if (
		selection.type === "block" ||
		selection.anchor.blockId !== selection.focus.blockId ||
		selection.anchor.offset !== selection.focus.offset
	) {
		return false;
	}
	const projectedSelection = getProjectedOffsets(selection.anchor.blockId);
	if (!projectedSelection) {
		return false;
	}
	return (
		selection.anchor.offset !== projectedSelection.anchorOffset ||
		selection.focus.offset !== projectedSelection.focusOffset
	);
}
