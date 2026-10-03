import type { ReaderSelection } from "../field-editor/selectionReader";

export interface InputBackend {
	activate(element: HTMLElement, ytext: unknown): void;
	deactivate(): void;
	updateSelection(relPos: unknown): void;
	/**
	 * PH1 only (W3.R4): the backend's echo restore for a read the reader
	 * mapped inside the root and found not equivalent. True when handled.
	 */
	interceptDomSelectionRead?(
		proposal: Exclude<ReaderSelection, null>,
	): boolean;
	/**
	 * W3.R6 equivalence skip: whether selection state the backend keeps
	 * outside the DOM (an EditContext buffer) already matches the authority.
	 */
	selectionAgreesWithAuthority?(): boolean;
	/** FE9: an A5 `mapped` `selectionChange`; pre-apply input state is stale. */
	selectionMapped?(): void;
}
