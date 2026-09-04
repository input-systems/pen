import type {
	Affinity,
	Editor,
	Point,
	SelectionState,
	TextSelection,
} from "@input/pen-types";

import { documentPreorderBlockIds } from "../editor/documentPreorder";
import { createTextSelection } from "../selection/helpers";

/** Command write payload. `blockOrder` is accepted for callers that still pass it. */
export function textSelectionResult(
	anchor: Point,
	focus: Point = anchor,
	extras?: {
		affinity?: Affinity;
		goalX?: number | null;
		blockOrder?: readonly string[];
	},
): TextSelection {
	return createTextSelection({
		anchor,
		focus,
		affinity: extras?.affinity,
		goalX: extras?.goalX,
	});
}

export function blockSelectionResult(
	blockIds: readonly string[],
	head: string = blockIds[blockIds.length - 1] ?? blockIds[0] ?? "",
): SelectionState {
	return {
		type: "block",
		blockIds: [...blockIds],
		head,
	};
}

export function collapsedAt(blockId: string, offset: number): SelectionState {
	return textSelectionResult({ blockId, offset });
}

export function readTextFocus(editor: Editor): Point | null {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		return null;
	}
	return selection.focus;
}

export function readTextAffinity(editor: Editor): Affinity {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		return "downstream";
	}
	return selection.affinity ?? "downstream";
}

export function readTextAnchor(editor: Editor): Point | null {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		return null;
	}
	return selection.anchor;
}

export function documentOrderedTextPoints(
	editor: Editor,
	selection: TextSelection,
): { start: Point; end: Point } | null {
	const order = documentPreorderBlockIds(editor);
	const anchorIndex = order.indexOf(selection.anchor.blockId);
	const focusIndex = order.indexOf(selection.focus.blockId);
	if (anchorIndex < 0 || focusIndex < 0) {
		return null;
	}
	if (
		anchorIndex < focusIndex ||
		(anchorIndex === focusIndex &&
			selection.anchor.offset <= selection.focus.offset)
	) {
		return { start: selection.anchor, end: selection.focus };
	}
	return { start: selection.focus, end: selection.anchor };
}
