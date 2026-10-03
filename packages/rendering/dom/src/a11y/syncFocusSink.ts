import { resolveEditorMessage } from "@input/pen-core";
import type { Editor, SelectionState } from "@input/pen-types";

import { isForeignNativeTextEntryTarget } from "../utils/textEntryTarget";
import type { FocusSink } from "./focusSink";

/** How a focus projection reaches the DOM: through the field editor's focus controller. */
export interface FocusSinkProjection {
	/** Focuses `target`; the focus controller is the only DOM focus writer. */
	readonly requestFocus: (target: HTMLElement) => void;
}

/**
 * Reveals or hides the sink for the record and projects focus for
 * non-text records (P, AX1): block and grid cell selections focus the
 * revealed sink; app and `null` focus the editor root, never the sink
 * (D18). Text selections and an edited cell's `text` are the field's to
 * focus.
 */
export function syncFocusSink(
	sink: FocusSink,
	editor: Editor,
	selection: SelectionState,
	projection: FocusSinkProjection,
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
		claimFocus(sink.element, sink.element.parentElement, projection, true);
		return;
	}
	if (selection?.type === "cell" && !selection.text) {
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
		claimFocus(sink.element, sink.element.parentElement, projection, true);
		return;
	}
	sink.hide();
	const root = sink.element.parentElement;
	if (selection === null || selection.type === "app") {
		// Never from the document: a null selection on mount or load must
		// not pull focus into an editor the user never focused.
		claimFocus(root, root, projection, false);
	}
}

/**
 * Move DOM focus to `target` so a host can attribute a keystroke to this
 * editor by containment (HOST9), but only when the editor owns focus or,
 * with `fromDocument`, focus fell to the document. Synchronous: S4 forbids a deferred restore. Never steals from a
 * foreign native text-entry control.
 */
function claimFocus(
	target: HTMLElement | null,
	root: HTMLElement | null,
	projection: FocusSinkProjection,
	fromDocument: boolean,
): void {
	if (!target?.isConnected || !root) {
		return;
	}
	const doc = target.ownerDocument;
	const active = doc.activeElement;
	if (active === target) {
		return;
	}
	if (isForeignNativeTextEntryTarget(active)) {
		return;
	}
	const editorOwnsFocus = active instanceof Node && root.contains(active);
	const lostToDocument =
		fromDocument &&
		(active === null ||
			active === doc.body ||
			active === doc.documentElement);
	if (!editorOwnsFocus && !lostToDocument) {
		return;
	}
	projection.requestFocus(target);
}
