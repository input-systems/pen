import type { SelectionState } from "@input/pen-types";
import type { PenFieldEditorFocusOptions } from "./controller";
import type {
	GestureEventKind,
	GestureWindowState,
	ReaderSelection,
	SelectionReader,
} from "./selectionReader";
import {
	FieldEditorSelectionAuthority,
	type FieldEditorSelectionSnapshot,
	type FieldEditorSelectionSource,
} from "./selectionAuthority";
import type { ProjectionScroll } from "./projectionScroll";
import {
	SelectionProjector,
	type ProjectionMountRequester,
	type ProjectionTrigger,
} from "./selectionProjector";

type SelectionProjectorOptions = Omit<
	ConstructorParameters<typeof SelectionProjector>[0],
	"getGestureWindows"
>;

export class FieldEditorSelectionCoordinator {
	private readonly _authority = new FieldEditorSelectionAuthority();
	private readonly _projection: SelectionProjector;
	private readonly _reader: SelectionReader;
	private _editContextSelection: FieldEditorSelectionSnapshot | null = null;

	constructor(options: SelectionProjectorOptions, reader: SelectionReader) {
		this._reader = reader;
		this._projection = new SelectionProjector({
			...options,
			getGestureWindows: () => reader.windows,
		});
	}

	get isApplyingSelection(): number {
		return this._authority.isApplyingSelection;
	}

	reset(): void {
		this._authority.reset();
		this._editContextSelection = null;
		this._projection.reset();
		this._reader.resetGestures();
	}

	get lastProjectedVersion(): number {
		return this._projection.lastProjectedVersion;
	}

	recordProjectedVersion(version: number): void {
		this._projection.recordProjectedVersion(version);
	}

	/** The parked record version; tests observe P4 parks through it. */
	// fallow-ignore-next-line unused-class-member
	get parkedProjectionVersion(): number | null {
		return this._projection.parkedProjectionVersion;
	}

	ackBlockMounted(blockId: string, element: HTMLElement): void {
		this._projection.ackBlockMounted(blockId, element);
	}

	setMountRequester(requester: ProjectionMountRequester | null): void {
		this._projection.setMountRequester(requester);
	}

	scrollIntoView(
		target: { readonly blockId: string } | "selection",
		scroll: Exclude<ProjectionScroll, "none">,
	): void {
		this._projection.scrollIntoView(target, scroll);
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
		this._reader.notifyGesture("pointerdown");
	}

	endPointerSelection(): void {
		this._reader.notifyGesture("pointerup");
	}

	notifyGestureEvent(eventKind: GestureEventKind): void {
		this._reader.notifyGesture(eventKind);
	}

	/** The reader's gesture inputs reach the projector after the windows change. */
	onGesture(eventKind: GestureEventKind): void {
		this._projection.onGesture(eventKind);
	}

	getGestureWindows(): GestureWindowState {
		return this._reader.windows;
	}

	isAdmissibleGestureRead(): boolean {
		return this._reader.isAdmissibleRead();
	}

	isProjectionInFlight(): boolean {
		return this._projection.isProjectionInFlight();
	}

	requestDivergenceProjection(read?: ReaderSelection): void {
		this._projection.requestDivergenceProjection(read);
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

	project(trigger: ProjectionTrigger): void {
		this._projection.project(trigger);
	}

	projectNonTextSelection(state: SelectionState | null): void {
		this._projection.projectNonTextSelection(state);
	}

	withholdForComposition(): boolean {
		return this._projection.withholdForComposition();
	}

	projectAfterRebuild(blockIds: readonly string[]): void {
		this._projection.projectAfterRebuild(blockIds);
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
