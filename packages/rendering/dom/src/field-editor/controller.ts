import type {
	BlockSchema,
	Editor,
	FieldEditorFocusOptions,
	SelectionOrigin,
} from "@input/pen-types";
import type { FieldEditorStore } from "./store";
import type { DirectionalSelectionOffsets } from "./selectionMapping";
import type { EditorSelectAllBehavior } from "../constants/selectAll";
import type {
	DomSelectionReadDecision,
	GestureEventKind,
	GestureWindowState,
	ReaderSelection,
} from "./selectionReader";
import type { S2ExceptionKind } from "./selectionProjector";

export type FieldEditorFocusReason =
	| "activate"
	| "backend-activate"
	| "backend-attach"
	| "selection-project"
	| "selection-activate"
	| "selection-sync"
	| "restore"
	| "cell"
	| "select-all";

export type PenFocusAction =
	| "activate"
	| "attach-backend"
	| "focus-dom"
	| "project-selection"
	| "restore"
	| "select-all";

export type PenFocusReason = NonNullable<FieldEditorFocusOptions["reason"]>;

export type PenFocusDecision =
	{ type: "allow" } | { type: "allow-passive" } | { type: "deny" };

export interface FieldEditorFocusRequest {
	editor: Editor;
	target: HTMLElement;
	root: HTMLElement | null;
	reason: FieldEditorFocusReason;
	action: PenFocusAction;
	source: PenFocusReason;
	blockId: string | null;
	passive?: boolean;
}

export type PenFocusRequest = FieldEditorFocusRequest;

export interface PenFocusPolicy {
	decide(request: FieldEditorFocusRequest): PenFocusDecision;
	onDenied?(request: FieldEditorFocusRequest): void;
}

export type PenFieldEditorFocusOptions = FieldEditorFocusOptions;

export type PenFocusLifecycleEvent =
	| {
			type: "field-editor-attached";
			editor: Editor;
			root: HTMLElement | null;
	  }
	| {
			type: "backend-attach-started" | "backend-attach-completed";
			editor: Editor;
			target: HTMLElement;
			blockId: string | null;
	  }
	| {
			type: "selection-projected";
			editor: Editor;
			blockId: string | null;
	  }
	| {
			type: "focus-request-denied";
			request: FieldEditorFocusRequest;
	  }
	| {
			type: "activation-changed";
			editor: Editor;
			activeBlockIds: readonly string[];
			isEditing: boolean;
	  };

export type PenFocusLifecycleListener = (event: PenFocusLifecycleEvent) => void;

export type ActiveCellCoord = {
	blockId: string;
	row: number;
	col: number;
};

type FieldEditorSelectionState = Pick<
	FieldEditorStore,
	"focusBlockId" | "selection" | "inputMode" | "isEditing" | "isComposing"
> & {
	readonly activeCellCoord: ActiveCellCoord | null;
};

export interface FieldEditorRootHandle {
	setRootElement(element: HTMLElement | null): void;
	setFocused(focused: boolean): void;
	/**
	 * The renderer `readonly` prop (O5), read by the overlay. Not the
	 * `pen.ariaReadOnly` facet (AX1).
	 */
	setReadOnly(readonly: boolean): void;
	readonly isReadOnly: boolean;
	/**
	 * D5: the S2 exception in effect for the current record version, or null
	 * (the projector's pure state read). The overlay draws it; focus stays
	 * on the sink while it holds (HOST9).
	 */
	getSubstituteState(): S2ExceptionKind | null;
	setFocusPolicy(focusPolicy: PenFocusPolicy | undefined): void;
	setSelectAllBehavior(behavior: EditorSelectAllBehavior): void;
	deactivate(): void;
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	commitProgrammaticTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	focusTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: PenFieldEditorFocusOptions,
	): Promise<boolean>;
	/**
	 * Projects the current record as an activation (P, S2): the native range
	 * in its surface, with focus. For focus entering the root with a
	 * multi-block text range, which no single-block call can express.
	 */
	focusSelection(): void;
}

