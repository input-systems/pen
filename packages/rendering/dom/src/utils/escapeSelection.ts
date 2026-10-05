import { isCollapsed } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import type { FieldEditorEscapeController } from "../field-editor/controller";

/**
 * Escape walks the selection outward (W3.R16): an editing cell or a text
 * caret becomes a cell or block selection, a block selection becomes `null`.
 * It writes the authority with origin `keyboard`, and the projection of that
 * record places focus: the sink for block and cell, the root for `null`.
 */
export function handleEscapeSelectionTransition(options: {
	event: KeyboardEvent;
	editor: Editor;
	fieldEditor: FieldEditorEscapeController;
}): boolean {
	const { event, editor, fieldEditor } = options;

	if (
		event.defaultPrevented ||
		event.key !== "Escape" ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.isComposing ||
		fieldEditor.isComposing
	) {
		return false;
	}

	const selection = editor.selection;

	if (fieldEditor.activeCellCoord && fieldEditor.isEditing) {
		const coord = fieldEditor.activeCellCoord;
		fieldEditor.deactivate();
		editor.selectCell(coord.blockId, coord.row, coord.col, {
			origin: "keyboard",
		});
		return true;
	}

	if (selection?.type === "text" && !isCollapsed(selection)) {
		fieldEditor.collapseSelectionToFocus();
		return true;
	}

	if (selection?.type === "text") {
		const blockId = selection.focus.blockId;
		fieldEditor.deactivate();
		editor.selectBlock(blockId, { origin: "keyboard" });
		return true;
	}

	if (selection?.type === "cell") {
		const { blockId, anchor, head } = selection;
		const isMultiCell = anchor.row !== head.row || anchor.col !== head.col;

		if (isMultiCell) {
			editor.selectCell(blockId, anchor.row, anchor.col, {
				origin: "keyboard",
			});
			return true;
		}

		editor.selectBlock(blockId, { origin: "keyboard" });
		return true;
	}

	if (selection?.type === "block" && selection.blockIds.length > 0) {
		editor.setSelection(null, { origin: "keyboard" });
		return true;
	}

	return false;
}
