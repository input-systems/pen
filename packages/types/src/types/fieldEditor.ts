import type { SelectionOrigin } from "./selection";
import type { BlockSchema } from "./schema";
import type { SelectionRecord, SelectionState } from "./selection";
import type { GenerationZone } from "./crdt";
import type { OpOrigin } from "./ops";
import type { Unsubscribe } from "./utility";
import type { FieldEditorInputMode } from "./fieldEditorCapabilities";

export type FieldEditorFocusReason =
	| "user-pointer"
	| "keyboard"
	| "programmatic"
	| "default"
	| "backend"
	| "selection-sync";

export type FieldEditorFocusOptions = {
	reason?: FieldEditorFocusReason;
	domFocus?: boolean;
	passive?: boolean;
	/** The selection write's origin (S3); `"programmatic"` when omitted. */
	origin?: SelectionOrigin;
};

export interface FieldEditor {
	readonly focusBlockId: string | null;
	readonly activeBlockIds: readonly string[];
	readonly isEditing: boolean;
	readonly isFocused: boolean;
	readonly isComposing: boolean;
	readonly inputMode: FieldEditorInputMode;
	selection: SelectionState | null;

	focus(options?: FieldEditorFocusOptions): boolean;
	blur(): void;
	activate(blockId: string): void;
	activateCell?(blockId: string, row: number, col: number): void;
	activateCellFromElement?(
		blockId: string,
		row: number,
		col: number,
		element: HTMLElement,
	): void;
	deactivate(): void;
	suspendForPointerSelection?(): void;
	syncTextSelection?(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void;
	activateTextSelection?(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	focusTextSelection?(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): Promise<boolean>;
	commitProgrammaticTextSelection?(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void;
	waitForAttachment?(blockId?: string | null): Promise<boolean>;

	expandTo(blockId: string): void;
	contractToFocused(): void;

	attachElement(el: HTMLElement): void;
	delegate(blockSchema: BlockSchema): boolean;
	getPendingMarks?(): Readonly<Record<string, unknown | null>>;
	togglePendingMark?(markType: string): boolean;
	clearPendingMarks?(): void;

	destroy(): void;

	onActivate?(callback: (blockIds: string[]) => void): Unsubscribe;
	onDeactivate?(callback: (blockIds: string[]) => void): Unsubscribe;
	onSelectionChange?(
		callback: (record: SelectionRecord) => void,
	): Unsubscribe;
}

export interface StreamingTarget {
	readonly generationZone: GenerationZone | null;
	beginStreaming(zoneId: string, blockId: string, origin?: OpOrigin): void;
	appendDelta(delta: string): void;
	endStreaming(status: "complete" | "cancelled" | "error"): void;
}
