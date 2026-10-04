import type {
	BlockScrollAlign,
	DiagnosticEvent,
	SelectionOrigin,
	SelectionRecord,
	SelectionState,
} from "@input/pen-types";
import type { PenFieldEditorFocusOptions } from "./controller";
import {
	nativeSelectionForWrite,
	type GestureEventKind,
	type GestureWindowState,
	type ProjectionReadBack,
	type ReaderSelection,
} from "./selectionReader";
import {
	isForeignNativeTextEntryTarget,
	isNativeTextEntryTarget,
} from "../utils/textEntryTarget";
import type { GeometryReader, Rect } from "../geometry/types";
import { findLogicalDOMPoint } from "./inlineAtomDom";
import {
	applyScrollPlan,
	measureScrollPlan,
	resolveProjectionScroll,
	selectionScrollTarget,
	type ProjectionCommit,
	type ProjectionScroll,
	type ScrollPlan,
} from "./projectionScroll";
import { findDOMPoint } from "./selectionBridgeOffsets";
import type { SelectionPoint } from "./selectionBridge";
import { queryBlockElement } from "./selectionDomQueries";
import { isSingleFieldNativeLeftover } from "./singleFieldNativeLeftover";

/**
 * The selection writer (S1). Every mutation of the DOM selection or of an
 * EditContext's selection in the renderer packages goes through this module;
 * `pen/no-dom-selection-write` reports a write anywhere else. W3 grows this
 * into the projector proper: `project()` with read-back, parking and scroll.
 */

/** Writes `anchor`..`focus` as the native range inside `root`. No-op when either point is unmapped. */
export function writeNativeRange(
	root: HTMLElement,
	anchor: SelectionPoint,
	focus: SelectionPoint,
): void {
	const anchorResult = findDOMPoint(root, anchor.blockId, anchor.offset);
	const focusResult = findDOMPoint(root, focus.blockId, focus.offset);
	if (!anchorResult || !focusResult) return;

	const sel = nativeSelectionForWrite(root);
	if (!sel) return;

	writeNativeRangeAt(sel, anchorResult, focusResult);
}

/**
 * Writes an edited cell's `CellSelection.text` (W3.R18) as the native range
 * inside the cell's inline element, in the cell's logical offsets.
 */
export function writeCellTextRange(
	element: HTMLElement,
	text: { readonly anchor: number; readonly focus: number },
): void {
	const selection = nativeSelectionForWrite(element);
	if (!selection) return;
	writeNativeRangeAt(
		selection,
		findLogicalDOMPoint(element, Math.max(0, text.anchor)),
		findLogicalDOMPoint(element, Math.max(0, text.focus)),
	);
}

/** Clears the native range when it lies inside `root`. */
function clearNativeRangeIn(
	root: HTMLElement,
	keepInside: HTMLElement | null = null,
): void {
	const selection = nativeSelectionForWrite(root);
	if (!selection || selection.rangeCount === 0) return;
	if (!selection.anchorNode || !root.contains(selection.anchorNode)) return;
	if (keepInside?.contains(selection.anchorNode)) return;
	selection.removeAllRanges();
}

/** Replaces the native selection with the range `anchor`..`focus` inside `element`'s document. */
export function writeNativeRangeBetween(
	element: HTMLElement,
	anchor: { node: Node; offset: number },
	focus: { node: Node; offset: number },
): void {
	const selection = nativeSelectionForWrite(element);
	if (!selection) return;
	const range = element.ownerDocument.createRange();
	range.setStart(anchor.node, anchor.offset);
	range.setEnd(focus.node, focus.offset);
	replaceNativeRange(selection, range);
}

/** Replaces the native selection with `range`. */
function replaceNativeRange(selection: Selection, range: Range): void {
	selection.removeAllRanges();
	selection.addRange(range);
}

/** Writes an EditContext's selection. */
export function writeEditContextSelection(
	editContext: { updateSelection(start: number, end: number): void },
	start: number,
	end: number,
): void {
	editContext.updateSelection(start, end);
}

function resolveWritableDOMPoint(point: { node: Node; offset: number }): {
	node: Node;
	offset: number;
} {
	if (point.node.nodeType !== Node.ELEMENT_NODE) {
		return point;
	}

	const childAtOffset = point.node.childNodes[point.offset];
	if (childAtOffset?.nodeType === Node.TEXT_NODE) {
		return { node: childAtOffset, offset: 0 };
	}

	if (point.offset > 0) {
		const previousChild = point.node.childNodes[point.offset - 1];
		if (previousChild?.nodeType === Node.TEXT_NODE) {
			return {
				node: previousChild,
				offset: previousChild.textContent?.length ?? 0,
			};
		}
	}

	return point;
}

