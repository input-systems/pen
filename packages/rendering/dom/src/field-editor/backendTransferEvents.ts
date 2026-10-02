import type { Editor } from "@input/pen-types";
import type { BackendAttachment } from "./backendAttachment";
import { handleCopy, handleCut } from "./clipboard";
import type { FieldEditorInputController } from "./controller";

/**
 * FE2: clipboard and drag are the same in every backend, so they are bound
 * once here instead of being restated per input technology. Copy and cut go
 * through the transfer path; drag is refused outright.
 *
 * Native text dragging conflicts with selection extension — inside the
 * shared expanded host the browser can move or remove the selected DOM
 * range — and Pen has no drag-move semantics for text, so both ends of a
 * drag are prevented and reported as gestures.
 */
export function bindBackendTransferEvents(
	attachment: BackendAttachment,
	element: HTMLElement,
	editor: Editor,
	fieldEditor: FieldEditorInputController,
): void {
	attachment.listen(element, "copy", (event) => {
		event.preventDefault();
		handleCopy(editor, event);
	});
	attachment.listen(element, "cut", (event) => {
		event.preventDefault();
		handleCut(editor, event);
	});
	attachment.listen(element, "dragstart", (event) => {
		fieldEditor.notifyGestureEvent?.("dragstart");
		event.preventDefault();
		// A cancelled dragstart starts no drag operation, so neither drop nor
		// dragend follows (HTML DnD). Close the window in the same handler (R1).
		fieldEditor.notifyGestureEvent?.("dragend-completed");
	});
	attachment.listenDocument(element.ownerDocument, "dragend", () => {
		// R1/R2: dragend is a close input, not gated on content; it may fire
		// outside the field after an in-field start.
		fieldEditor.notifyGestureEvent?.("dragend-completed");
	});
	attachment.listen(element, "drop", (event) => {
		fieldEditor.notifyGestureEvent?.("drop-completed");
		event.preventDefault();
	});
}
