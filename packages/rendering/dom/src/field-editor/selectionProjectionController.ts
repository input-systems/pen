import { isCollapsed, isMultiBlock } from "@input/pen-core";
import type {
	DiagnosticEvent,
	SelectionRecord,
	SelectionState,
} from "@input/pen-types";
import type { PenFieldEditorFocusOptions } from "./controller";
import type { HistorySelectionCoordinator } from "./historySelectionCoordinator";
import {
	CLOSED_GESTURE_WINDOWS,
	isAdmissibleDomRead,
	nextGestureWindowState,
	type GestureEventKind,
	type GestureWindowState,
	type ProjectionReadBack,
	type ReaderSelection,
} from "./selectionReader";
import { clearNativeRangeIn } from "./selectionProjector";
import {
	isForeignNativeTextEntryTarget,
	isNativeTextEntryTarget,
} from "../utils/textEntryTarget";

type ProjectionOptions = {
	syncBackendImmediately?: boolean;
} & PenFieldEditorFocusOptions;

type SelectionProjectionControllerOptions = {
	historySelectionCoordinator: HistorySelectionCoordinator;
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
};

/** What asked for a projection, for the mismatch payload and its once-per key. */
type ProjectionTrigger =
	| "selection-change"
	| "mount-ack"
	| "divergence"
	| "target-rebuilt"
	| "window-closed";

/** Authority-driven triggers (P1–P4); a composition withholds them. */
const AUTHORITY_TRIGGERS: ReadonlySet<ProjectionTrigger> = new Set([
	"selection-change",
	"mount-ack",
	"divergence",
	"target-rebuilt",
]);

export class SelectionProjectionController {
	private readonly _historySelectionCoordinator: HistorySelectionCoordinator;
	private readonly _options: SelectionProjectionControllerOptions;
	private _syncDomVersion = 0;
	private _gestureWindows: GestureWindowState = CLOSED_GESTURE_WINDOWS;
	private _pointerSettledBound = false;
	private _pendingSelectionProjectionVersion: number | null = null;
	private _lastProjectedVersion = 0;
	private _parked: { version: number; blockId: string | null } | null = null;
	private _parkedDiagnosticKey: string | null = null;
	private _trigger: ProjectionTrigger = "selection-change";
	private readonly _reportedMismatches = new Set<string>();
	/** A projection withheld while composing; released once on compositionend-completed. */
	private _withheldForComposition = false;
	/** W3.R7: the version and read-back of the last reported mismatch. */
	private _lastMismatch: {
		version: number;
		actual: ReaderSelection | null;
	} | null = null;

	constructor(options: SelectionProjectionControllerOptions) {
		this._historySelectionCoordinator = options.historySelectionCoordinator;
		this._options = options;
	}