function selectionHasEndpoints(
	selection: Selection,
	anchor: { node: Node; offset: number },
	focus: { node: Node; offset: number },
): boolean {
	return (
		selection.rangeCount > 0 &&
		selection.anchorNode === anchor.node &&
		selection.anchorOffset === anchor.offset &&
		selection.focusNode === focus.node &&
		selection.focusOffset === focus.offset
	);
}

type DOMPoint = { node: Node; offset: number };

/** Writes resolved DOM points, falling back where an engine rejects or normalizes the write. */
function writeNativeRangeAt(
	selection: Selection,
	rawAnchor: DOMPoint,
	rawFocus: DOMPoint,
): void {
	const anchor = resolveWritableDOMPoint(rawAnchor);
	const focus = resolveWritableDOMPoint(rawFocus);
	const intendedRange =
		anchor.node !== focus.node || anchor.offset !== focus.offset;

	if (trySetBaseAndExtent(selection, anchor, focus, intendedRange)) return;

	const collapseRange = document.createRange();
	collapseRange.setStart(anchor.node, anchor.offset);
	collapseRange.collapse(true);
	replaceNativeRange(selection, collapseRange);

	if (!intendedRange || tryExtend(selection, anchor, focus)) return;

	replaceNativeRange(selection, orderedRange(anchor, focus));
}

/** True when `setBaseAndExtent` exists and the endpoints stuck. */
function trySetBaseAndExtent(
	selection: Selection,
	anchor: DOMPoint,
	focus: DOMPoint,
	intendedRange: boolean,
): boolean {
	if (typeof selection.setBaseAndExtent !== "function") return false;
	try {
		selection.setBaseAndExtent(
			anchor.node,
			anchor.offset,
			focus.node,
			focus.offset,
		);
	} catch {
		// Fall back to the range-based path in test environments like jsdom.
		return false;
	}
	// Firefox accepts the call for mixed element/text points but leaves a
	// caret; only trust the write when the endpoints stuck.
	return !intendedRange || selectionHasEndpoints(selection, anchor, focus);
}

/** Extends a collapsed selection at `anchor` to `focus`; true when it took. */
function tryExtend(
	selection: Selection,
	anchor: DOMPoint,
	focus: DOMPoint,
): boolean {
	if (typeof selection.extend !== "function") return false;
	try {
		selection.extend(focus.node, focus.offset);
	} catch {
		// Fall through to an ordered addRange.
		return false;
	}
	return (
		selectionHasEndpoints(selection, anchor, focus) ||
		!selection.isCollapsed
	);
}

function orderedRange(anchor: DOMPoint, focus: DOMPoint): Range {
	const [start, end] =
		compareDOMPoints(anchor, focus) <= 0
			? [anchor, focus]
			: [focus, anchor];
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	return range;
}

function compareDOMPoints(
	left: { node: Node; offset: number },
	right: { node: Node; offset: number },
): number {
	if (left.node === right.node) {
		return left.offset - right.offset;
	}

	const leftRange = document.createRange();
	leftRange.setStart(left.node, left.offset);
	leftRange.collapse(true);

	const rightRange = document.createRange();
	rightRange.setStart(right.node, right.offset);
	rightRange.collapse(true);

	return leftRange.compareBoundaryPoints(Range.START_TO_START, rightRange);
}

type ProjectionOptions = {
	syncBackendImmediately?: boolean;
} & PenFieldEditorFocusOptions;

