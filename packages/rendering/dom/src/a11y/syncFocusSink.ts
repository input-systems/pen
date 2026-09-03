import { resolveEditorMessage } from "@input/pen-core";
import type { Editor, SelectionState } from "@input/pen-types";

import { isForeignNativeTextEntryTarget } from "../utils/textEntryTarget";
import type { FocusSink } from "./focusSink";

export function syncFocusSink(
	sink: FocusSink,
	editor: Editor,
	selection: SelectionState = editor.selection,
): void {
	if (selection?.type === "block" && selection.blockIds.length > 0) {
		sink.reveal({
			kind: "block",
			label: resolveEditorMessage(
				editor,
				"pen.a11y.blockSelectionEntered",
				{ count: selection.blockIds.length },
			),
		});
		claimBlockSelectionFocus(sink);
		return;
	}
	if (selection?.type === "cell") {
		const rows = Math.abs(selection.head.row - selection.anchor.row) + 1;
		const columns = Math.abs(selection.head.col - selection.anchor.col) + 1;
		sink.reveal({
			kind: "cell",
			label: resolveEditorMessage(
				editor,
				"pen.a11y.cellSelectionChanged",
				{ rows, columns },
			),
		});
		claimBlockSelectionFocus(sink);
		return;
	}
	sink.hide();
}

/**
 * Park DOM focus on the revealed sink so a host can attribute a
 * keystroke to this editor by containment (HOST9). Synchronous — S4
 * forbids a deferred restore. Do not steal from a foreign control.
 */
function claimBlockSelectionFocus(sink: FocusSink): void {
	const element = sink.element;
	if (!element.isConnected) {
		return;
	}
	const doc = element.ownerDocument;
	const root = element.parentElement;
	if (!doc || !root) {
		return;
	}
	const active = doc.activeElement;
	if (active === element) {
		return;
	}
	if (isForeignNativeTextEntryTarget(active)) {
		return;
	}
	const editorOwnsFocus = active instanceof Node && root.contains(active);
	const lostToDocument =
		active === null ||
		active === doc.body ||
		active === doc.documentElement;
	if (!editorOwnsFocus && !lostToDocument) {
		return;
	}
	element.focus({ preventScroll: true });
}
