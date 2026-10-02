import type { Editor } from "@input/pen-types";
import { FOCUS_SINK_ATTR } from "../a11y/focusSink";
import type { FieldEditorSession } from "../field-editor/controller";
import { queryBlockElement } from "../field-editor/selectionDomQueries";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { collectHostTextBlocks } from "./pointerActivation";

/** Options for transferring editor-root focus into the active editor surface. */
export interface FieldEditorRootFocusOptions {
	event: FocusEvent;
	editor: Editor;
	fieldEditor: Pick<FieldEditorSession, "focusTextSelection">;
	root: HTMLElement;
	readonly?: boolean;
}

/** Transfers direct editor-root focus into the active editor surface. */
export function handleFieldEditorRootFocus(
	options: FieldEditorRootFocusOptions,
): void {
	const { event, editor, fieldEditor, root, readonly } = options;
	if (event.target !== root) {
		return;
	}

	const selection = editor.selection;
	if (selection?.type === "block" || selection?.type === "cell") {
		const focusSink = root.querySelector(
			`:scope > [${FOCUS_SINK_ATTR}]`,
		);
		if (focusSink instanceof HTMLElement) {
			focusSink.focus({ preventScroll: true });
		}
		return;
	}

	if (readonly === true) {
		return;
	}

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