export type SelectionProjectorOptions = {
	isEditing: () => boolean;
	getMode: () => "inactive" | "single" | "expanded" | "block";
	getFocusBlockId: () => string | null;
	getAttachedElement: () => HTMLElement | null;
	getRootElement: () => HTMLElement | null;
	findExpandedHost: () => HTMLElement | null;
	resolveInlineElement: (blockId: string) => HTMLElement | null;
	attachElement: (
		element: HTMLElement,
		options?: PenFieldEditorFocusOptions,
	) => boolean;
	requestDomFocus: (
		target: HTMLElement,
		reason: "selection-project",
		options?: FocusOptions,
		policyOptions?: PenFieldEditorFocusOptions,
	) => boolean;
	updateBackendSelection: () => void;
	setTextSelection: (
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		origin?: SelectionOrigin,
	) => void;
	activate: (blockId: string) => void;
	emitSelectionProjected: () => void;
	getRecord?: () => SelectionRecord | null;
	emitDiagnostic?: (event: DiagnosticEvent) => void;
	/** W3.R1: the DOM selection after a write, against the record; null skips the check. */
	readBack?: (target: HTMLElement) => ProjectionReadBack | null;
	/** "text", "expanded" or "cell" for the mismatch payload. */
	getSurface?: () => string;
	/**
	 * Whether the attached backend's own selection state (an EditContext
	 * buffer) already matches the record. The equivalence skip needs it as
	 * well as an equivalent DOM; absent means there is no such state.
	 */
	backendSelectionAgrees?: () => boolean;
	/** Writes the record into that backend state alone, leaving the DOM. */
	writeBackendSelectionState?: () => void;
	/** The reader's gesture windows (R1–R3); the reader owns them. */
	getGestureWindows: () => GestureWindowState;
	/** The root's scheduler: the unmounted check and scroll jobs queue on it. */
	getScheduler?: () => {
		read(job: () => void): Promise<unknown>;
		write(job: () => void): Promise<void>;
	} | null;
	/** The last commit, for `"auto"` scroll's local-typing case (W3.R15). */
	getLastCommit?: () => ProjectionCommit | null;
	/**
	 * D5: whether the record is a text range over more than the block-surface
	 * threshold. Absent, the surface mode `block` answers it.
	 */
	isBlockSurfaceRange?: (record: SelectionRecord) => boolean;
	/** D5: projects focus for a substitute state: the sink, revealed as a text range. */
	projectSubstituteFocus?: () => void;
	/** D5: the substitute state changed for the same record version. */
	onSubstituteChange?: () => void;
};

/**
 * The two declared S2 exceptions (D5, `spec/rules/selection.md` S2): a text
 * range over more than the block-surface threshold, and a multi-block text
 * range whose write the engine confined to one field. Both show the same
 * substitute state: no native range in the root, focus on the sink revealed
 * as a text range, and the overlay painting the range.
 */
export type S2ExceptionKind = "block-surface-range" | "engine-confined-range";

/** What asked for a projection, for the mismatch payload and its once-per key. */
export type ProjectionTrigger =
	| "selection-change"
	| "mount-ack"
	| "divergence"
	| "target-rebuilt"
	| "window-closed"
	| "activation";

/** Authority-driven triggers (P1–P4); a composition withholds them. */
const AUTHORITY_TRIGGERS: ReadonlySet<ProjectionTrigger> = new Set([
	"selection-change",
	"mount-ack",
	"divergence",
	"target-rebuilt",
]);

/**
 * Asks the host to mount a block the projector parked on (W3.R9). W4
 * implements it over `BlockWindow.reveal`. The resulting
 * `ackBlockMounted(blockId, element)` must arrive within the same task, or
 * the next flush reports `selection-target-unmounted`.
 */
export interface ProjectionMountRequester {
	requestMount(
		blockId: string,
		request: {
			readonly version: number;
			readonly align: BlockScrollAlign | null;
		},
	): void;
}

/**
 * The selection projector (S1, P): writes the selection authority into the
 * DOM for one editor root. Every projection has a cause (`ProjectionTrigger`):
 * P1 a newer record, P2 a divergence, P3 a rebuilt target, P4 a mount ack, a
 * released composition window, or a gesture/programmatic activation. It
 * withholds under HOST9 and composition, skips a write the DOM already
 * shows, reads every write back, and guards P2 loops (W3.R6, W3.R7).
 */
export class SelectionProjector {
	private readonly _options: SelectionProjectorOptions;
	private _lastProjectedVersion = 0;
	private _parked: { version: number; blockId: string | null } | null = null;
	private _mountRequester: ProjectionMountRequester | null = null;
	/** The scroll option of the projection in progress. */
	private _scroll: ProjectionScroll = "auto";
	/** Supersedes a pending `scrollIntoView` when a newer one is asked. */
	private _scrollToken = 0;
	private _trigger: ProjectionTrigger = "activation";
	private readonly _reportedMismatches = new Set<string>();
	/** A projection withheld while composing; released once on compositionend-completed. */
	private _withheldForComposition = false;
	/** W3.R7: the version and read-back of the last reported mismatch. */
	private _lastMismatch: {
		version: number;
		actual: ReaderSelection | null;
	} | null = null;
	/** D5: the block-surface answer for one record version. */
	private _blockSurface: { version: number; value: boolean } | null = null;
	/** D5: a block-surface version withheld while the pointer window is open. */
	private _pointerWithheldVersion: number | null = null;
	/** D5: the version whose write the engine confined to one field. */
	private _confinedVersion: number | null = null;

