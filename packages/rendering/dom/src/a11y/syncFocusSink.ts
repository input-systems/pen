import { getSelectionBlockRange, resolveEditorMessage } from "@input/pen-core";
import type { Editor, SelectionState } from "@input/pen-types";

import type { S2ExceptionKind } from "../field-editor/selectionProjector";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { isForeignNativeTextEntryTarget } from "../utils/textEntryTarget";
import type { FocusSink } from "./focusSink";

/** How a focus projection reaches the DOM: through the field editor's focus controller. */
export interface FocusSinkProjection {
	/** Focuses `target`; the focus controller is the only DOM focus writer. */
	readonly requestFocus: (target: HTMLElement) => void;
	/** D5: the projector's substitute state for a text selection (S2 exception). */
	readonly substitute?: S2ExceptionKind | null;
}

/**
 * Reveals or hides the sink for the record and projects focus for
 * non-text records (P, AX1): block and grid cell selections, and a text
 * selection in a D5 substitute state, focus the revealed sink; app and
 * `null` focus the editor root, never the sink (D18). Other text
 * selections and an edited cell's `text` are the field's to focus.
 */
export function syncFocusSink(
	sink: FocusSink,
	editor: Editor,
	selection: SelectionState,
	projection: FocusSinkProjection,
): void {
	if (selection?.type === "text" && projection.substitute) {
		sink.reveal({
			kind: "text-range",
			label: resolveEditorMessage(editor, "pen.a11y.textRangeSelected", {
				count: getSelectionBlockRange(editor.documentState, selection)
					.length,
			}),
		});
		claimFocus(sink.element, sink.element.parentElement, projection, true);
		return;
	}
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
 * The editor's own field (an inline field or the expanded blocks host),
 * which is ours to move focus from even before its field-surface marker is
 * painted: the D5 fallback leaves the expanded host it just focused.
 */
function isEditorSurface(active: Element | null): boolean {
	return (
		active instanceof HTMLElement &&
		(active.hasAttribute(DATA_ATTRS.editorBlocksHost) ||
			active.hasAttribute(DATA_ATTRS.inlineContent))
	);
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
	if (isForeignNativeTextEntryTarget(active) && !isEditorSurface(active)) {
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
