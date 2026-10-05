import type { Editor } from "@input/pen-types";

/**
 * The document each editor's root lives in. Chrome that only has the editor
 * (a menu positioned for the selection, the AI scope) queries that document
 * rather than the global one, so an editor a host mounts into an iframe is
 * found in the iframe. The field editor records its root when it binds one.
 */
const editorRoots = new WeakMap<Editor, HTMLElement>();

export function recordEditorRootElement(
	editor: Editor,
	root: HTMLElement,
): void {
	editorRoots.set(editor, root);
}

/** Forgets `root`, unless another root has been recorded for the editor since. */
export function forgetEditorRootElement(
	editor: Editor,
	root: HTMLElement,
): void {
	if (editorRoots.get(editor) === root) {
		editorRoots.delete(editor);
	}
}

/** The editor's root document; the global one before a root is bound, null without a DOM. */
export function resolveEditorDocument(editor: Editor): Document | null {
	const root = editorRoots.get(editor);
	if (root) {
		return root.ownerDocument;
	}
	return typeof document === "undefined" ? null : document;
}
