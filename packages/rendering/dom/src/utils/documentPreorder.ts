import type { Editor } from "@input/pen-types";

/** Nested document order from `DocumentState`'s cached preorder (SCALE2). */
export function getPreorderBlockIds(editor: Editor): readonly string[] {
	return editor.documentState.preorderBlockIds();
}