	constructor(options: SelectionProjectorOptions) {
		this._options = options;
	}

	reset(): void {
		this._withheldForComposition = false;
	}

	get lastProjectedVersion(): number {
		return this._lastProjectedVersion;
	}

	recordProjectedVersion(version: number): void {
		this._lastProjectedVersion = version;
	}

	get parkedProjectionVersion(): number | null {
		return this._parked?.version ?? null;
	}

	/**
	 * D5: the S2 exception in effect for the current record version, or null.
	 * `block-surface-range` for a text range over the threshold unless a
	 * pointer gesture withholds it; `engine-confined-range` once the last
	 * projection of this version fell back after its read-back. A pure state
	 * read with no DOM access, so the overlay may call it in its read phase.
	 */
	getSubstituteState(): S2ExceptionKind | null {
		const record = this._options.getRecord?.();
		if (record?.state?.type !== "text") {
			return null;
		}
		if (this._confinedVersion === record.version) {
			return "engine-confined-range";
		}
		if (this._pointerWithheldVersion === record.version) {
			return null;
		}
		return this._isBlockSurfaceRange(record) ? "block-surface-range" : null;
	}

	private _isBlockSurfaceRange(record: SelectionRecord): boolean {
		const isBlockSurfaceRange = this._options.isBlockSurfaceRange;
		if (!isBlockSurfaceRange) {
			return this._options.getMode() === "block";
		}
		if (this._blockSurface?.version !== record.version) {
			this._blockSurface = {
				version: record.version,
				value: isBlockSurfaceRange(record),
			};
		}
		return this._blockSurface.value;
	}

	/**
	 * P4 (W3.R8): an ack resolves only a projection parked on `blockId`, in
	 * the ack's turn, while the parked version is still the record's. Every
	 * other ack is an O(1) no-op.
	 */
	ackBlockMounted(blockId: string, _element: HTMLElement): void {
		const parked = this._parked;
		if (parked === null || parked.blockId !== blockId) {
			return;
		}
		if (parked.version !== (this._options.getRecord?.()?.version ?? 0)) {
			return;
		}
		if (this.isFocusHeldByNativeControlOutsideRoot()) {
			return;
		}
		this.project("mount-ack");
	}

	private _withTrigger(
		trigger: ProjectionTrigger,
		project: () => void,
	): void {
		const previous = this._trigger;
		this._trigger = trigger;
		try {
			project();
		} finally {
			this._trigger = previous;
		}
	}

	/** The reader's gesture inputs, after its windows reflect them. */
	onGesture(eventKind: GestureEventKind): void {
		if (eventKind === "pointerup") {
			// S2: during a drag the engine's own selection controller can
			// re-clamp the native range after the projector wrote the
			// pointer path's record (a drag that starts in a code block stays
			// in that editing host). The gesture's last record is final at
			// pointerup, so project it once more; the equivalence skip makes
			// this a no-op whenever the DOM already agrees.
			this.project("window-closed");
		}
		if (eventKind === "compositionend-completed") {
			this._releaseCompositionWithholding();
		}
	}

	/**
	 * W3.R6, C1/C2: while the IME window is open the composing field owns its
	 * DOM range, so an authority-driven projection (P1–P4) is recorded, not
	 * written. True when this call withheld one.
	 */
	withholdForComposition(): boolean {
		if (!this._options.getGestureWindows().ime) {
			return false;
		}
		this._withheldForComposition = true;
		return true;
	}

	private _releaseCompositionWithholding(): void {
		if (
			!this._withheldForComposition ||
			this._options.getGestureWindows().ime
		) {
			return;
		}
		this._withheldForComposition = false;
		if (this.isFocusHeldByNativeControlOutsideRoot()) {
			return;
		}
		this.project("window-closed");
	}

