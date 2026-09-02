import type { SelectionState } from "@input/pen-types";
import type { PenFieldEditorFocusOptions } from "./controller";
import type { GestureEventKind, GestureWindowState } from "./selectionReader";
import {
	FieldEditorSelectionAuthority,
	type FieldEditorSelectionSnapshot,
	type FieldEditorSelectionSource,
} from "./selectionAuthority";
import { SelectionProjectionController } from "./selectionProjectionController";

type SelectionProjectionControllerOptions = ConstructorParameters<
	typeof SelectionProjectionController
>[0];

export class FieldEditorSelectionCoordinator {
	private readonly _authority = new FieldEditorSelectionAuthority();
	private readonly _projection: SelectionProjectionController;
	private _editContextSelection: FieldEditorSelectionSnapshot | null = null;

	constructor(options: SelectionProjectionControllerOptions) {
		this._projection = new SelectionProjectionController(options);
	}

	get isApplyingSelection(): number {
		return this._authority.isApplyingSelection;
	}

	reset(): void {
		this._authority.reset();
		this._editContextSelection = null;
		this._projection.reset();
	}

	get lastProjectedVersion(): number {
		return this._projection.lastProjectedVersion;
	}

	recordProjectedVersion(version: number): void {
		this._projection.recordProjectedVersion(version);
	}

	get parkedProjectionVersion(): number | null {
		return this._projection.parkedProjectionVersion;
	}

	ackBlockMounted(blockId: string, element: HTMLElement): void {
		this._projection.ackBlockMounted(blockId, element);
	}

	resetAuthority(): void {
		this._authority.reset();
		this._editContextSelection = null;
	}

	setAuthoritySelection(
		source: FieldEditorSelectionSource,
		selection: FieldEditorSelectionSnapshot | null,
	): void {
		this._authority.set(source, selection);
	}

	getAuthoritySelection(
		source: FieldEditorSelectionSource,
		blockId?: string | null,
	): FieldEditorSelectionSnapshot | null {
		return this._authority.get(source, blockId);
	}

	hasAuthoritySelection(source: FieldEditorSelectionSource): boolean {
		return this._authority.has(source);
	}

	clearAuthoritySelection(source: FieldEditorSelectionSource): void {
		this._authority.clear(source);
	}

	beginApplyingSelection(): () => void {
		return this._authority.beginApplyingSelection();
	}

	withSelectionWrite<T>(write: () => T): T {
		return this._authority.withSelectionWrite(write);
	}

	setEditContextSelection(
		selection: FieldEditorSelectionSnapshot | null,
	): void {
		this._editContextSelection = selection;
	}

	getEditContextSelection(
		blockId?: string | null,
	): FieldEditorSelectionSnapshot | null {
		if (
			!this._editContextSelection ||
			(blockId && this._editContextSelection.blockId !== blockId)
		) {
			return null;
		}
		return this._editContextSelection;
	}

	beginPointerSelection(): void {
		this._projection.beginPointerSelection();
	}

	endPointerSelection(): void {
		this._projection.endPointerSelection();
	}

	notifyGestureEvent(eventKind: GestureEventKind): void {
		this._projection.notifyGestureEvent(eventKind);
	}

	getGestureWindows(): GestureWindowState {
		return this._projection.getGestureWindows();
	}

	isAdmissibleGestureRead(): boolean {
		return this._projection.isAdmissibleGestureRead();
	}

	isProjectionInFlight(): boolean {
		return this._projection.isProjectionInFlight();
	}

	requestDivergenceProjection(): void {
		this._projection.requestDivergenceProjection();
	}

	shouldHandleDomSelectionChange(
		blockId: string | null,
		isApplyingSelection: number,
	): boolean {
		return this._projection.shouldHandleDomSelectionChange(
			blockId,
			isApplyingSelection,
		);
	}

	prepareSyncedTextSelection(
		currentSelection: SelectionState | null,
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): "skip" | "apply" {
		return this._projection.prepareSyncedTextSelection(
			currentSelection,
			blockId,
			anchorOffset,
			focusOffset,
		);
	}

	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: PenFieldEditorFocusOptions,
	): void {
		this._projection.activateTextSelection(
			blockId,
			anchorOffset,
			focusOffset,
			options,
		);
	}

	commitProgrammaticTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: PenFieldEditorFocusOptions,
	): void {
		this._projection.commitProgrammaticTextSelection(
			blockId,
			anchorOffset,
			focusOffset,
			options,
		);
	}

	syncDomSelectionOnce(): void {
		this._projection.syncDomSelectionOnce();
	}

	shouldProjectSelectionAfterReconcile(): boolean {
		return this._projection.shouldProjectSelectionAfterReconcile();
	}

	isFocusHeldByNativeControlOutsideRoot(): boolean {
		return this._projection.isFocusHeldByNativeControlOutsideRoot();
	}

	recordUserSelectionIntent(): void {
		this._projection.recordUserSelectionIntent();
	}
}
