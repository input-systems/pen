import { fieldEditorHostFacet } from "@input/pen-core";
import type { Editor, FieldEditor } from "@input/pen-types";
import type { FieldEditorSession } from "../field-editor/controller";
import type { FieldEditorStore } from "../field-editor/store";

export function getAttachedFieldEditor(editor: Editor): FieldEditor | null {
	return (editor.facet(fieldEditorHostFacet) as FieldEditor | null) ?? null;
}

export function getAttachedFieldEditorStore(
	editor: Editor,
): FieldEditorStore | null {
	return (
		(editor.facet(fieldEditorHostFacet) as FieldEditorStore | null) ?? null
	);
}

/** The attached field editor's session surface (focus-controller writes), for chrome rendered outside the root. */
export function getAttachedFieldEditorSession(
	editor: Editor,
): FieldEditorSession | null {
	return (
		(editor.facet(fieldEditorHostFacet) as FieldEditorSession | null) ??
		null
	);
}
