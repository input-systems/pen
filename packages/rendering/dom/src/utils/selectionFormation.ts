import { buildTransitionSnapshot, convertPointerDrag } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import type { SelectionPoint } from "../field-editor/selectionBridge";

type DomSelectionPoints = {
	anchor: SelectionPoint;
	focus: SelectionPoint;
};

type NormalizedSelectionIntent =
	| {
			type: "text";
			anchor: SelectionPoint;
			focus: SelectionPoint;
	  }
	| {
			type: "block";
			blockIds: string[];
	  };

export function normalizeSelectionFormation(
	editor: Editor,
	selection: DomSelectionPoints,
): NormalizedSelectionIntent {
	// T2 / N2 / §4.2: reads are never escalated by block type. A mixed
	// text/structural range stays a text selection, and core's T2 covers
	// the structural end (0..1) so delete keeps the paragraph prefix and
	// removes the divider. The write escalation (a full 0..1 cover of a
	// single non-text block) lives in `_validateText`.
	// Within one block T2 only clamps, and a mapped DOM point is in range, so
	// a caret read pays for no snapshot (SCALE2).
	if (selection.anchor.blockId === selection.focus.blockId) {
		return { type: "text", anchor: selection.anchor, focus: selection.focus };
	}
	const snapshot = buildTransitionSnapshot(editor, {
		blockIds: [selection.anchor.blockId, selection.focus.blockId],
	});
	const formed = convertPointerDrag(
		snapshot,
		{
			type: "text",
			anchor: selection.anchor,
			focus: selection.anchor,
			affinity: "downstream",
			goalX: null,
		},
		selection.focus,
	);
	if (formed?.type !== "text") {
		return { type: "text", anchor: selection.anchor, focus: selection.focus };
	}
	return { type: "text", anchor: formed.anchor, focus: formed.focus };
}
