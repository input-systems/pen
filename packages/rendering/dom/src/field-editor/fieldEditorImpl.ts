import type {
	BlockSchema,
	Editor,
	HistoryAppliedEvent,
	SelectionOrigin,
	SelectionRecord,
	SelectionRecordState,
	SelectionState,
	Unsubscribe,
} from "@input/pen-types";
import {
	DocumentRangeImpl,
	getEditorSelectionRecord,
	getOpOriginType,
	getSelectionBlockRange,
	hasFieldEditorSurface,
	isCollapsed,
	isMultiBlock,
	resolveFieldEditorInputMode,
} from "@input/pen-core";
import { EditContextBackend } from "./editContextBackend";
import { ContentEditableBackend } from "./contenteditableBackend";
import {
	BackendLifecycleController,
	type InputBackendConstructor,
} from "./backendLifecycleController";
import { CellEditingController } from "./cellEditingController";
import { ExpandedContentEditableBackend } from "./expandedContentEditableBackend";
import { FocusController } from "./focusController";
import { PendingMarkController } from "./pendingMarkController";
import { SessionReconciler } from "./sessionReconciler";
import {
	classifySelectionSurface,
	isBlockSurfaceTextRange,
} from "./crossBlock";
import type {
	ActiveCellCoord,
	FieldEditorFocusReason,
	FieldEditorInputController,
	FieldEditorSession,
	PenFieldEditorFocusOptions,
	PenFocusLifecycleListener,
	PenFocusPolicy,
} from "./controller";
import { getCellYText, getResolvedYText } from "./contentResolution";
import type { FieldEditorTextLike } from "./crdt";
import { queryBlockElement, queryInlineElement } from "./selectionBridge";
import { isSingleFieldNativeLeftover } from "./singleFieldNativeLeftover";
import { bindFocusSinkTransferEvents } from "./sinkTransferEvents";
import {
	SelectionProjector,
	type ProjectionMountRequester,
	type S2ExceptionKind,
} from "./selectionProjector";
import type { ProjectionCommit, ProjectionScroll } from "./projectionScroll";
import {
	createSelectionReader,
	decideDomSelectionRead,
	type DomSelectionReadDecision,
	type GestureSelectionOrigin,
	type ReaderSelection,
	readBackProjection,
	resolveEditedCellText,
	type SelectionReader,
} from "./selectionReader";
import type { FieldEditorStoreSnapshot } from "./store";
import {
	DEFAULT_SELECT_ALL_BEHAVIOR,
	type EditorSelectAllBehavior,
} from "../constants/selectAll";
import { bindEditorAnnouncer } from "../a11y/bindEditorAnnouncer";
import {
	createFocusSink,
	FOCUS_SINK_ATTR,
	type FocusSink,
} from "../a11y/focusSink";
import { syncFocusSink } from "../a11y/syncFocusSink";
import { getRootGeometry } from "../geometry/rootGeometry";
import { attachRootOverlay } from "../overlay/rootOverlay";
import type { DomScheduler } from "../scheduler";
import { createBlockNotifier } from "./blockNotifier";
import type { BlockNotifier } from "./blockNotifierTypes";
import {
	DATA_ATTRS,
	OVERLAY_ITEM_ATTR,
	OVERLAY_LAYER_ATTR,
} from "../utils/dataAttributes";
import { getPreorderBlockIds } from "../utils/documentPreorder";
import { arraysEqual } from "../utils/arraysEqual";
import { closestDomElement, isDomElement } from "../utils/domNodes";
import {
	forgetEditorRootElement,
	recordEditorRootElement,
} from "../utils/editorDocument";

type FieldEditorOptions = {
	selectAllBehavior?: EditorSelectAllBehavior;
	focusPolicy?: PenFocusPolicy;
};

/**
 * FE9: the origins a backend's own text input writes (`inputOrigin()`).
 * Every other authority write supersedes the backend's trusted input state.
 */
const TEXT_INPUT_ORIGINS: ReadonlySet<SelectionOrigin> = new Set([
	"keyboard",
	"ime",
]);

export class FieldEditorImpl implements FieldEditorSession {
	protected _focusBlockId: string | null = null;
	protected _activeBlockIds: string[] = [];
	protected _attachedElement: HTMLElement | null = null;
	protected _isEditing = false;
	protected _isFocused = false;
	protected _isComposing = false;
	protected _inputMode: "richtext" | "code" | "table" | "none" = "none";
	protected _mode: "inactive" | "single" | "expanded" | "block" = "inactive";
	protected _editor: Editor;
	protected _rootElement: HTMLElement | null = null;
	protected _activateListeners = new Set<(blockIds: string[]) => void>();
	protected _deactivateListeners = new Set<(blockIds: string[]) => void>();
	protected _storeListeners = new Set<() => void>();
	protected _unsubscribeSelection: Unsubscribe | null = null;
	protected _unsubscribeCommit: Unsubscribe | null = null;
	protected _unsubscribeHistoryApplied: Unsubscribe | null = null;
	protected _focusSink: FocusSink | null = null;
	protected _unsubscribeFocusSink: Unsubscribe | null = null;
	protected _overlay: ReturnType<typeof attachRootOverlay> | null = null;
	protected _isReadOnly = false;
	protected _unsubscribeAnnouncer: Unsubscribe | null = null;
	protected _unbindRootPointerGesture: (() => void) | null = null;
	protected _domSyncVersion = 0;
	protected readonly _sessionReconciler: SessionReconciler;
	protected readonly _backendLifecycle: BackendLifecycleController;
	protected readonly _focusController: FocusController;
	protected readonly _cellEditingController: CellEditingController;
	/** @internal Pending marks for the next insert; pen-dom's backends read it. */
	readonly pendingMarks: PendingMarkController;
	protected _selectAllBehavior: EditorSelectAllBehavior;
	/** @internal P: writes the authority into the DOM for this root. */
	readonly projector: SelectionProjector;
	/** @internal S1: the one `selectionchange` listener for this editor's root. */
	readonly reader: SelectionReader;
	/** The last commit seen, for projection scroll (W3.R15). */
	protected _lastCommit: ProjectionCommit | null = null;
	/** Per-block fan-out for renderers (SCALE6); one per field editor. */
	readonly blockNotifier: BlockNotifier;

