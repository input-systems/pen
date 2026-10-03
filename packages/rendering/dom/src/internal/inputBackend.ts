import type { PenFieldEditorFocusOptions } from "../field-editor/controller";

export interface InputBackend {
	/**
	 * `focusOptions` are the attach's: a passive or `domFocus: false` attach
	 * passes them to the backend's own focus request, which then does not
	 * move focus.
	 */
	activate(
		element: HTMLElement,
		ytext: unknown,
		focusOptions?: PenFieldEditorFocusOptions,
	): void;
	deactivate(): void;
	updateSelection(relPos: unknown): void;
	/**
	 * W3.R6 equivalence skip: whether selection state the backend keeps
	 * outside the DOM (an EditContext buffer) already matches the authority.
	 */
	selectionAgreesWithAuthority?(): boolean;
	/**
	 * Writes the record into that non-DOM state only. The projector calls it
	 * when the DOM already shows the record but the backend state does not,
	 * so a drag or click the reader accepted is not rewritten mid-gesture.
	 */
	writeSelectionState?(): void;
	/** FE9: an A5 `mapped` `selectionChange`; pre-apply input state is stale. */
	selectionMapped?(): void;
}
