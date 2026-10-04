import type { Editor, InlineDecoration } from "@input/pen-types";
import type { FieldEditorInputController } from "./controller";
import type { FieldEditorTextLike } from "./crdt";
import { fullReconcileToDOM } from "./reconciler";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import {
	buildInlineDecorationsRenderSignature,
	inlineDecorationsForBlock,
} from "../utils/inlineDecorations";

/**
 * Field DOM rebuilds shared by the single-field backends (contenteditable and
 * EditContext): both render the focused block's text with its inline
 * decorations and report the rebuild to the field editor.
 */
type FocusedField = Pick<
	FieldEditorInputController,
	"focusBlockId" | "notifyDomReconciled"
>;

/** The inline decorations of the focused field's block. */
export function focusedFieldDecorations(
	editor: Editor,
	fieldEditor: FocusedField,
): readonly InlineDecoration[] {
	return inlineDecorationsForBlock(editor, fieldEditor.focusBlockId);
}

/** Their render signature: `previous` itself while they render the same. */
export function focusedFieldDecorationsSignature(
	editor: Editor,
	fieldEditor: FocusedField,
	previous: readonly InlineDecoration[] | null,
): readonly InlineDecoration[] {
	return buildInlineDecorationsRenderSignature(
		focusedFieldDecorations(editor, fieldEditor),
		previous,
	);
}

/** Renders `ytext` into the field element, replacing its children. */
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

/** Renders the focused field from the model and reports the rebuild (FE4). */
export function rebuildFocusedField(
	editor: Editor,
	fieldEditor: FocusedField,
	ytext: FieldEditorTextLike,
	element: HTMLElement,
	inlineDecorations = focusedFieldDecorations(editor, fieldEditor),
	blockId = fieldEditor.focusBlockId ?? undefined,
): void {
	renderFieldFromModel(editor, ytext, element, inlineDecorations);
	fieldEditor.notifyDomReconciled(blockId);
}