	constructor(editor: Editor, options?: FieldEditorOptions) {
		this._editor = editor;
		this.blockNotifier = createBlockNotifier(editor, { fieldEditor: this });
		this._backendLifecycle = new BackendLifecycleController(
			this._editor,
			this as unknown as FieldEditorInputController,
		);
		this._selectAllBehavior =
			options?.selectAllBehavior ?? DEFAULT_SELECT_ALL_BEHAVIOR;
		this._focusController = new FocusController({
			editor: this._editor,
			getRootElement: () => this._findEditorRoot(),
			getFocusBlockId: () => this._focusBlockId,
			getAttachedElement: () => this._attachedElement,
		});
		this._focusController.setFocusPolicy(options?.focusPolicy);
		this._cellEditingController = new CellEditingController({
			getRootElement: () => this._findEditorRoot(),
			getYTextForCell: (blockId, row, col) =>
				getCellYText(this._editor, blockId, row, col),
			attachElement: (element) => this.attachElement(element),
			claimCaret: (cell) => this._claimCellCaret(cell),
			requestDomFocus: (target, reason, focusOptions, policyOptions) =>
				this.requestDomFocus(
					target,
					reason,
					focusOptions,
					policyOptions,
				),
		});
		this.pendingMarks = new PendingMarkController({
			editor: this._editor,
			getFocusBlockId: () => this._focusBlockId,
			getYText: (blockId) => this._getYText(blockId),
			emitStateChange: () => this._emitStateChange(),
		});
		this.reader = createSelectionReader({
			editor: this._editor,
			read: (proposal) => this.readDomSelection(proposal),
			onGesture: (kind) => this.projector.onGesture(kind),
		});
		this.projector = new SelectionProjector({
			isEditing: () => this._isEditing,
			getMode: () => this._mode,
			getFocusBlockId: () => this._focusBlockId,
			getAttachedElement: () => this._attachedElement,
			getRootElement: () => this._findEditorRoot(),
			findExpandedHost: () => this._findExpandedHost(),
			resolveInlineElement: (blockId) =>
				this._resolveInlineElement(blockId),
			attachElement: (element, focusOptions) =>
				this.attachElement(element, focusOptions),
			requestDomFocus: (target, reason, focusOptions, policyOptions) =>
				this.requestDomFocus(
					target,
					reason,
					focusOptions,
					policyOptions,
				),
			updateBackendSelection: () => {
				this._backendLifecycle.updateSelection();
			},
			setTextSelection: (blockId, anchorOffset, focusOffset, origin) =>
				this.setTextSelection(
					blockId,
					anchorOffset,
					focusOffset,
					origin,
				),
			activate: (blockId) => this.activate(blockId),
			emitSelectionProjected: () => {
				this._focusController.emitLifecycle({
					type: "selection-projected",
					editor: this._editor,
					blockId: this._focusBlockId,
				});
			},
			getRecord: () => getEditorSelectionRecord(this._editor),
			emitDiagnostic: (event) => {
				this._editor.internals.emit("diagnostic", event);
			},
			readBack: (target) => {
				const root = this._findEditorRoot();
				return root
					? readBackProjection(this._editor, root, target)
					: null;
			},
			getSurface: () =>
				this._cellEditingController.activeCellCoord
					? "cell"
					: this._mode === "expanded"
						? "expanded"
						: "text",
			getScheduler: () => this._ensureScheduler(),
			getLastCommit: () => this._lastCommit,
			backendSelectionAgrees: () =>
				this._backendLifecycle.current?.selectionAgreesWithAuthority?.() ??
				true,
			writeBackendSelectionState: () => {
				this._backendLifecycle.current?.writeSelectionState?.();
			},
			getGestureWindows: () => this.reader.windows,
			isBlockSurfaceRange: (record) =>
				isBlockSurfaceTextRange(this._editor, record.state),
			projectSubstituteFocus: () => this._projectFocusTarget(),
			onSubstituteChange: () => this._emitStateChange(),
		});
		this._subscribeEditor();
		this._sessionReconciler = new SessionReconciler(this._editor, {
			getSnapshot: () => this.getSnapshot(),
			getAttachedElement: () => this._attachedElement,
			getInlineElement: (blockId) => this._resolveInlineElement(blockId),
			getYText: (blockId) => this._getYText(blockId),
			projectAfterRebuild: (blockIds) =>
				this.projectAfterRebuild(blockIds),
			shouldProjectSelection: () =>
				this.projector.shouldProjectSelectionAfterReconcile(),
			// P3: the reconciler rebuilt the target, so the composing host
			// keeps its range until compositionend releases it (W3.R6).
			projectSelection: () => this.projector.project("target-rebuilt"),
			notifyDomReconciled: (blockId) => this.notifyDomReconciled(blockId),
			getScheduler: () => this._ensureScheduler(),
		});
	}

	/**
	 * Re-attaches the editor subscriptions `destroy()` released: the P1
	 * selection listener, the commit feed, the history listener, and the
	 * session reconciler. A binding whose mount can be undone and redone
	 * on one instance (React Strict Mode runs mount, cleanup, mount) calls
	 * this in its mount and `destroy()` in its cleanup (HB2). A no-op while
	 * connected.
	 */
	connect(): void {
		if (this._unsubscribeSelection) {
			return;
		}
		this._subscribeEditor();
		this._sessionReconciler.connect();
	}

	/** P1, the FE4 commit feed, and the history listener. */
	protected _subscribeEditor(): void {
		// FE4: the commit feed lives here rather than in a host's mount,
		// because both the vanilla mount and the framework bindings build a
		// field editor while only the vanilla one has a mount function. The
		// scheduler's next flush invalidates the cached rects of the named
		// blocks and of any block the edit reflowed; without the feed the
		// reader only clears on resize or font load, so a caret measured
		// after an edit reads a box from before it.
		this._unsubscribeCommit = this._editor.on("commit", (event) => {
			this._lastCommit = {
				commitId: event.commitId,
				originType: getOpOriginType(event.origin),
			};
			this._ensureScheduler()?.acceptCommit(event);
		});
		this._unsubscribeSelection = this._editor.onSelectionChange(
			(record) => {
				this.reader.notifyAuthorityWrite(record.origin);
				if (!TEXT_INPUT_ORIGINS.has(record.origin)) {
					this._backendLifecycle.current?.selectionSuperseded?.();
				}
				if (record.origin !== "mapped") {
					this._followEditedCell(record.state);
				}
				const selection = this._editor.selection;
				if (
					selection?.type !== "text" ||
					!isCollapsed(selection) ||
					isMultiBlock(selection)
				) {
					this.pendingMarks.clear(true);
				}
				const scheduler = this._ensureScheduler();
				const alreadyProjected =
					record.version <= this.projector.lastProjectedVersion;
				// HOST9: the record stays authoritative but is not
				// written into the DOM while focus is not this editor's
				// to take — a foreign control or another editor holds
				// it, or it is elsewhere and the origin does not take
				// it. the backend write is held back too — it projects
				// the DOM selection the same way.
				// C1/C2: the composing field keeps its range until
				// compositionend-completed releases the projection.
				const withheld =
					!alreadyProjected &&
					(this.projector.isFocusHeldElsewhere() ||
						this.projector.withholdForComposition());
				// surface first so P1 sees the new focus block. skip is
				// not delivery — the projector has not run yet.
				this._recomputeSurfaceFromSelection({
					syncSelectionToBackend: true,
					skipBackendWrite: true,
				});
				if (!alreadyProjected && !withheld) {
					this.projector.project("selection-change");
					scheduler?.setSelection(record);
				}
				this.projector.projectNonTextSelection(record.state);
				const delivered =
					record.version <= this.projector.lastProjectedVersion;
				this._recomputeSurfaceFromSelection({
					syncSelectionToBackend: true,
					skipBackendWrite: delivered || withheld,
				});
				this._overlay?.notifySelectionChange(record);
			},
		);
		this._unsubscribeHistoryApplied = this._editor.onHistoryApplied(
			(event) => {
				this._handleHistoryApplied(event);
			},
		);
	}