	reset(): void {
		this._pendingSelectionProjectionVersion = null;
		this._withheldForComposition = false;
		this._gestureWindows = CLOSED_GESTURE_WINDOWS;
		this._pointerSettledBound = false;
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

	ackBlockMounted(_blockId: string, _element: HTMLElement): void {
		if (
			this._parked == null ||
			this.isFocusHeldByNativeControlOutsideRoot()
		) {
			return;
		}
		this._withTrigger("mount-ack", () => this.syncDomSelectionOnce());
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

	beginPointerSelection(): void {
		this.notifyGestureEvent("pointerdown");
	}

	endPointerSelection(): void {
		this.notifyGestureEvent("pointerup");
	}

	notifyGestureEvent(eventKind: GestureEventKind): void {
		if (eventKind === "pointerdown") {
			this.recordUserSelectionIntent();
			this._bindPointerSettled();
		}
		this._gestureWindows = nextGestureWindowState(
			eventKind,
			this._gestureWindows,
		);
		if (eventKind === "pointerup") {
			this._schedulePointerSettled();
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
		if (!this._gestureWindows.ime) {
			return false;
		}
		this._withheldForComposition = true;
		return true;
	}

	private _releaseCompositionWithholding(): void {
		if (!this._withheldForComposition || this._gestureWindows.ime) {
			return;
		}
		this._withheldForComposition = false;
		if (this.isFocusHeldByNativeControlOutsideRoot()) {
			return;
		}
		this._withTrigger("window-closed", () => this.syncDomSelectionOnce());
	}

	getGestureWindows(): GestureWindowState {
		return this._gestureWindows;
	}

	isAdmissibleGestureRead(): boolean {
		return isAdmissibleDomRead("selectionchange", this._gestureWindows);
	}

	isProjectionInFlight(): boolean {
		return this._pendingSelectionProjectionVersion !== null;
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
		this._withTrigger("divergence", () => this.syncDomSelectionOnce());
	}

	prepareSyncedTextSelection(
		currentSelection: SelectionState | null,
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): "skip" | "apply" {
		const isAlreadyCurrentSelection =
			currentSelection?.type === "text" &&
			!isMultiBlock(currentSelection) &&
			currentSelection.anchor.blockId === blockId &&
			currentSelection.focus.blockId === blockId &&
			currentSelection.anchor.offset === anchorOffset &&
			currentSelection.focus.offset === focusOffset;
		if (isAlreadyCurrentSelection) {
			return "skip";
		}
		this.recordUserSelectionIntent();
		return "apply";
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
		this._options.setTextSelection(blockId, anchorOffset, focusOffset);

		if (
			!this._options.isEditing() ||
			this._options.getFocusBlockId() !== blockId
		) {
			this._options.activate(blockId);
		}

		if (options?.syncBackendImmediately ?? true) {
			this._options.updateBackendSelection();
		}
		this.syncDomSelectionOnce(options);
	}

	syncDomSelectionOnce(options: PenFieldEditorFocusOptions = {}): void {
		if (
			AUTHORITY_TRIGGERS.has(this._trigger) &&
			this._trigger !== "selection-change" &&
			this.withholdForComposition()
		) {
			return;
		}
		const version = ++this._syncDomVersion;
		this._pendingSelectionProjectionVersion = version;

		if (!this._options.isEditing()) {
			this._cancelSelectionProjection(version);
			return;
		}

		let projected = false;
		let foundTarget = false;
		const pendingProjectionRequestId =
			this._historySelectionCoordinator.getPendingProjectionRequestId();

		if (this._options.getMode() === "block") {
			// T3: surface mode `block` skips contenteditable expansion.
			// projecting a 51-block text range into the focused field
			// clamps native to that field (empty-p1 0..length) and an
			// open pointer window accepts the leftover.
			this._parked = null;
			this._parkedDiagnosticKey = null;
			const recordVersion = this._options.getRecord?.()?.version;
			if (recordVersion != null) {
				this._lastProjectedVersion = recordVersion;
			}
			this._options.emitSelectionProjected();
			if (this._pendingSelectionProjectionVersion === version) {
				this._pendingSelectionProjectionVersion = null;
			}
			this._historySelectionCoordinator.completeDeferredProjection(
				pendingProjectionRequestId,
			);
			return;
		}

		if (this._options.getMode() === "expanded") {
			const expandedHost = this._options.findExpandedHost();
			if (expandedHost) {
				foundTarget = true;
				projected = this._projectIntoElement(expandedHost, options);
			}
		} else {
			const focusBlockId = this._projectionTargetBlockId();
			if (focusBlockId) {
				if (this._options.getFocusBlockId() !== focusBlockId) {
					this._options.activate(focusBlockId);
				}
				const inlineEl =
					this._options.resolveInlineElement(focusBlockId);
				if (inlineEl) {
					foundTarget = true;
					projected = this._projectIntoElement(inlineEl, options);
				}
			}
		}

		if (projected) {
			this._parked = null;
			this._parkedDiagnosticKey = null;
			const recordVersion = this._options.getRecord?.()?.version;
			if (recordVersion != null) {
				this._lastProjectedVersion = recordVersion;
			}
			this._options.emitSelectionProjected();
			if (this._pendingSelectionProjectionVersion === version) {
				this._pendingSelectionProjectionVersion = null;
			}
			this._historySelectionCoordinator.completeDeferredProjection(
				pendingProjectionRequestId,
			);
			return;
		}

		this._cancelSelectionProjection(version);
		this._parkProjection(foundTarget);
	}

	private _parkProjection(foundTarget: boolean): void {
		const recordVersion = this._options.getRecord?.()?.version ?? 0;
		const blockId = this._projectionTargetBlockId();
		this._parked = {
			version: recordVersion,
			blockId,
		};
		// a missing element is host virtualization, not an error.
		if (!foundTarget) {
			return;
		}
		const key = `${recordVersion}:${blockId ?? ""}`;
		if (this._parkedDiagnosticKey === key) {
			return;
		}
		this._parkedDiagnosticKey = key;
		this._options.emitDiagnostic?.({
			code: "selection-target-unmounted",
			level: "warn",
			source: "selection",
			message: "selection target is not mounted; projection parked",
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
	 * S2: a block or null selection leaves no native range in the root, so
	 * its projection clears one. Withheld while a native control outside the
	 * field owns focus (HOST9).
	 */
	projectNonTextSelection(state: SelectionState | null): void {
		if (state !== null && state.type !== "block") {
			return;
		}
		if (this.isFocusHeldByNativeControlOutsideRoot()) {
			return;
		}
		const root = this._options.getRootElement();
		if (root) {
			clearNativeRangeIn(root);
		}
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
		this._withTrigger("target-rebuilt", () => this.syncDomSelectionOnce());
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

	recordUserSelectionIntent(): void {
		const pendingProjectionVersion =
			this._pendingSelectionProjectionVersion;
		if (pendingProjectionVersion !== null) {
			this._syncDomVersion += 1;
			this._cancelSelectionProjection(pendingProjectionVersion);
		}
	}

	private _bindPointerSettled(): void {
		if (this._pointerSettledBound) {
			return;
		}
		const root = this._options.getRootElement();
		const doc = root?.ownerDocument ?? globalThis.document;
		if (typeof doc?.addEventListener !== "function") {
			return;
		}
		this._pointerSettledBound = true;
		const onUp = (): void => {
			doc.removeEventListener("pointerup", onUp);
			this._pointerSettledBound = false;
			this.notifyGestureEvent("pointerup");
		};
		doc.addEventListener("pointerup", onUp);
	}

	private _schedulePointerSettled(): void {
		queueMicrotask(() => {
			this._gestureWindows = nextGestureWindowState(
				"pointer-settled",
				this._gestureWindows,
			);
		});
	}

	private _projectIntoElement(
		element: HTMLElement,
		options: PenFieldEditorFocusOptions,
	): boolean {
		let didAttach = true;
		const attachedElement = this._options.getAttachedElement();
		if (attachedElement !== element || !attachedElement?.isConnected) {
			didAttach = this._options.attachElement(element, options);
		} else if (this._alreadyAgrees(element)) {
			// W3.R6: the DOM and focus already show the record; no write.
			return true;
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
	 * W3.R1: read the write back. A mismatch is reported once per
	 * (version, trigger) and never answered with a second write.
	 */
	private _alreadyAgrees(element: HTMLElement): boolean {
		const readBack = this._options.readBack?.(element);
		return (
			readBack != null &&
			readBack.equivalent &&
			readBack.focusOnTarget &&
			(this._options.backendSelectionAgrees?.() ?? true)
		);
	}

	private _checkReadBack(element: HTMLElement): void {
		const readBack = this._options.readBack?.(element);
		if (!readBack || (readBack.equivalent && readBack.focusOnTarget)) {
			return;
		}
		const version = this._options.getRecord?.()?.version ?? 0;
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

	private _cancelSelectionProjection(version: number): void {
		if (this._pendingSelectionProjectionVersion === version) {
			this._pendingSelectionProjectionVersion = null;
		}
		this._historySelectionCoordinator.cancelDeferredProjection();
	}
}

export type ProjectedDomOffsets = {
	readonly anchorOffset: number;
	readonly focusOffset: number;
};

export type RestoreDecisionSelection =
	| {
			readonly type: "text";
			readonly anchor: {
				readonly blockId: string;
				readonly offset: number;
			};
			readonly focus: {
				readonly blockId: string;
				readonly offset: number;
			};
	  }
	| {
			readonly type: "block";
			readonly blockIds: readonly string[];
	  };

/**
 * Contenteditable restore predicate. A 0..length range on the focused
 * block against a collapsed authority caret is an echo, not a select-all.
 * Moved from the CE backend; the boolean is unchanged.
 */
export function isFullBlockEchoAgainstCollapsedCaret(
	selection: RestoreDecisionSelection,
	currentSelection: SelectionState | null,
	getBlockLength: (blockId: string) => number | null,
): boolean {
	if (selection.type === "block") {
		return false;
	}
	if (selection.anchor.blockId !== selection.focus.blockId) {
		return false;
	}

	if (
		currentSelection?.type !== "text" ||
		!isCollapsed(currentSelection) ||
		currentSelection.focus.blockId !== selection.anchor.blockId
	) {
		return false;
	}

	const blockLength = getBlockLength(selection.anchor.blockId);
	if (blockLength == null) {
		return false;
	}

	const selectionStart = Math.min(
		selection.anchor.offset,
		selection.focus.offset,
	);
	const selectionEnd = Math.max(
		selection.anchor.offset,
		selection.focus.offset,
	);
	return selectionStart === 0 && selectionEnd === blockLength;
}

/**
 * Contenteditable restore predicate. A collapsed DOM caret that does not
 * match the programmatic/user-dom stamp is a stale projection, not a move.
 * Moved from the CE backend; the boolean is unchanged.
 */
export function isCollapsedDomAgainstProjectedOffsets(
	selection: RestoreDecisionSelection,
	getProjectedOffsets: (blockId: string) => ProjectedDomOffsets | null,
): boolean {
	if (
		selection.type === "block" ||
		selection.anchor.blockId !== selection.focus.blockId ||
		selection.anchor.offset !== selection.focus.offset
	) {
		return false;
	}
	const projectedSelection = getProjectedOffsets(selection.anchor.blockId);
	if (!projectedSelection) {
		return false;
	}
	return (
		selection.anchor.offset !== projectedSelection.anchorOffset ||
		selection.focus.offset !== projectedSelection.focusOffset
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
