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
}