	get focusBlockId(): string | null {
		return this._focusBlockId;
	}
	get activeBlockIds(): readonly string[] {
		return this._activeBlockIds;
	}
	get isEditing(): boolean {
		return this._isEditing;
	}
	get isFocused(): boolean {
		return this._isFocused;
	}
	get isComposing(): boolean {
		return this._isComposing;
	}
	/** The renderer `readonly` prop, as last set by `setReadOnly`. */
	get isReadOnly(): boolean {
		return this._isReadOnly;
	}
	get inputMode(): "richtext" | "code" | "table" | "none" {
		return this._inputMode;
	}
	get selection(): SelectionState | null {
		return this._isEditing ? this._editor.selection : null;
	}
	set selection(sel: SelectionState | null) {
		this._editor.setSelection(sel);
		this._emitStateChange();
	}
	get activeCellCoord(): ActiveCellCoord | null {
		return this._cellEditingController.activeCellCoord;
	}

	get selectAllBehavior(): EditorSelectAllBehavior {
		return this._selectAllBehavior;
	}

	setSelectAllBehavior(behavior: EditorSelectAllBehavior): void {
		this._selectAllBehavior = behavior;
	}

	setFocusPolicy(focusPolicy: PenFocusPolicy | undefined): void {
		this._focusController.setFocusPolicy(focusPolicy);
	}

	protected _ensureScheduler(): DomScheduler | null {
		const root = this._findEditorRoot();
		if (!root) {
			return null;
		}
		return getRootGeometry(root).scheduler;
	}

	activate(blockId: string): void {
		if (this._focusBlockId === blockId) return;
		this._startSession(blockId, {
			stopCapturing: true,
			syncSelectionToBackend: true,
			attachImmediately: true,
		});
	}

	activateCell(blockId: string, row: number, col: number): void {
		this._activateCell(blockId, row, col);
		this._attachedElement = null;
		this._cellEditingController.trySyncBackend();
	}

	activateCellFromElement(
		blockId: string,
		row: number,
		col: number,
		element: HTMLElement,
	): void {
		this._activateCell(blockId, row, col);
		this.attachElement(element);
		this._cellEditingController.placeCaretInCell(element);
	}

	/**
	 * FE6: a written `CellSelection.text` is cell editing, so a record that
	 * names a cell other than the active one moves the field editor there.
	 */
	protected _followEditedCell(state: SelectionRecordState): void {
		if (state?.type !== "cell" || !state.text) {
			return;
		}
		const active = this._cellEditingController.activeCellCoord;
		if (
			active?.blockId === state.blockId &&
			active.row === state.head.row &&
			active.col === state.head.col
		) {
			return;
		}
		this.activateCell(state.blockId, state.head.row, state.head.col);
	}

	protected _activateCell(blockId: string, row: number, col: number): void {
		this._cellEditingController.setActiveCell(blockId, row, col);
		if (!this._isEditing || this._focusBlockId !== blockId) {
			this._startSession(blockId, {
				stopCapturing: true,
				syncSelectionToBackend: false,
				attachImmediately: false,
			});
		}
		this._inputMode = "table";
		this._emitStateChange();
	}

	deactivate(): void {
		this._deactivate({ restoreFocus: true });
	}

	suspendForPointerSelection(): void {
		if (this._isComposing) return;
		this._deactivate({ restoreFocus: false });
	}

	setComposing(composing: boolean): void {
		if (this._isComposing === composing) return;
		this._isComposing = composing;
		this._emitStateChange();
	}

	protected _deactivate(options: { restoreFocus: boolean }): void {
		if (!this._isEditing) return;

		const blockIds = [...this._activeBlockIds];
		this._backendLifecycle.deactivate();
		this._attachedElement = null;
		this._cellEditingController.clear();

		this._focusBlockId = null;
		this._activeBlockIds = [];
		this._isEditing = false;
		this._isComposing = false;
		this.projector.reset();
		// C1: the composition this field owned ends with it. Every other
		// window is root-level reader state and outlives the session (R1–R3):
		// a press in another block deactivates this field in the gesture
		// that opened the window.
		if (this.reader.windows.ime) {
			this.reader.notifyGesture("compositionend-completed");
		}
		this._inputMode = "none";
		this._mode = "inactive";
		this.pendingMarks.reset();

		for (const cb of this._deactivateListeners) cb(blockIds);
		this._focusController.emitLifecycle({
			type: "activation-changed",
			editor: this._editor,
			activeBlockIds: [],
			isEditing: false,
		});
		if (options.restoreFocus) {
			// Deactivation focuses nothing itself, and never a block element:
			// the record's projection picks the target (P), so a block or
			// cell selection lands on the sink.
			this._projectFocusTarget();
		}
		this._emitStateChange();
	}

