/**
 * HOST9: an authority write projects, and moves focus, only while the editor
 * already owns focus (or its origin takes focus). Tests that exercise P1–P4
 * through programmatic writes give the root focus first, as a user would.
 */
export function focusEditorRoot(root: HTMLElement): void {
	root.tabIndex = -1;
	root.focus();
}
