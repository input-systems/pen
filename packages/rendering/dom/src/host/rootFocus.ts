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
	fieldEditor: Pick<
		FieldEditorSession,
		"focusTextSelection" | "requestRootFocus"
	> &
		Partial<Pick<FieldEditorSession, "getSubstituteState">>;
	root: HTMLElement;
	readonly?: boolean;
}

/** Transfers focus entering the editor root from outside into the active editor surface. */
export function handleFieldEditorRootFocus(
	options: FieldEditorRootFocusOptions,
): void {
	const { event, editor, fieldEditor, root, readonly } = options;
	if (event.target !== root) {
		return;
	}
	// Focus that moved to the root from inside the editor is a projection
	// (P: an app or null record, or a deactivated field), not focus entering
	// the editor, and stays on the root (D18).
	const from = event.relatedTarget;
	if (from instanceof Node && root.contains(from)) {
		return;
	}

	const selection = editor.selection;
	if (
		selection?.type === "block" ||
		selection?.type === "cell" ||
		fieldEditor.getSubstituteState?.() != null
	) {
		const focusSink = root.querySelector(
			`:scope > [${FOCUS_SINK_ATTR}]`,
		);
		if (focusSink instanceof HTMLElement) {
			fieldEditor.requestRootFocus(focusSink, "selection-project", {
				preventScroll: true,
			});
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