	focus(options: PenFieldEditorFocusOptions = {}): boolean {
		if (!this._isEditing || !this._focusBlockId) return false;
		const root = this._findEditorRoot();

		if (!root) return false;

		const blockEl = queryBlockElement(root, this._focusBlockId);
		const inlineEl = blockEl?.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		if (!inlineEl) return false;

		const selection = this._editor.selection;
		if (
			!this.requestDomFocus(
				inlineEl,
				"activate",
				{
					preventScroll: false,
				},
				options,
			)
		) {
			return false;
		}

		if (
			selection?.type === "text" &&
			selection.anchor.blockId === this._focusBlockId &&
			selection.focus.blockId === this._focusBlockId
		) {
			this._backendLifecycle.updateSelection();
			return true;
		}

		// S1: the caret lands in the authority first and is projected from it.
		const end = this._editor.getBlock(this._focusBlockId)?.length() ?? 0;
		this.commitProgrammaticTextSelection(
			this._focusBlockId,
			end,
			end,
			options,
		);
		return true;
	}

	blur(): void {
		this._focusController.blur();
	}

	requestDomFocus(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options?: FocusOptions,
		policyOptions: PenFieldEditorFocusOptions = {},
	): boolean {
		return this._focusController.requestDomFocus(
			target,
			reason,
			options,
			policyOptions,
		);
	}

	requestRootFocus(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options?: FocusOptions,
	): boolean {
		return this._focusController.requestRootFocus(target, reason, options);
	}

	/**
	 * The renderer `readonly` prop (O5). Not the `pen.ariaReadOnly` facet
	 * (AX1): the overlay reads this to draw no caret in a read-only field.
	 */
	setReadOnly(readonly: boolean): void {
		if (this._isReadOnly === readonly) return;
		this._isReadOnly = readonly;
		this._emitStateChange();
	}

	/** D5: the projector's substitute state, for the overlay and root focus (S2). */
	getSubstituteState(): S2ExceptionKind | null {
		return this.projector.getSubstituteState();
	}

	setRootElement(element: HTMLElement | null): void {
		this._unbindRoot();
		if (this._rootElement) {
			forgetEditorRootElement(this._editor, this._rootElement);
		}
		this._rootElement = element;
		if (element) {
			recordEditorRootElement(this._editor, element);
			this.reader.attach(element);
			this._bindFocusSink(element);
			this._unsubscribeAnnouncer = bindEditorAnnouncer(
				this._editor,
				element,
			);
			// OV2: the overlay layer is appended after the sink and the
			// announcer's live region, so it is the root's last child.
			this._overlay = attachRootOverlay({
				root: element,
				editor: this._editor,
				fieldEditor: this,
			});
			this._bindRootPointerGesture(element);
			this._focusController.notifyRootAttached(element);
		} else {
			this.reader.detach();
		}
		if (element && this._isEditing) {
			this._syncActiveElement(false);
		}
		this._sessionReconciler.notifyFrameAvailable();
	}

	protected _bindFocusSink(root: HTMLElement): void {
		const sink = createFocusSink(root.ownerDocument);
		root.appendChild(sink.element);
		this._focusSink = sink;
		const unsubscribeSelection = this._editor.onSelectionChange(() => {
			this._projectFocusTarget();
		});
		const unbindTransfer = bindFocusSinkTransferEvents(
			sink.element,
			this._editor,
			this,
		);
		this._unsubscribeFocusSink = () => {
			unsubscribeSelection();
			unbindTransfer();
		};
		this._projectFocusTarget();
	}

	/**
	 * P focus targets for the record: the sink for block and cell
	 * selections and for a D5 text range, the root for app and `null` (D18).
	 * The focus controller writes; nothing else in pen-dom calls `focus()`
	 * (W3.R16).
	 */
	protected _projectFocusTarget(): void {
		const sink = this._focusSink;
		if (!sink) {
			return;
		}
		syncFocusSink(sink, this._editor, this._editor.selection, {
			requestFocus: (target) => {
				this._focusController.requestDomFocus(
					target,
					"selection-project",
					{
						preventScroll: true,
					},
				);
			},
			substitute: this.projector.getSubstituteState(),
		});
	}

	/** Releases what `setRootElement` bound to the root, except the reader. */
	protected _unbindRoot(): void {
		this._overlay?.detach();
		this._overlay = null;
		this._unsubscribeFocusSink?.();
		this._unsubscribeFocusSink = null;
		this._focusSink?.dispose();
		this._focusSink = null;
		this._unsubscribeAnnouncer?.();
		this._unsubscribeAnnouncer = null;
		this._unbindRootPointerGesture?.();
		this._unbindRootPointerGesture = null;
	}

	protected _bindRootPointerGesture(root: HTMLElement): void {
		// R1 native-range: whether the root's latest pointerdown was coarse.
		let coarsePointer = false;
		const onPointerDown = (event: PointerEvent): void => {
			coarsePointer = isCoarsePointerType(event.pointerType);
			if (!isInEditorContentPointerTarget(root, event.target)) {
				return;
			}
			this.reader.notifyGesture("pointerdown");
		};
		// Engines surface a touch long-press as selectstart or contextmenu.
		const notifyTouchSelectStart = (event: Event): void => {
			if (
				coarsePointer &&
				isInEditorContentPointerTarget(root, eventTargetElement(event))
			) {
				this.reader.notifyGesture("touch-selectstart");
			}
		};
		// R1: the context-menu window opens from the root, attached field or not.
		const onContextMenu = (event: Event): void => {
			this.reader.notifyGesture("contextmenu");
			notifyTouchSelectStart(event);
		};
		root.addEventListener("pointerdown", onPointerDown, true);
		root.addEventListener("contextmenu", onContextMenu);
		root.addEventListener("selectstart", notifyTouchSelectStart);
		this._unbindRootPointerGesture = () => {
			root.removeEventListener("pointerdown", onPointerDown, true);
			root.removeEventListener("contextmenu", onContextMenu);
			root.removeEventListener("selectstart", notifyTouchSelectStart);
		};
	}

	setFocused(focused: boolean): void {
		if (this._isFocused === focused) return;
		this._isFocused = focused;
		this._emitStateChange();
	}

	protected _findEditorRoot(): HTMLElement | null {
		if (!this._rootElement?.isConnected) return null;
		return this._rootElement;
	}

	protected _findExpandedHost(): HTMLElement | null {
		const root = this._findEditorRoot();
		if (!root) return null;
		return root.querySelector(
			`[${DATA_ATTRS.editorBlocksHost}]`,
		) as HTMLElement | null;
	}

