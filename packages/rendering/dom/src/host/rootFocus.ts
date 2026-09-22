import type { Editor } from "@input/pen-types";
import type { FieldEditorSession } from "../field-editor/controller";
import { queryBlockElement } from "../field-editor/selectionDomQueries";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { collectHostTextBlocks } from "./pointerActivation";

export interface FieldEditorRootFocusOptions {
	event: FocusEvent;
	editor: Editor;
	fieldEditor: Pick<FieldEditorSession, "focusTextSelection">;
	root: HTMLElement;
	readonly?: boolean;
}

export function handleFieldEditorRootFocus(
	options: FieldEditorRootFocusOptions,
): void {
	const { event, editor, fieldEditor, root, readonly } = options;
	if (event.target !== root || readonly === true) {
		return;
	}

	const selection = editor.selection;
	if (selection) {
		if (
			selection.type === "text" &&
			selection.anchor.blockId === selection.focus.blockId &&
			queryBlockElement(root, selection.focus.blockId)
		) {
			void fieldEditor.focusTextSelection(
				selection.focus.blockId,
				selection.anchor.offset,
				selection.focus.offset,
				{ reason: "keyboard" },
			);
		}
		return;
	}

	const blocksHost = root.querySelector(`[${DATA_ATTRS.editorBlocksHost}]`);
	if (!(blocksHost instanceof HTMLElement)) {
		return;
	}

	const firstTextBlock = collectHostTextBlocks(editor, root, blocksHost)[0];
	const blockId = firstTextBlock?.getAttribute(DATA_ATTRS.blockId);
	if (!blockId) {
		return;
	}

	void fieldEditor.focusTextSelection(blockId, 0, 0, {
		reason: "keyboard",
	});
}