	/**
	 * P2. `read` is the divergent proposal; W3.R7 refuses to re-project a
	 * version whose last projection read back exactly this, because the
	 * engine normalized the write and another write would loop.
	 */
	requestDivergenceProjection(read?: ReaderSelection): void {
		if (this.isFocusHeldByNativeControlOutsideRoot()) {
			return;
		}
		if (read !== undefined && this._isReportedMismatch(read)) {
			return;
		}
		this.project("divergence");
	}

	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: PenFieldEditorFocusOptions,
	): void {
		this.projectTextSelection(blockId, anchorOffset, focusOffset, options);
	}

	commitProgrammaticTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options: PenFieldEditorFocusOptions = {},
	): void {
		this.projectTextSelection(blockId, anchorOffset, focusOffset, {
			...options,
			syncBackendImmediately: true,
		});
	}

	projectTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: ProjectionOptions,
	): void {
		this._options.setTextSelection(
			blockId,
			anchorOffset,
			focusOffset,
			options?.origin,
		);

		if (
			!this._options.isEditing() ||
			this._options.getFocusBlockId() !== blockId
		) {
			this._options.activate(blockId);
		}

		if (options?.syncBackendImmediately ?? true) {
			this._options.updateBackendSelection();
		}
		this.project("activation", options);
	}

	/** Projects the record now, for `trigger`; `scroll` defaults to `"auto"`. */
	project(
		trigger: ProjectionTrigger,
		options: PenFieldEditorFocusOptions & { scroll?: ProjectionScroll } = {},
	): void {
		const previousScroll = this._scroll;
		this._scroll = options.scroll ?? "auto";
		try {
			this._withTrigger(trigger, () => this._project(options));
		} finally {
			this._scroll = previousScroll;
		}
	}

	/**
	 * W3.R15: brings a block or the current selection into view through the
	 * same scheduled read (measure) and write (scroll) as projection scroll.
	 * W4's `scrollToBlock` uses it when no BlockWindow is attached.
	 */
	scrollIntoView(
		target: { readonly blockId: string } | "selection",
		scroll: Exclude<ProjectionScroll, "none">,
	): void {
		const align = scroll === "auto" ? "nearest" : scroll.align;
		const token = ++this._scrollToken;
		const measure =
			target === "selection"
				? (reader: GeometryReader, view: Rect) =>
						selectionScrollTarget(
							reader,
							this._options.getRecord?.()?.state ?? null,
							view,
							align,
						)
				: (reader: GeometryReader) => reader.blockRect(target.blockId);
		this._scheduleScroll(align, measure, () => this._scrollToken === token);
	}

	/** After a projection: scroll its target per the record's origin (W3.R15). */
	private _scheduleSelectionScroll(): void {
		const record = this._options.getRecord?.();
		if (!record) {
			return;
		}
		const scroll = resolveProjectionScroll(
			record,
			this._options.getLastCommit?.() ?? null,
			this._scroll,
		);
		if (!scroll) {
			return;
		}
		const version = record.version;
		this._scheduleScroll(
			scroll.align,
			(reader, view) =>
				selectionScrollTarget(reader, record.state, view, scroll.align),
			() => this._lastProjectedVersion === version,
		);
	}

	/** One read (measure) and one write (scroll), skipped once superseded. */
	private _scheduleScroll(
		align: BlockScrollAlign,
		measureTarget: (reader: GeometryReader, view: Rect) => Rect | null,
		isCurrent: () => boolean,
	): void {
		const root = this._options.getRootElement();
		const scheduler = this._options.getScheduler?.();
		if (!root || !scheduler) {
			return;
		}
		let plan: ScrollPlan | null = null;
		void scheduler.read(() => {
			plan = isCurrent() ? measureScrollPlan(root, align, measureTarget) : null;
		});
		void scheduler.write(() => {
			if (plan && isCurrent()) {
				applyScrollPlan(plan);
			}
		});
	}

	private _project(options: PenFieldEditorFocusOptions): void {
		if (this._withheldTrigger()) {
			return;
		}
		if (!this._options.isEditing() && !this._activateForOwnedFocus()) {
			return;
		}

		// S2, D18: a null, app or block record has no native text range to
		// write or read back — the text path would compare the still-active
		// field's range against it and report a mismatch. Clear the range and
		// finish; the focus projection moves focus to the root or the sink.
		// A grid cell record does too. An edited cell's `text` is a native
		// range in the cell element (W3.R18), so that one keeps the text
		// path while the cell surface is attached.
		const record = this._options.getRecord?.();
		if (
			record &&
			(record.state === null ||
				record.state.type === "app" ||
				record.state.type === "block" ||
				(record.state.type === "cell" &&
					(!record.state.text ||
						this._options.getSurface?.() !== "cell")))
		) {
			const root = this._options.getRootElement();
			if (root) {
				clearNativeRangeIn(root);
			}
			this._completeProjection();
			return;
		}
		if (record && this._projectSubstitute(record)) {
			return;
		}
		const target = this._projectIntoTarget(options);
		if (target.projected) {
			this._completeProjection();
			return;
		}

		this._parkProjection(target.found);
	}

	/**
	 * D5: a block-surface range, or a version whose write the engine confined,
	 * shows the substitute state instead of a native range. T3: projecting a
	 * 51-block range into one field would clamp it there. While the pointer
	 * window is open the user's native range stands, and the pointerup
	 * projection (`window-closed`) applies the substitute once.
	 */
	private _projectSubstitute(record: SelectionRecord): boolean {
		if (record.state?.type !== "text") {
			return false;
		}
		if (this._confinedVersion === record.version) {
			this._writeSubstitute();
			this._completeProjection();
			return true;
		}
		if (!this._isBlockSurfaceRange(record)) {
			return false;
		}
		if (
			this._trigger !== "window-closed" &&
			this._options.getGestureWindows().pointer
		) {
			this._pointerWithheldVersion = record.version;
			this._completeProjection();
			return true;
		}
		const released = this._pointerWithheldVersion !== null;
		this._pointerWithheldVersion = null;
		this._writeSubstitute();
		if (released) {
			this._options.onSubstituteChange?.();
		}
		this._completeProjection();
		return true;
	}

	/** D5: no native range in the root, and focus on the sink revealed as a text range. */
	private _writeSubstitute(): void {
		const root = this._options.getRootElement();
		if (root) {
			clearNativeRangeIn(root);
		}
		this._options.projectSubstituteFocus?.();
	}

	/**
	 * S2: a text record that arrives while no field is active (after a null
	 * selection put focus on the root) still names a caret the DOM must
	 * show. When this editor owns focus, activate the record's block the way
	 * a click would; otherwise the record waits for the next activation.
	 */
	private _activateForOwnedFocus(): boolean {
		const state = this._options.getRecord?.()?.state;
		const root = this._options.getRootElement();
		if (state?.type !== "text" || !root) {
			return false;
		}
		const active = root.ownerDocument.activeElement;
		if (!active || !root.contains(active)) {
			return false;
		}
		this._options.activate(state.focus.blockId);
		return this._options.isEditing();
	}

	/** A non-P1 authority trigger while composing is withheld (W3.R6). */
	private _withheldTrigger(): boolean {
		return (
			AUTHORITY_TRIGGERS.has(this._trigger) &&
			this._trigger !== "selection-change" &&
			this.withholdForComposition()
		);
	}

	/** Resolves the mounted target for the surface mode and writes into it. */
	private _projectIntoTarget(options: PenFieldEditorFocusOptions): {
		found: boolean;
		projected: boolean;
	} {
		const element = this._resolveTargetElement();
		if (!element) {
			return { found: false, projected: false };
		}
		return {
			found: true,
			projected: this._projectIntoElement(element, options),
		};
	}

	private _resolveTargetElement(): HTMLElement | null {
		if (this._options.getMode() === "expanded") {
			return this._options.findExpandedHost();
		}
		const focusBlockId = this._projectionTargetBlockId();
		if (!focusBlockId) {
			return null;
		}
		if (this._options.getFocusBlockId() !== focusBlockId) {
			this._options.activate(focusBlockId);
		}
		return this._options.resolveInlineElement(focusBlockId);
	}

	private _completeProjection(): void {
		this._parked = null;
		const recordVersion = this._options.getRecord?.()?.version;
		if (recordVersion != null) {
			this._lastProjectedVersion = recordVersion;
		}
		this._options.emitSelectionProjected();
		this._scheduleSelectionScroll();
	}

	setMountRequester(requester: ProjectionMountRequester | null): void {
		this._mountRequester = requester;
	}

	/**
	 * W3.R9: park on `(version, blockId)`. When the target is not mounted,
	 * ask the requester to mount it in this turn and check once, in the write
	 * phase of the next flush, that an ack resolved the park. A mounted target
	 * whose write was refused is not "unmounted" and is not reported.
	 */
	private _parkProjection(foundTarget: boolean): void {
		const version = this._options.getRecord?.()?.version ?? 0;
		const blockId = this._projectionTargetBlockId();
		this._parked = { version, blockId };
		if (foundTarget || blockId === null) {
			return;
		}
		const requester = this._mountRequester;
		requester?.requestMount(blockId, { version, align: null });
		this._scheduleUnmountedCheck(version, blockId, requester !== null);
	}

	private _scheduleUnmountedCheck(
		version: number,
		blockId: string,
		mountRequested: boolean,
	): void {
		const scheduler = this._options.getScheduler?.();
		if (!scheduler) {
			return;
		}
		void scheduler.write(() => {
			const parked = this._parked;
			if (parked?.version !== version || parked.blockId !== blockId) {
				return;
			}
			if (this._alreadyReported(`unmounted:${version}:${blockId}`)) {
				return;
			}
			this._options.emitDiagnostic?.({
				code: "selection-target-unmounted",
				level: "warn",
				source: "selection-projector",
				message:
					"selection target is not mounted after the flush that followed its park",
				version,
				blockId,
				mountRequested,
			});
		});
	}

	private _projectionTargetBlockId(): string | null {
		const state = this._options.getRecord?.()?.state;
		if (
			state?.type === "text" &&
			state.anchor.blockId === state.focus.blockId
		) {
			return state.focus.blockId;
		}
		return this._options.getFocusBlockId();
	}

	/**
	 * S2: a block, cell or null selection leaves no native range in the
	 * root, so its projection clears one. Withheld while a native control
	 * outside the field owns focus (HOST9).
	 */
	projectNonTextSelection(state: SelectionState | null): void {
		if (state !== null && state.type !== "block" && state.type !== "cell") {
			return;
		}
		if (this.isFocusHeldByNativeControlOutsideRoot()) {
			return;
		}
		const root = this._options.getRootElement();
		if (!root) {
			return;
		}
		// An edited cell's caret is a native range inside its table; any
		// other range a cell selection leaves in the root is stale.
		const keepInside =
			state?.type === "cell" ? queryBlockElement(root, state.blockId) : null;
		clearNativeRangeIn(root, keepInside);
	}

	/**
	 * P3: a reconcile rebuilt these blocks' DOM. When one of them is the
	 * mounted projection target, project the authority now, after the
	 * rebuild. Withheld while a native control that is not this field owns
	 * focus (HOST9).
	 */
	projectAfterRebuild(blockIds: readonly string[]): void {
		if (!this._options.isEditing()) {
			return;
		}
		if (!blockIds.some((blockId) => this._isProjectionTarget(blockId))) {
			return;
		}
		if (!this.shouldProjectSelectionAfterReconcile()) {
			return;
		}
		this.project("target-rebuilt");
	}

	private _isProjectionTarget(blockId: string): boolean {
		const mode = this._options.getMode();
		switch (mode) {
			case "single":
				return this._projectionTargetBlockId() === blockId;
			case "expanded": {
				const host = this._options.findExpandedHost();
				const inline = this._options.resolveInlineElement(blockId);
				return !!host && !!inline && host.contains(inline);
			}
			case "block":
			case "inactive":
				return false;
			default: {
				const unreachable: never = mode;
				return unreachable;
			}
		}
	}

	shouldProjectSelectionAfterReconcile(): boolean {
		const attachedElement = this._options.getAttachedElement();
		if (!attachedElement) {
			return false;
		}

		const ownerDocument = attachedElement.ownerDocument;
		const activeElement = ownerDocument?.activeElement;
		if (!(activeElement instanceof Node)) {
			return true;
		}
		if (activeElement === ownerDocument?.body) {
			return true;
		}

		const root = this._options.getRootElement();
		if (!root || !root.contains(activeElement)) {
			// do not steal from a native control outside this editor
			return !isNativeTextEntryTarget(activeElement);
		}

		return attachedElement.contains(activeElement);
	}

	/**
	 * HOST9: a native text control that is not this editor's field keeps
	 * its focus. That includes a host input outside the root and nested
	 * chrome inside it (a prompt textarea). Authority-driven projections
	 * (P1, P2, parked mount-ack) that land while one owns focus are not
	 * written, because writing the DOM selection into a field moves focus
	 * with it. Gesture and programmatic projections are not gated: a
	 * mousedown on the editor runs before the browser moves focus, and
	 * `focus()` moves it explicitly first.
	 */
	isFocusHeldByNativeControlOutsideRoot(): boolean {
		const root = this._options.getRootElement();
		const activeElement = root?.ownerDocument.activeElement;
		if (!root || !(activeElement instanceof Node)) {
			return false;
		}
		return isForeignNativeTextEntryTarget(activeElement);
	}

	private _projectIntoElement(
		element: HTMLElement,
		options: PenFieldEditorFocusOptions,
	): boolean {
		let didAttach = true;
		const attachedElement = this._options.getAttachedElement();
		if (attachedElement !== element || !attachedElement?.isConnected) {
			didAttach = this._options.attachElement(element, options);
		} else {
			const agreement = this._agreement(element);
			if (agreement === "all") {
				// W3.R6: the DOM and focus already show the record; no write.
				return true;
			}
			if (agreement === "dom") {
				// Only the backend's own state (an EditContext buffer) lags:
				// write that, not the native range the user may be dragging.
				this._options.writeBackendSelectionState?.();
				return true;
			}
		}
		if (
			didAttach &&
			this._options.requestDomFocus(
				element,
				"selection-project",
				{
					preventScroll: true,
				},
				options,
			)
		) {
			this._options.updateBackendSelection();
			this._checkReadBack(element);
			return true;
		}
		return false;
	}

	/**
	 * W3.R6: whether the attached target already shows the record — the DOM
	 * and focus (`"dom"`), and also the backend's own state (`"all"`).
	 */
	private _agreement(element: HTMLElement): "all" | "dom" | "none" {
		const readBack = this._options.readBack?.(element);
		if (
			readBack == null ||
			!readBack.equivalent ||
			!readBack.focusOnTarget
		) {
			return "none";
		}
		return (this._options.backendSelectionAgrees?.() ?? true)
			? "all"
			: "dom";
	}

	/**
	 * W3.R1: read the write back. A mismatch is reported once per
	 * (version, trigger) and never answered with a second write.
	 */
	private _checkReadBack(element: HTMLElement): void {
		const readBack = this._options.readBack?.(element);
		if (!readBack || (readBack.equivalent && readBack.focusOnTarget)) {
			return;
		}
		const record = this._options.getRecord?.() ?? null;
		if (record && isConfinedReadBack(record, readBack)) {
			// D5: the engine confined the multi-block write to one field.
			// Fall back to the substitute once; it is not a mismatch.
			this._confinedVersion = record.version;
			this._writeSubstitute();
			this._options.onSubstituteChange?.();
			return;
		}
		const version = record?.version ?? 0;
		this._lastMismatch = {
			version,
			actual: readBack.actual,
		};
		if (this._alreadyReported(`${version}:${this._trigger}`)) {
			return;
		}
		this._options.emitDiagnostic?.(
			this._mismatchDiagnostic(version, readBack),
		);
	}

	private _isReportedMismatch(read: ReaderSelection): boolean {
		const mismatch = this._lastMismatch;
		return (
			mismatch !== null &&
			mismatch.version === (this._options.getRecord?.()?.version ?? 0) &&
			sameTextRead(mismatch.actual, read)
		);
	}

	/** Remembers the last 64 (version, trigger) keys; true when this one was reported. */
	private _alreadyReported(key: string): boolean {
		if (this._reportedMismatches.has(key)) return true;
		this._reportedMismatches.add(key);
		if (this._reportedMismatches.size > 64) {
			const [oldest] = this._reportedMismatches;
			if (oldest !== undefined) this._reportedMismatches.delete(oldest);
		}
		return false;
	}

	private _mismatchDiagnostic(
		version: number,
		readBack: ProjectionReadBack,
	): DiagnosticEvent {
		return {
			code: "selection-projection-mismatch",
			level: "warn",
			source: "selection",
			message: readBack.equivalent
				? "selection projected, but focus is not on the projection target"
				: "the DOM selection after projection does not match the selection authority",
			version,
			trigger: this._trigger,
			expected: readBack.expected,
			actual: readBack.actual,
			focusOnTarget: readBack.focusOnTarget,
			surface: this._options.getSurface?.() ?? "text",
		};
	}
}

/** D5: the read-back of a multi-block text write is a range confined to one field. */
function isConfinedReadBack(
	record: SelectionRecord,
	readBack: ProjectionReadBack,
): boolean {
	const actual = readBack.actual;
	return (
		record.state?.type === "text" &&
		actual?.type === "text" &&
		isSingleFieldNativeLeftover(record.state, actual)
	);
}

type ReadPoint = { blockId: string; offset: number };

function samePoint(left: ReadPoint, right: ReadPoint): boolean {
	return left.blockId === right.blockId && left.offset === right.offset;
}

/**
 * Exact equality of two text reads (W3.R7 compares a divergent read with the
 * reported read-back, not logical equivalence). Other types never match, so
 * the guard only stops the text writes an engine normalizes.
 */
function sameTextRead(
	left: ReaderSelection | null,
	right: ReaderSelection | null,
): boolean {
	if (left?.type !== "text" || right?.type !== "text") {
		return false;
	}
	return (
		samePoint(left.anchor, right.anchor) &&
		samePoint(left.focus, right.focus)
	);
}