	attachElement(
		element: HTMLElement,
		options: PenFieldEditorFocusOptions = {},
	): boolean {
		if (this._mode === "block") {
			// T3: surface mode `block` skips contenteditable. React still
			// calls attachElement on the focused field when leaving
			// expanded; remounting clamps native to that field and the
			// open pointer window accepts the leftover.
			return false;
		}
		if (!this._focusBlockId) return false;
		const hostedBlockId = element
			.closest(`[${DATA_ATTRS.blockId}]`)
			?.getAttribute(DATA_ATTRS.blockId);
		if (hostedBlockId && hostedBlockId !== this._focusBlockId) {
			this.activate(hostedBlockId);
			return (
				this._focusBlockId === hostedBlockId &&
				this._attachedElement === element &&
				this._backendLifecycle.current != null
			);
		}
		if (this._attachedElement === element && this._backendLifecycle.current)
			return true;
		if (
			!this._focusController.requestActivation(
				element,
				"backend-attach",
				options,
			)
		)
			return false;
		this._focusController.emitLifecycle({
			type: "backend-attach-started",
			editor: this._editor,
			target: element,
			blockId: this._focusBlockId,
		});
		this._backendLifecycle.replace(this._resolveBackendClass());

		const ytext = this._getYText(this._focusBlockId);
		if (!ytext) return false;

		// A passive or `domFocus: false` attach reaches the backend's own
		// focus request, which the focus controller then leaves unfocused.
		this._backendLifecycle.activate(element, ytext, options);
		this._attachedElement = element;
		this._focusController.emitLifecycle({
			type: "backend-attach-completed",
			editor: this._editor,
			target: element,
			blockId: this._focusBlockId,
		});
		return true;
	}

	/** The origin of a text-input caret write (S3): `ime` while composing. */
	inputOrigin(): "keyboard" | "ime" {
		return this.reader.windows.ime ? "ime" : "keyboard";
	}

	syncTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		origin: SelectionOrigin = this.inputOrigin(),
	): void {
		if (!this._isEditing) return;
		if (this._focusBlockId !== blockId) return;

		const current = this._editor.selection;
		if (
			current?.type === "text" &&
			current.anchor.blockId === blockId &&
			current.focus.blockId === blockId &&
			current.anchor.offset === anchorOffset &&
			current.focus.offset === focusOffset
		) {
			return;
		}
		this.setTextSelection(blockId, anchorOffset, focusOffset, origin);
	}

	applyDocumentTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
		origin: SelectionOrigin,
	): void {
		if (!this._isEditing || !this._focusBlockId) {
			this._startSession(anchor.blockId, {
				stopCapturing: false,
				syncSelectionToBackend: false,
				attachImmediately: false,
			});
		} else {
			const blockRange = new DocumentRangeImpl(
				anchor,
				focus,
				this._editor.internals.doc,
			).blockRange;
			if (!blockRange.includes(this._focusBlockId)) {
				this._focusBlockId = anchor.blockId;
			}
		}

		this._editor.selectTextRange(anchor, focus, { origin });
		this._emitStateChange();
	}

	applyDomTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
		origin: SelectionOrigin,
	): void {
		if (anchor.blockId !== focus.blockId) {
			this.applyDocumentTextSelection(anchor, focus, origin);
			return;
		}

		if (!this._isEditing || this._focusBlockId !== anchor.blockId) {
			this._startSession(anchor.blockId, {
				stopCapturing: false,
				syncSelectionToBackend: false,
				attachImmediately: false,
			});
		}
		this.setTextSelection(
			anchor.blockId,
			anchor.offset,
			focus.offset,
			origin,
		);
	}

	/**
	 * Runs the reader on the live selection now (W3.R5), before an input
	 * reads the authority. With every gesture window closed a read cannot
	 * change the authority (R step 4), and the queued `selectionchange`
	 * already answers divergence, so only an open window needs the sync.
	 */
	syncDomSelectionRead(): void {
		if (!this.reader.isAdmissibleRead()) {
			return;
		}
		this.reader.sync();
	}

	/**
	 * P3: a host renderer rebuilt these blocks' DOM; project the authority
	 * now when one of them is the mounted projection target.
	 */
	projectAfterRebuild(blockIds: readonly string[]): void {
		this.projector.projectAfterRebuild(blockIds);
	}

	readDomSelection(proposal: ReaderSelection): DomSelectionReadDecision {
		const decided = decideDomSelectionRead({
			editor: this._editor,
			proposal,
			gestureWindows: this.reader.windows,
		});
		const isLeftoverField =
			proposal?.type === "text" &&
			isSingleFieldNativeLeftover(this._editor.selection, proposal);
		if (decided.decision === "diverge") {
			// document select-all leftover is closed-window (I4) so it
			// must not write; P2 must not run either, because projecting
			// the multi-block range makes the engine confine it again.
			if (!isLeftoverField) {
				this.projector.requestDivergenceProjection(proposal);
			}
			return decided.decision;
		}
		if (decided.decision !== "accept" || decided.normalized === null) {
			return decided.decision;
		}
		if (this._isComposing && this._mode === "expanded") {
			// C1, FE2: the expanded host composes at its range start in text
			// the record does not hold; that caret is not a selection. The
			// range stays the record, and the divergence projection is
			// withheld until compositionend-completed releases it.
			this.projector.requestDivergenceProjection(proposal);
			return "diverge";
		}
		if (isLeftoverField) {
			// Same leftover with the window open: a drag onto a block
			// with no text position reports the nearest text end, and
			// accepting it would drop the structural cover. Re-project
			// so the DOM follows the authority instead. A click is
			// collapsed, so it still accepts.
			this.projector.requestDivergenceProjection(proposal);
			return "diverge";
		}
		this._applyAcceptedDomSelection(decided.normalized, decided.origin);
		return decided.decision;
	}

	private _applyAcceptedDomSelection(
		normalized: Exclude<ReaderSelection, null>,
		origin: GestureSelectionOrigin,
	): void {
		switch (normalized.type) {
			case "text": {
				if (
					normalized.anchor.blockId === normalized.focus.blockId &&
					(!this._isEditing ||
						this._focusBlockId !== normalized.anchor.blockId)
				) {
					// A pointer that moves the session to another block is a
					// new edit location, as `activate()` treats it.
					this._startSession(normalized.anchor.blockId, {
						stopCapturing: origin === "pointer",
						syncSelectionToBackend: false,
						attachImmediately: false,
					});
				} else if (
					normalized.anchor.blockId !== normalized.focus.blockId &&
					(!this._isEditing || !this._focusBlockId)
				) {
					this._startSession(normalized.anchor.blockId, {
						stopCapturing: false,
						syncSelectionToBackend: false,
						attachImmediately: false,
					});
				}
				this._editor.setSelection(
					{
						type: "text",
						anchor: normalized.anchor,
						focus: normalized.focus,
					} as SelectionState,
					{ origin },
				);
				this._emitStateChange();
				return;
			}
			case "block": {
				if (this._isEditing) {
					this.deactivate();
				}
				this._editor.setSelection(
					{
						type: "block",
						blockIds: [...normalized.blockIds],
						head: normalized.head,
					},
					{ origin },
				);
				this._emitStateChange();
				return;
			}
			case "app": {
				this._editor.setSelection(
					{ type: "app", appId: normalized.appId },
					{ origin },
				);
				this._emitStateChange();
				return;
			}
			case "cell": {
				this._editor.setSelection(
					{
						type: "cell",
						blockId: normalized.blockId,
						anchor: normalized.anchor,
						head: normalized.head,
						...(normalized.text ? { text: normalized.text } : {}),
					},
					{ origin },
				);
				this._emitStateChange();
				return;
			}
			default: {
				const _exhaustive: never = normalized;
				return _exhaustive;
			}
		}
	}

	setTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		origin: SelectionOrigin = "programmatic",
	): void {
		if (anchorOffset !== focusOffset) {
			this.pendingMarks.clear(true);
		}
		this._editor.selectText(blockId, anchorOffset, focusOffset, { origin });
		this._emitStateChange();
	}

	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: PenFieldEditorFocusOptions,
	): void {
		this.projector.activateTextSelection(
			blockId,
			anchorOffset,
			focusOffset,
			options,
		);
	}

	/**
	 * Writes the selection, then focuses in the same turn (S4: no deferral
	 * between the write and the focus). The promise is the public contract;
	 * it is already settled when returned.
	 */
	focusTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options: PenFieldEditorFocusOptions = {},
	): Promise<boolean> {
		this.commitProgrammaticTextSelection(
			blockId,
			anchorOffset,
			focusOffset,
			options,
		);
		if (!this._focusController.isAttached(blockId)) {
			return Promise.resolve(false);
		}
		if (options.domFocus === false || options.passive) {
			return Promise.resolve(true);
		}
		// One commit: `focus()` finds the record already in this block and
		// writes it into the backend rather than committing it again.
		return Promise.resolve(this.focus(options));
	}

	focusSelection(): void {
		this.projector.project("activation");
	}

	commitProgrammaticTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: PenFieldEditorFocusOptions,
	): void {
		this.projector.commitProgrammaticTextSelection(
			blockId,
			anchorOffset,
			focusOffset,
			options,
		);
	}

	syncCellTextSelection(
		cell: ActiveCellCoord,
		anchorOffset: number,
		focusOffset: number,
		origin: SelectionOrigin = this.inputOrigin(),
	): void {
		this._editor.setSelection(
			{
				type: "cell",
				blockId: cell.blockId,
				anchor: { row: cell.row, col: cell.col },
				head: { row: cell.row, col: cell.col },
				text: { anchor: anchorOffset, focus: focusOffset },
			},
			{ origin },
		);
	}

	/**
	 * A cell that gains focus shows the record's caret in it (W3.R18): the
	 * record's `CellSelection.text` when it already names this cell, else a
	 * caret at the end of the cell's text. The projector writes it.
	 */
	protected _claimCellCaret(cell: ActiveCellCoord): void {
		if (resolveEditedCellText(this._editor.selection, cell.blockId, cell)) {
			this.projector.project("activation");
			return;
		}
		const ytext = getCellYText(
			this._editor,
			cell.blockId,
			cell.row,
			cell.col,
		);
		const length = ytext?.length ?? 0;
		this.syncCellTextSelection(cell, length, length, "programmatic");
	}

	collapseSelectionToFocus(origin: SelectionOrigin = "programmatic"): void {
		const selection = this._editor.selection;
		if (selection?.type !== "text") return;

		this._collapseAndProject(selection.focus, origin);
	}

	collapseSelectionToAnchor(origin: SelectionOrigin = "programmatic"): void {
		const selection = this._editor.selection;
		if (selection?.type !== "text") return;

		this._collapseAndProject(selection.anchor, origin);
	}

	collapseSelectionToPoint(
		point: { blockId: string; offset: number },
		origin: SelectionOrigin = "programmatic",
	): void {
		this._collapseAndProject(point, origin);
	}

	protected _collapseAndProject(
		point: {
			blockId: string;
			offset: number;
		},
		origin: SelectionOrigin,
	): void {
		this.setTextSelection(
			point.blockId,
			point.offset,
			point.offset,
			origin,
		);

		if (!this._isEditing || this._focusBlockId !== point.blockId) {
			this.activate(point.blockId);
		}

		this.projector.project("activation");
	}

	delegate(blockSchema: BlockSchema): boolean {
		return hasFieldEditorSurface(blockSchema);
	}

	getPendingMarks(): Readonly<Record<string, unknown | null>> {
		return this.pendingMarks.getSnapshot();
	}

	clearPendingMarks(): void {
		this.pendingMarks.clear();
	}

	togglePendingMark(markType: string): boolean {
		return this.pendingMarks.toggle(
			markType,
			this._isEditing,
			this._inputMode,
		);
	}

	// ── Cross-block expansion ────────────────────────────────

	expandTo(blockId: string): void {
		if (!this._isEditing || !this._focusBlockId) return;

		const selection = this._editor.selection;
		const anchor =
			selection?.type === "text" &&
			getSelectionBlockRange(
				this._editor.documentState,
				selection,
			).includes(this._focusBlockId)
				? selection.anchor
				: { blockId: this._focusBlockId, offset: 0 };
		const order = getPreorderBlockIds(this._editor);
		const activeIdx = order.indexOf(this._focusBlockId);
		const targetIdx = order.indexOf(blockId);
		if (activeIdx < 0 || targetIdx < 0) return;

		const targetOffset =
			targetIdx >= activeIdx
				? (this._editor.getBlock(blockId)?.length() ?? 0)
				: 0;

		this._editor.selectTextRange(anchor, {
			blockId,
			offset: targetOffset,
		});
	}

	contractToFocused(): void {
		if (!this._isEditing || !this._focusBlockId) return;

		const selection = this._editor.selection;
		if (selection?.type !== "text") return;

		this._editor.selectTextRange(selection.focus, selection.focus);
	}

	// ── Events ───────────────────────────────────────────────

	onActivate(cb: (blockIds: string[]) => void): Unsubscribe {
		this._activateListeners.add(cb);
		return () => this._activateListeners.delete(cb);
	}

	onDeactivate(cb: (blockIds: string[]) => void): Unsubscribe {
		this._deactivateListeners.add(cb);
		return () => this._deactivateListeners.delete(cb);
	}

	onFocusLifecycle(listener: PenFocusLifecycleListener): Unsubscribe {
		return this._focusController.onFocusLifecycle(listener);
	}

	onSelectionChange(cb: (record: SelectionRecord) => void): Unsubscribe {
		return this._editor.onSelectionChange(cb);
	}

	getSnapshot(): FieldEditorStoreSnapshot {
		return {
			focusBlockId: this._focusBlockId,
			activeBlockIds: this._activeBlockIds,
			isEditing: this._isEditing,
			isFocused: this._isFocused,
			isComposing: this._isComposing,
			domSyncVersion: this._domSyncVersion,
			inputMode: this._inputMode,
			mode: this._mode,
			activeCellCoord: this._cellEditingController.activeCellCoord,
		};
	}

	notifyDomReconciled(blockId?: string): void {
		// The global version stays for host code; renderers read the block's own.
		this._domSyncVersion += 1;
		this.blockNotifier.markDomSynced(blockId ?? null);
		this._emitStateChange();
	}

	subscribe(callback: () => void): Unsubscribe {
		this._storeListeners.add(callback);
		return () => this._storeListeners.delete(callback);
	}

	waitForAttachment(blockId = this._focusBlockId): Promise<boolean> {
		return this._focusController.waitForAttachment(blockId);
	}

	/**
	 * W3.R9: the host's mount requester, asked to mount a block the projector
	 * parked on. Its ack must arrive within the same task (W4 implements it
	 * over `BlockWindow.reveal`); null removes it.
	 */
	setMountRequester(requester: ProjectionMountRequester | null): void {
		this.projector.setMountRequester(requester);
	}

	/**
	 * W3.R15: brings a block, or the current selection, into view in the
	 * next scheduler flush (measure in the read phase, scroll in the write
	 * phase). Serves `editor.scrollToBlock` when no BlockWindow is attached.
	 */
	scrollIntoView(
		target: { readonly blockId: string } | "selection",
		scroll: Exclude<ProjectionScroll, "none"> = "auto",
	): void {
		this.projector.scrollIntoView(target, scroll);
	}

	/**
	 * P4: a host moved a mounted block element (a regroup into another AX1
	 * list group wrapper) and the move dropped the focus `focusTarget` held,
	 * as any DOM move of a focused node does. That focus was this editor's,
	 * so it is restored rather than taken (HOST9), and the record projects
	 * back into the field in the same turn: the native range left with it.
	 */
	ackBlockMoved(focusTarget: HTMLElement): void {
		if (
			!focusTarget.isConnected ||
			focusTarget.ownerDocument.activeElement === focusTarget
		) {
			return;
		}
		if (
			!this._focusController.requestDomFocus(focusTarget, "restore", {
				preventScroll: true,
			})
		) {
			return;
		}
		this.projector.project("mount-ack");
	}

	ackBlockMounted(blockId: string, element: HTMLElement): void {
		this.projector.ackBlockMounted(blockId, element);
		// A newly mounted block may resolve a request that was unresolved.
		this._overlay?.notifyInputsChanged();
		if (this._cellEditingController.activeCellCoord?.blockId === blockId) {
			this._cellEditingController.trySyncBackend();
		}
	}

	destroy(): void {
		this.reader.detach();
		this._unbindRoot();
		// Nothing projects into, or activates for, a root this instance has
		// let go; a re-install binds it again through setRootElement.
		if (this._rootElement) {
			forgetEditorRootElement(this._editor, this._rootElement);
		}
		this._rootElement = null;
		this._unsubscribeSelection?.();
		this._unsubscribeSelection = null;
		this._unsubscribeCommit?.();
		this._unsubscribeCommit = null;
		this._unsubscribeHistoryApplied?.();
		this._unsubscribeHistoryApplied = null;
		this._sessionReconciler.destroy();
		this._deactivate({ restoreFocus: false });
		this._activateListeners.clear();
		this._deactivateListeners.clear();
		this._storeListeners.clear();
		this._focusController.destroy();
		// A later subscribe re-attaches: React Strict Mode re-installs this instance.
		this.blockNotifier.destroy();
	}

	// ── Internal ─────────────────────────────────────────────

	/**
	 * HOST4 backend split (`spec/rules/host.md`, `FIELD-EDITOR-BACKENDS.md`).
	 * EditContext is above the HOST3 floor: detect the constructor, with
	 * contenteditable as the real fallback. Expanded (multi-block) surfaces
	 * and table-cell editing always use contenteditable, even when
	 * EditContext exists.
	 *
	 * Degradation when EditContext is absent: IME uses the composition-event
	 * path instead of EditContext `textupdate`, resolving a commit from the
	 * event sequence — live DOM against the recorded start text, then the
	 * following mutation or the next `compositionstart` for Safari's late
	 * `compositionend`. Composition underline and IME window bounds follow the
	 * native contenteditable caret rather than `textformatupdate` /
	 * `characterboundsupdate`. The field stays editable — typing, paste, and
	 * undo still apply.
	 */
	protected _resolveBackendClass(): InputBackendConstructor {
		if (this._mode === "expanded") {
			return ExpandedContentEditableBackend;
		}
		if (this._cellEditingController.activeCellCoord) {
			return ContentEditableBackend;
		}
		if (
			"EditContext" in globalThis &&
			typeof (globalThis as typeof globalThis & { EditContext?: unknown })
				.EditContext === "function"
		) {
			return EditContextBackend;
		}
		return ContentEditableBackend;
	}

	protected _syncActiveElement(focus: boolean): void {
		if (!this._focusBlockId) return;
		const inlineEl = this._resolveInlineElement(this._focusBlockId);
		if (!inlineEl) return;

		this.attachElement(inlineEl);
		if (focus) {
			this.focus();
		}
	}

	protected _emitStateChange(): void {
		this._overlay?.notifyFieldChange();
		for (const callback of this._storeListeners) {
			callback();
		}
	}

	protected _recomputeSurfaceFromSelection(options?: {
		syncSelectionToBackend?: boolean;
		skipBackendWrite?: boolean;
	}): void {
		const surface = classifySelectionSurface(
			this._editor,
			this._editor.selection,
			this._focusBlockId,
			this._isEditing,
		);
		this._updateSurfaceState(surface.mode, surface.blockIds);
		if (options?.skipBackendWrite) {
			return;
		}
		const selection = this._editor.selection;
		const isAuthorityText = selection?.type === "text";
		// a pending projection must not swallow an authority text write.
		// collapsed carets are authority too (click-collapse, Escape).
		if ((options?.syncSelectionToBackend ?? true) || isAuthorityText) {
			this._backendLifecycle.updateSelection();
		}
	}

	protected _updateSurfaceState(
		mode: "inactive" | "single" | "expanded" | "block",
		blockIds: string[],
	): void {
		const modeChanged = this._mode !== mode;
		const blockIdsChanged = !arraysEqual(this._activeBlockIds, blockIds);
		if (!modeChanged && !blockIdsChanged) return;
		this._mode = mode;
		this._activeBlockIds = blockIds;
		this._syncBackendForSurfaceMode();

		if (this._isEditing && blockIdsChanged) {
			for (const cb of this._activateListeners) cb([...blockIds]);
			this._focusController.emitLifecycle({
				type: "activation-changed",
				editor: this._editor,
				activeBlockIds: [...blockIds],
				isEditing: true,
			});
		}

		this._emitStateChange();
	}

	protected _syncBackendForSurfaceMode(): void {
		if (!this._isEditing || !this._focusBlockId) return;
		// HOST9: a surface switch for a record that is not this editor's to
		// focus (a programmatic range while a host control holds focus)
		// attaches the backend without moving focus into it. Read before the
		// old backend detaches: tearing down an expanded host drops the focus
		// it held to the body, and focus the editor dropped itself was still
		// the editor's, so the new surface takes it back.
		const attachOptions: PenFieldEditorFocusOptions =
			this.projector.isFocusHeldElsewhere() ? { passive: true } : {};
		const NextBackendClass = this._resolveBackendClass();
		if (!this._backendLifecycle.hasBackend(NextBackendClass)) {
			this._backendLifecycle.replace(NextBackendClass);
			this._attachedElement = null;
		}
		if (this._mode === "expanded") {
			const expandedHost = this._findExpandedHost();
			this._attachedElement = null;
			if (expandedHost) {
				this.attachElement(expandedHost, attachOptions);
			}
			return;
		}

		if (this._mode === "block") {
			return;
		}

		if (this._mode === "single") {
			const inlineEl = this._resolveInlineElement(this._focusBlockId);
			if (inlineEl) {
				this.attachElement(inlineEl, attachOptions);
				return;
			}
		}

		if (!this._attachedElement) return;

		const ytext = this._getYText(this._focusBlockId);
		if (!ytext) return;
		if (
			!this._focusController.requestActivation(
				this._attachedElement,
				"backend-attach",
			)
		) {
			return;
		}

		this._backendLifecycle.activate(this._attachedElement, ytext);
	}

	protected _startSession(
		blockId: string,
		options: {
			stopCapturing: boolean;
			syncSelectionToBackend: boolean;
			attachImmediately: boolean;
		},
	): boolean {
		if (this._isEditing) this._deactivate({ restoreFocus: false });

		const block = this._editor.getBlock(blockId);
		if (!block) return false;

		const schema = this._editor.schema.resolve(block.type);
		if (schema?.fieldEditor === "none") return false;

		this._focusBlockId = blockId;
		this._activeBlockIds = [blockId];
		this._isEditing = true;
		this._isComposing = false;
		this._mode = "single";
		this.pendingMarks.reset();

		if (options.stopCapturing) {
			this._editor.undoManager.stopCapturing();
		}

		this._inputMode = resolveFieldEditorInputMode(schema);
		this._backendLifecycle.replace(this._resolveBackendClass());
		this._attachedElement = null;
		if (options.attachImmediately) {
			this._syncActiveElement(false);
		}
		this._recomputeSurfaceFromSelection({
			syncSelectionToBackend: options.syncSelectionToBackend,
		});

		for (const cb of this._activateListeners) cb([...this._activeBlockIds]);
		this._focusController.emitLifecycle({
			type: "activation-changed",
			editor: this._editor,
			activeBlockIds: [...this._activeBlockIds],
			isEditing: true,
		});
		this._emitStateChange();
		return true;
	}

	protected _handleHistoryApplied(event: HistoryAppliedEvent): void {
		const selection = event.selection;
		const nextFocusBlockId =
			event.focusBlockId ??
			(selection?.type === "text" ? selection.focus.blockId : null);
		if (selection?.type !== "text") {
			if (this._isEditing) {
				this._deactivate({ restoreFocus: false });
			}
			return;
		}

		if (!this._isEditing) {
			return;
		}

		if (nextFocusBlockId) {
			this._focusBlockId = nextFocusBlockId;
		}

		// skip backend sync until the restored inline is attached — a write
		// against the previous field races selectionchange with the restored caret
		this._recomputeSurfaceFromSelection({
			syncSelectionToBackend: false,
		});

		const restoredInline = this._focusBlockId
			? this._resolveInlineElement(this._focusBlockId)
			: null;
		if (!restoredInline || !this.attachElement(restoredInline)) {
			return;
		}

		this.focus();
	}

	protected _resolveInlineElement(blockId: string): HTMLElement | null {
		const root = this._findEditorRoot();
		if (!root) return null;
		const cellElement =
			this._cellEditingController.resolveInlineElement(blockId);
		if (cellElement) return cellElement;
		return queryInlineElement(root, blockId);
	}

	protected _getYText(blockId: string): FieldEditorTextLike | null {
		return getResolvedYText(
			this._editor,
			blockId,
			this._cellEditingController.activeCellCoord,
		);
	}
}

function isCoarsePointerType(pointerType: string): boolean {
	return pointerType === "touch" || pointerType === "pen";
}

/** `selectstart` targets the text node where the selection starts. */
function eventTargetElement(event: Event): Element | null {
	return closestDomElement(event.target);
}

function isInEditorContentPointerTarget(
	root: HTMLElement,
	target: EventTarget | null,
): boolean {
	if (!isDomElement(target) || !root.contains(target)) {
		return false;
	}
	const owningRoot = target.closest(`[${DATA_ATTRS.editorRoot}]`);
	if (owningRoot && owningRoot !== root) {
		return false;
	}
	if (target.closest(`[${DATA_ATTRS.ignorePointerGesture}]`)) {
		return false;
	}
	if (target.closest(`[${OVERLAY_LAYER_ATTR}], [${OVERLAY_ITEM_ATTR}]`)) {
		return false;
	}
	if (target.closest(`[${FOCUS_SINK_ATTR}]`)) {
		return false;
	}
	return true;
}