export interface FieldEditorDomController extends FieldEditorSelectionState {
	setComposing(composing: boolean): void;
	requestDomFocus(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options?: FocusOptions,
		policyOptions?: PenFieldEditorFocusOptions,
	): boolean;
	requestActivation(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options?: PenFieldEditorFocusOptions,
	): boolean;
	requestRootFocus(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options?: FocusOptions,
	): boolean;
	notifyGestureEvent?(eventKind: GestureEventKind): void;
	getGestureWindows?(): GestureWindowState;
	isAdmissibleGestureRead?(): boolean;
	requestDivergenceProjection?(read?: ReaderSelection): void;
	/**
	 * P3: a reconcile rebuilt these blocks' DOM; project the authority now
	 * when one of them is the mounted projection target. Reconciles never
	 * save or restore the native range themselves.
	 */
	projectAfterRebuild?(blockIds: readonly string[]): void;
	/**
	 * W3.R5: run the reader on the live selection now. Input handlers call it
	 * and then read the authority instead of mapping the DOM themselves.
	 */
	syncDomSelectionRead?(): void;
	/**
	 * S1: the reader's live range inside one field element (see
	 * `SelectionReader.fieldOffsets`). Backends read the DOM selection only
	 * through this.
	 */
	readFieldSelectionOffsets?(
		element: HTMLElement,
	): DirectionalSelectionOffsets | null;
	/**
	 * Whether a field rebuild may write the selection back into the DOM.
	 * False while a native control that is not this field owns focus (HOST9):
	 * setting a DOM selection inside the field would move focus with it.
	 */
	shouldProjectSelectionAfterReconcile?(): boolean;
	readDomSelection?(proposal: ReaderSelection): DomSelectionReadDecision;
	/** A cross-block text selection with its gesture's origin (S3). */
	applyDocumentTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
		origin: SelectionOrigin,
	): void;
	applyDomTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
		origin: SelectionOrigin,
	): void;
	resolveInsertMarks(
		ytext: { toDelta(): unknown[] },
		offset: number,
	): Record<string, unknown | null> | undefined;
	/** A text-input caret write; origin defaults to `keyboard`, `ime` while composing (S3). */
	syncTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		origin?: SelectionOrigin,
	): void;
	/** The edited cell's caret write (W3.R18): `CellSelection.text`, origin as `syncTextSelection`. */
	syncCellTextSelection(
		cell: ActiveCellCoord,
		anchorOffset: number,
		focusOffset: number,
		origin?: SelectionOrigin,
	): void;
	notifyDomReconciled(blockId?: string): void;
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	commitProgrammaticTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	deactivate(): void;
}

export interface FieldEditorKeyboardController extends Pick<
	FieldEditorSelectionState,
	"focusBlockId" | "inputMode"
> {
	readonly activeCellCoord: ActiveCellCoord | null;
	syncCellTextSelection?(
		cell: ActiveCellCoord,
		anchorOffset: number,
		focusOffset: number,
		origin?: SelectionOrigin,
	): void;
	/** Which rung `Mod-a` enters the T1 ladder on, from the interaction model. */
	readonly selectAllBehavior: EditorSelectAllBehavior;
	activateCell(blockId: string, row: number, col: number): void;
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	commitProgrammaticTextSelection?(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	deactivate(): void;
}

export interface FieldEditorTableNavigationController {
	readonly isEditing: boolean;
	activateCell?(blockId: string, row: number, col: number): void;
	activateCellFromElement?(
		blockId: string,
		row: number,
		col: number,
		element: HTMLElement,
	): void;
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	deactivate(): void;
}

export interface FieldEditorEscapeController extends Pick<
	FieldEditorSelectionState,
	"focusBlockId" | "isEditing" | "isComposing"
> {
	readonly activeCellCoord: ActiveCellCoord | null;
	collapseSelectionToFocus(): void;
	deactivate(): void;
}

export interface FieldEditorTransferController {
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	/** The reader's gesture windows, for the paste caret's origin (S3). */
	getGestureWindows?(): GestureWindowState;
}

export type FieldEditorInputController = FieldEditorDomController &
	FieldEditorKeyboardController;

export type FieldEditorSession = FieldEditorStore &
	FieldEditorRootHandle &
	FieldEditorInputController &
	FieldEditorTableNavigationController &
	FieldEditorEscapeController & {
		beginPointerSelection(): void;
		endPointerSelection(): void;
		notifyGestureEvent(eventKind: GestureEventKind): void;
		isAdmissibleGestureRead(): boolean;
		readDomSelection(proposal: ReaderSelection): DomSelectionReadDecision;
		suspendForPointerSelection(): void;
		getPendingMarks(): Readonly<Record<string, unknown | null>>;
		togglePendingMark(markType: string): boolean;
		clearPendingMarks(): void;
		collapseSelectionToAnchor(): void;
		collapseSelectionToPoint(
			point: {
				blockId: string;
				offset: number;
			},
			origin?: SelectionOrigin,
		): void;
		onFocusLifecycle(listener: PenFocusLifecycleListener): () => void;
		waitForAttachment(blockId?: string | null): Promise<boolean>;
		/** Whether the live DOM selection maps inside this editor's root. */
		hasSelectionInRoot(): boolean;
		syncDomSelectionRead(): void;
		ackBlockMounted(blockId: string, element: HTMLElement): void;
		delegate(blockSchema: BlockSchema): boolean;
	};
