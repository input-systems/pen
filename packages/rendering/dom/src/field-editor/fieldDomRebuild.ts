import type { Editor, InlineDecoration } from "@input/pen-types";
import type { FieldEditorTextLike } from "./crdt";
import { fullReconcileToDOM } from "./reconciler";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";

/**
 * Renders `ytext` into the field element, replacing its children. Shared by
 * the single-field backends (`FieldInputBackendBase.rebuildField`) and the
 * session reconciler.
 */
export function renderFieldFromModel(
	editor: Editor,
	ytext: FieldEditorTextLike,
	element: HTMLElement,
	inlineDecorations: readonly InlineDecoration[],
): void {
	fullReconcileToDOM(ytext, element, editor.schema, {
		urlPolicy: urlPolicyFromEditor(editor),
		inlineDecorations,
	});
}
