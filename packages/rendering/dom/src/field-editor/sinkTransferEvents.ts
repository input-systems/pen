import type { Editor } from "@input/pen-types";
import {
	getPasteImporters,
	handleClipboardPaste,
	handleCopy,
	handleCut,
} from "./clipboard";
import type { FieldEditorTransferController } from "./controller";

/**
 * FE2 on the focus sink: a block selection and a D5 text range keep focus on
 * the sink, which is not editable, so the browser fires `copy`, `cut` and
 * `paste` there with no native range to act on. The sink binds the same
 * transfer handlers as a field (`bindBackendTransferEvents`). A grid cell
 * selection is left to the table's own clipboard keys.
 */
export function bindFocusSinkTransferEvents(
	element: HTMLElement,
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
): () => void {
	const transfers = (): boolean => {
		const selection = editor.selection;
		return selection?.type === "text" || selection?.type === "block";
	};
	const onCopy = (event: ClipboardEvent): void => {
		if (!transfers()) return;
		event.preventDefault();
		handleCopy(editor, event);
	};
	const onCut = (event: ClipboardEvent): void => {
		if (!transfers()) return;
		event.preventDefault();
		handleCut(editor, event);
	};
	const onPaste = (event: ClipboardEvent): void => {
		if (!transfers()) return;
		event.preventDefault();
		handleClipboardPaste(
			event,
			editor,
			fieldEditor,
			getPasteImporters(editor),
		);
	};
	element.addEventListener("copy", onCopy);
	element.addEventListener("cut", onCut);
	element.addEventListener("paste", onPaste);
	return () => {
		element.removeEventListener("copy", onCopy);
		element.removeEventListener("cut", onCut);
		element.removeEventListener("paste", onPaste);
	};
}
