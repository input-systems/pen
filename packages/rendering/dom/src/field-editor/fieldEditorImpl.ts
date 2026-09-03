import type {
	BlockSchema,
	Editor,
	HistoryAppliedEvent,
	SelectionRecord,
	SelectionState,
	Unsubscribe,
} from "@input/pen-types";
import {
	DocumentRangeImpl,
	getEditorSelectionRecord,
	getSelectionBlockRange,
	hasFieldEditorSurface,
	isCollapsed,
	isMultiBlock,
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
import { HistorySelectionCoordinator } from "./historySelectionCoordinator";
import { PendingMarkController } from "./pendingMarkController";
import { FieldEditorSelectionCoordinator } from "./selectionCoordinator";
import type {
	FieldEditorSelectionSnapshot,
	FieldEditorSelectionSource,
} from "./selectionAuthority";
import { SessionReconciler } from "./sessionReconciler";
import { classifySelectionSurface } from "./crossBlock";
import type {
	ActiveCellCoord,
	FieldEditorFocusReason,
	FieldEditorInputController,
	FieldEditorSession,
	PenFieldEditorFocusOptions,
	PenFocusLifecycleEvent,
	PenFocusLifecycleListener,
	PenFocusPolicy,
} from "./controller";
import { getCellYText, getResolvedYText } from "./contentResolution";
import type { FieldEditorTextLike } from "./crdt";
import { queryBlockElement, queryInlineElement } from "./selectionBridge";
import { areBlockIdsEqual, resolveInputMode } from "./fieldEditorImplHelpers";
import { isSingleFieldNativeLeftover } from "./singleFieldNativeLeftover";
import {
	decideDomSelectionRead,
	type DomSelectionReadDecision,
	type GestureEventKind,
	type GestureSelectionOrigin,
	type ReaderSelection,
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
import type { DomScheduler } from "../scheduler";
import {
	DATA_ATTRS,
	OVERLAY_ITEM_ATTR,
	OVERLAY_LAYER_ATTR,
} from "../utils/dataAttributes";
import { getPreorderBlockIds } from "../utils/documentPreorder";

type FieldEditorOptions = {
	selectAllBehavior?: EditorSelectAllBehavior;
	focusPolicy?: PenFocusPolicy;
};

/**
 * HOST4 backend split (`spec/rules/host.md`). See
 * `FIELD-EDITOR-BACKENDS.md`.
 *
 * `_resolveBackendClass` feature-detects `globalThis.EditContext` as a
 * constructor and falls back to contenteditable. Expanded (multi-block)
 * surfaces and table-cell editing always use contenteditable, even when
 * EditContext exists.
 *
 * Degradation when EditContext is absent: IME uses the composition-event
 * path instead of EditContext `textupdate`, resolving a commit from the event
 * sequence — live DOM against the recorded start text, then the following
 * mutation or the next `compositionstart` for Safari's late `compositionend`.
 * Composition underline and IME window bounds follow the native contenteditable
 * caret rather than `textformatupdate` / `characterboundsupdate`. The field
 * stays editable — typing, paste, and undo still apply.
 */
const FIELD_EDITOR_BACKEND_SPLIT = {
	preferred: "edit-context",
	fallback: "contenteditable",
	alwaysContentEditable: ["expanded", "table-cell"],
} as const;

export class FieldEditorImpl implements FieldEditorSession {
	protected _focusBlockId: string | null = null;
	protected _activeBlockIds: string[] = [];
	protected _attachedElement: HTMLElement | null = null;
	protected _isEditing = false;
	protected _isFocused = false;
	protected _isComposing = false;
	protected _suppressNextBackendActivationFocus = false;
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
	protected _unsubscribeAnnouncer: Unsubscribe | null = null;
	protected _unbindRootPointerWindow: (() => void) | null = null;
	protected _domSyncVersion = 0;
	protected readonly _sessionReconciler: SessionReconciler;
	protected readonly _backendLifecycle: BackendLifecycleController;
	protected readonly _focusController: FocusController;
	protected readonly _cellEditingController: CellEditingController;
	protected readonly _historySelectionCoordinator: HistorySelectionCoordinator;
	protected readonly _pendingMarkController: PendingMarkController;
	protected _selectAllBehavior: EditorSelectAllBehavior;
	protected readonly _selectionCoordinator: FieldEditorSelectionCoordinator;
	protected _scheduler: DomScheduler | null = null;

	constructor(editor: Editor, options?: FieldEditorOptions) {
		this._editor = editor;
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
				this._getYTextForCell(blockId, row, col),
			attachElement: (element) => this.attachElement(element),
			requestDomFocus: (target, reason, focusOptions, policyOptions) =>
				this.requestDomFocus(
					target,
					reason,
					focusOptions,
					policyOptions,
				),
		});
		this._pendingMarkController = new PendingMarkController({
			editor: this._editor,
			getFocusBlockId: () => this._focusBlockId,
			getYText: (blockId) => this._getYText(blockId),
			emitStateChange: () => this._emitStateChange(),
		});
		this._historySelectionCoordinator = new HistorySelectionCoordinator(
			this._editor,
		);
		this._selectionCoordinator = new FieldEditorSelectionCoordinator({
			historySelectionCoordinator: this._historySelectionCoordinator,
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
				this._backendLifecycle.updateSelection(null);
			},
			setTextSelection: (blockId, anchorOffset, focusOffset) =>
				this.setTextSelection(blockId, anchorOffset, focusOffset),
			activate: (blockId) => this.activate(blockId),
			emitSelectionProjected: () => {
				this._emitFocusLifecycle({
					type: "selection-projected",
					editor: this._editor,
					blockId: this._focusBlockId,
				});
			},
			getRecord: () => getEditorSelectionRecord(this._editor),
			emitDiagnostic: (event) => {
				this._editor.internals.emit("diagnostic", event);
			},
		});
		// FE4: the commit feed lives here rather than in a host's mount,
		// because both the vanilla mount and the framework bindings build a
		// field editor while only the vanilla one has a mount function. The
		// scheduler's next flush invalidates the cached rects of the named
		// blocks and of any block the edit reflowed; without the feed the
		// reader only clears on resize or font load, so a caret measured
		// after an edit reads a box from before it.
		this._unsubscribeCommit = this._editor.on("commit", (event) => {
			this._ensureScheduler()?.acceptCommit(event);
		});
		this._unsubscribeSelection = this._editor.onSelectionChange(
			(record) => {
				if (record.origin === "mapped") {
					// FE9: A5 remapped the caret after apply. the last
					// textupdate stamp is a pre-apply offset.
					this.clearBackendSelectionAuthority(
						"edit-context-textupdate",
					);
				}
				const selection = this._editor.selection;
				if (
					selection?.type !== "text" ||
					!isCollapsed(selection) ||
					isMultiBlock(selection)
				) {
					this._pendingMarkController.clear(true);
				}
				const scheduler = this._ensureScheduler();
				const alreadyProjected =
					record.version <=
					this._selectionCoordinator.lastProjectedVersion;
				// HOST9: the record stays authoritative but is not
				// written into the DOM while a native control that is
				// not this field owns focus. the backend write is held
				// back too — it projects the DOM selection the same way.
				const withheld =
					!alreadyProjected &&
					this._selectionCoordinator.isFocusHeldByNativeControlOutsideRoot();
				// surface first so P1 sees the new focus block. skip is
				// not delivery — the projector has not run yet.
				this._recomputeSurfaceFromSelection({
					syncSelectionToBackend: true,
					skipBackendWrite: true,
				});
				if (!alreadyProjected && !withheld) {
					this._selectionCoordinator.syncDomSelectionOnce();
					scheduler?.setSelection(record);
				}
				const delivered =
					record.version <=
					this._selectionCoordinator.lastProjectedVersion;
				this._recomputeSurfaceFromSelection({
					syncSelectionToBackend: true,
					skipBackendWrite: delivered || withheld,
				});
			},
		);
		this._unsubscribeHistoryApplied = this._editor.onHistoryApplied(
			(event) => {
				this._handleHistoryApplied(event);
			},
		);
		this._sessionReconciler = new SessionReconciler(this._editor, {
			getSnapshot: () => this.getSnapshot(),
			getAttachedElement: () => this._attachedElement,
			getInlineElement: (blockId) => this._resolveInlineElement(blockId),
			getYText: (blockId) => this._getYText(blockId),
			shouldPreserveSelection: () =>
				this.shouldProjectSelectionAfterReconcile(),
			shouldProjectSelection: () =>
				this.shouldProjectSelectionAfterReconcile(),
			projectSelection: () =>
				this._selectionCoordinator.syncDomSelectionOnce(),
			notifyDomReconciled: (blockId) => this.notifyDomReconciled(blockId),
			getScheduler: () => this._ensureScheduler(),
		});
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
		const { scheduler } = getRootGeometry(root);
		if (this._scheduler !== scheduler) {
			this._scheduler?.setProjector(null);
			scheduler.setProjector((record) => {
				return this._projectFromScheduler(record);
			});
			this._scheduler = scheduler;
		}
		return scheduler;
	}

	protected _projectFromScheduler(record: SelectionRecord): void | "parked" {
		if (record.version <= this._selectionCoordinator.lastProjectedVersion) {
			return;
		}
		if (
			this._selectionCoordinator.isFocusHeldByNativeControlOutsideRoot()
		) {
			return;
		}
		this._selectionCoordinator.syncDomSelectionOnce();
		if (this._selectionCoordinator.parkedProjectionVersion != null) {
			return "parked";
		}
	}

	protected _unbindSchedulerProjector(): void {
		this._scheduler?.setProjector(null);
		this._scheduler = null;
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

	beginPointerSelection(): void {
		this._selectionCoordinator.beginPointerSelection();
	}

	endPointerSelection(): void {
		this._selectionCoordinator.endPointerSelection();
	}

	setComposing(composing: boolean): void {
		if (this._isComposing === composing) return;
		this._isComposing = composing;
		this._emitStateChange();
	}

	protected _deactivate(options: { restoreFocus: boolean }): void {
		if (!this._isEditing) return;

		const blockIds = [...this._activeBlockIds];
		const focusTargetId = this._focusBlockId ?? blockIds[0] ?? null;
		this._backendLifecycle.deactivate();
		this._attachedElement = null;
		this._cellEditingController.clear();

		this._focusBlockId = null;
		this._activeBlockIds = [];
		this._isEditing = false;
		this._isComposing = false;
		this._historySelectionCoordinator.reset();
		this._selectionCoordinator.reset();
		this._inputMode = "none";
		this._mode = "inactive";
		this._pendingMarkController.reset();

		for (const cb of this._deactivateListeners) cb(blockIds);
		this._emitFocusLifecycle({
			type: "activation-changed",
			editor: this._editor,
			activeBlockIds: [],
			isEditing: false,
		});
		if (options.restoreFocus) {
			this._restoreFocusAfterDeactivate(focusTargetId);
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
			this._backendLifecycle.updateSelection(null);
			return true;
		}

		const nativeSelection = root.ownerDocument?.getSelection();
		if (!nativeSelection) return true;

		const range = root.ownerDocument.createRange();
		range.selectNodeContents(inlineEl);
		range.collapse(false);

		nativeSelection.removeAllRanges();
		nativeSelection.addRange(range);
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
		if (
			reason === "backend-activate" &&
			this._suppressNextBackendActivationFocus
		) {
			return true;
		}
		return this._focusController.requestDomFocus(
			target,
			reason,
			options,
			policyOptions,
		);
	}

	requestActivation(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options: PenFieldEditorFocusOptions = {},
	): boolean {
		return this._focusController.requestActivation(target, reason, options);
	}

	requestRootFocus(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options?: FocusOptions,
	): boolean {
		return this._focusController.requestRootFocus(target, reason, options);
	}

	setRootElement(element: HTMLElement | null): void {
		this._unbindFocusSink();
		this._unbindAnnouncer();
		this._unbindRootPointerGesture();
		this._rootElement = element;
		if (element) {
			this._bindFocusSink(element);
			this._bindAnnouncer(element);
			this._bindRootPointerGesture(element);
			this._focusController.notifyRootAttached(element);
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
		this._unsubscribeFocusSink = this._editor.onSelectionChange(() => {
			syncFocusSink(sink, this._editor);
		});
		syncFocusSink(sink, this._editor);
	}

	protected _unbindFocusSink(): void {
		this._unsubscribeFocusSink?.();
		this._unsubscribeFocusSink = null;
		this._focusSink?.dispose();
		this._focusSink = null;
	}

	protected _bindAnnouncer(root: HTMLElement): void {
		this._unsubscribeAnnouncer = bindEditorAnnouncer(this._editor, root);
	}

	protected _unbindAnnouncer(): void {
		this._unsubscribeAnnouncer?.();
		this._unsubscribeAnnouncer = null;
	}

	protected _bindRootPointerGesture(root: HTMLElement): void {
		this._unbindRootPointerGesture();
		const onPointerDown = (event: PointerEvent): void => {
			if (!isInEditorContentPointerTarget(root, event.target)) {
				return;
			}
			this._selectionCoordinator.notifyGestureEvent("pointerdown");
		};
		root.addEventListener("pointerdown", onPointerDown, true);
		this._unbindRootPointerWindow = () => {
			root.removeEventListener("pointerdown", onPointerDown, true);
			this._unbindRootPointerWindow = null;
		};
	}

	protected _unbindRootPointerGesture(): void {
		this._unbindRootPointerWindow?.();
		this._unbindRootPointerWindow = null;
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
		if (!this.requestActivation(element, "backend-attach", options))
			return false;
		this._emitFocusLifecycle({
			type: "backend-attach-started",
			editor: this._editor,
			target: element,
			blockId: this._focusBlockId,
		});
		this._backendLifecycle.replace(this._resolveBackendClass());

		const ytext = this._getYText(this._focusBlockId);
		if (!ytext) return false;

		this._suppressNextBackendActivationFocus =
			options.domFocus === false || options.passive === true;
		try {
			this._backendLifecycle.activate(element, ytext);
		} finally {
			this._suppressNextBackendActivationFocus = false;
		}
		this._attachedElement = element;
		this._emitFocusLifecycle({
			type: "backend-attach-completed",
			editor: this._editor,
			target: element,
			blockId: this._focusBlockId,
		});
		return true;
	}

	syncTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void {
		if (!this._isEditing) return;
		if (this._focusBlockId !== blockId) return;

		if (
			this._selectionCoordinator.prepareSyncedTextSelection(
				this._editor.selection,
				blockId,
				anchorOffset,
				focusOffset,
			) === "skip"
		) {
			return;
		}
		this.setTextSelection(blockId, anchorOffset, focusOffset);
	}

	applyDocumentTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
	): void {
		this._selectionCoordinator.recordUserSelectionIntent();

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

		this._editor.selectTextRange(anchor, focus);
		this._emitStateChange();
	}

	applyDomTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
		options?: {
			focusBlockId?: string;
		},
	): void {
		if (anchor.blockId !== focus.blockId) {
			this.applyDocumentTextSelection(anchor, focus);
			return;
		}

		this._selectionCoordinator.recordUserSelectionIntent();

		if (
			anchor.blockId === focus.blockId &&
			(!this._isEditing || this._focusBlockId !== anchor.blockId)
		) {
			this._startSession(anchor.blockId, {
				stopCapturing: false,
				syncSelectionToBackend: false,
				attachImmediately: false,
			});
		}

		if (anchor.blockId === focus.blockId) {
			this.setTextSelection(anchor.blockId, anchor.offset, focus.offset);
			return;
		}

		if (options?.focusBlockId) {
			this._focusBlockId = options.focusBlockId;
		}
		this._editor.selectTextRange(anchor, focus);
		this._emitStateChange();
	}

	shouldHandleDomSelectionChange(isApplyingSelection: number): boolean {
		return this._selectionCoordinator.shouldHandleDomSelectionChange(
			this._focusBlockId,
			isApplyingSelection,
		);
	}

	notifyGestureEvent(eventKind: GestureEventKind): void {
		this._selectionCoordinator.notifyGestureEvent(eventKind);
	}

	isAdmissibleGestureRead(): boolean {
		return this._selectionCoordinator.isAdmissibleGestureRead();
	}

	requestDivergenceProjection(): void {
		this._selectionCoordinator.requestDivergenceProjection();
	}

	shouldProjectSelectionAfterReconcile(): boolean {
		return this._selectionCoordinator.shouldProjectSelectionAfterReconcile();
	}

	readDomSelection(proposal: ReaderSelection): DomSelectionReadDecision {
		const decided = decideDomSelectionRead({
			editor: this._editor,
			proposal,
			gestureWindows: this._selectionCoordinator.getGestureWindows(),
			projectionInFlight:
				this._selectionCoordinator.isProjectionInFlight(),
		});
		this.notifyGestureEvent("selectionchange");
		const isLeftoverField =
			proposal?.type === "text" &&
			isSingleFieldNativeLeftover(this._editor.selection, proposal);
		if (decided.decision === "diverge") {
			// document select-all leftover is closed-window (I4) so it
			// must not write; P2 must not run either, because projecting
			// the multi-block range makes the engine confine it again.
			if (!isLeftoverField) {
				this.requestDivergenceProjection();
			}
			return decided.decision;
		}
		if (decided.decision !== "accept" || decided.normalized === null) {
			return decided.decision;
		}
		if (isLeftoverField) {
			// Same leftover with the window open: a drag onto a block
			// with no text position reports the nearest text end, and
			// accepting it would drop the structural cover. Re-project
			// so the DOM follows the authority instead. A click is
			// collapsed, so it still accepts.
			this.requestDivergenceProjection();
			return "diverge";
		}
		this._applyAcceptedDomSelection(decided.normalized, decided.origin);
		return decided.decision;
	}

	resetBackendSelectionAuthority(): void {
		this._selectionCoordinator.resetAuthority();
	}

	setBackendSelectionAuthority(
		source: FieldEditorSelectionSource,
		selection: FieldEditorSelectionSnapshot | null,
	): void {
		this._selectionCoordinator.setAuthoritySelection(source, selection);
	}

	getBackendSelectionAuthority(
		source: FieldEditorSelectionSource,
		blockId?: string | null,
	): FieldEditorSelectionSnapshot | null {
		return this._selectionCoordinator.getAuthoritySelection(
			source,
			blockId,
		);
	}

	hasBackendSelectionAuthority(source: FieldEditorSelectionSource): boolean {
		return this._selectionCoordinator.hasAuthoritySelection(source);
	}

	clearBackendSelectionAuthority(source: FieldEditorSelectionSource): void {
		this._selectionCoordinator.clearAuthoritySelection(source);
	}

	withBackendSelectionWrite<T>(write: () => T): T {
		return this._selectionCoordinator.withSelectionWrite(write);
	}

	getBackendSelectionApplicationDepth(): number {
		return this._selectionCoordinator.isApplyingSelection;
	}

	setEditContextSelectionSnapshot(
		selection: FieldEditorSelectionSnapshot | null,
	): void {
		this._selectionCoordinator.setEditContextSelection(selection);
	}

	getEditContextSelectionSnapshot(
		blockId?: string | null,
	): FieldEditorSelectionSnapshot | null {
		return this._selectionCoordinator.getEditContextSelection(blockId);
	}

	private _applyAcceptedDomSelection(
		normalized: Exclude<ReaderSelection, null>,
		origin: GestureSelectionOrigin,
	): void {
		this._selectionCoordinator.recordUserSelectionIntent();
		switch (normalized.type) {
			case "text": {
				if (
					normalized.anchor.blockId === normalized.focus.blockId &&
					(!this._isEditing ||
						this._focusBlockId !== normalized.anchor.blockId)
				) {
					this._startSession(normalized.anchor.blockId, {
						stopCapturing: false,
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
	): void {
		if (anchorOffset !== focusOffset) {
			this._pendingMarkController.clear(true);
		}
		this._editor.selectText(blockId, anchorOffset, focusOffset);
		this._emitStateChange();
	}

	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: PenFieldEditorFocusOptions,
	): void {
		this._selectionCoordinator.activateTextSelection(
			blockId,
			anchorOffset,
			focusOffset,
			options,
		);
	}

	async focusTextSelection(
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
		const attached = await this.waitForAttachment(blockId);
		if (!attached) {
			return false;
		}
		if (options.domFocus === false || options.passive) {
			return true;
		}
		const focused = this.focus(options);
		this.commitProgrammaticTextSelection(
			blockId,
			anchorOffset,
			focusOffset,
		);
		return focused;
	}

	commitProgrammaticTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: PenFieldEditorFocusOptions,
	): void {
		this._selectionCoordinator.commitProgrammaticTextSelection(
			blockId,
			anchorOffset,
			focusOffset,
			options,
		);
	}

	commitCellTextSelection(
		blockId: string,
		row: number,
		col: number,
		anchorOffset: number,
		focusOffset: number,
	): void {
		this.setBackendSelectionAuthority("cell", {
			blockId,
			anchorOffset,
			focusOffset,
			cell: { row, col },
		});
		this._backendLifecycle.updateSelection(null);
	}

	collapseSelectionToFocus(): void {
		const selection = this._editor.selection;
		if (selection?.type !== "text") return;

		this._collapseAndProject(selection.focus);
	}

	collapseSelectionToAnchor(): void {
		const selection = this._editor.selection;
		if (selection?.type !== "text") return;

		this._collapseAndProject(selection.anchor);
	}

	collapseSelectionToPoint(point: { blockId: string; offset: number }): void {
		this._collapseAndProject(point);
	}

	protected _collapseAndProject(point: {
		blockId: string;
		offset: number;
	}): void {
		this.setTextSelection(point.blockId, point.offset, point.offset);

		if (!this._isEditing || this._focusBlockId !== point.blockId) {
			this.activate(point.blockId);
		}

		this._selectionCoordinator.syncDomSelectionOnce();
	}

	delegate(blockSchema: BlockSchema): boolean {
		return hasFieldEditorSurface(blockSchema);
	}

	getPendingMarks(): Readonly<Record<string, unknown | null>> {
		return this._pendingMarkController.getSnapshot();
	}

	clearPendingMarks(): void {
		this._pendingMarkController.clear();
	}

	protected _syncSelectionToDOM(): void {
		if (!this._isEditing) return;
		this._selectionCoordinator.syncDomSelectionOnce();
	}

	togglePendingMark(markType: string): boolean {
		return this._pendingMarkController.toggle(
			markType,
			this._isEditing,
			this._inputMode,
		);
	}

	resolveInsertMarks(
		ytext: FieldEditorTextLike,
		offset: number,
	): Record<string, unknown | null> | undefined {
		return this._pendingMarkController.resolveInsertMarks(ytext, offset);
	}

	// ── Cross-block expansion ────────────────────────────────

	expandTo(blockId: string): void {
		if (!this._isEditing || !this._focusBlockId) return;

		const selection = this._editor.selection;
		const anchor =
			selection?.type === "text" &&
			getSelectionBlockRange(
				this._editor.internals.doc,
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

	notifyDomReconciled(_blockId?: string): void {
		this._domSyncVersion += 1;
		this._emitStateChange();
	}

	subscribe(callback: () => void): Unsubscribe {
		this._storeListeners.add(callback);
		return () => this._storeListeners.delete(callback);
	}

	waitForAttachment(blockId = this._focusBlockId): Promise<boolean> {
		return this._focusController.waitForAttachment(blockId);
	}

	ackBlockMounted(blockId: string, element: HTMLElement): void {
		this._selectionCoordinator.ackBlockMounted(blockId, element);
		if (this._cellEditingController.activeCellCoord?.blockId === blockId) {
			this._cellEditingController.trySyncBackend();
		}
	}

	destroy(): void {
		this._unbindSchedulerProjector();
		this._unbindFocusSink();
		this._unbindAnnouncer();
		this._unbindRootPointerGesture();
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
	}

	// ── Internal ─────────────────────────────────────────────

	// HOST4: EditContext is above the HOST3 floor. Detect the constructor;
	// contenteditable is the real fallback. Expanded and table-cell surfaces
	// always use contenteditable even when EditContext exists. See
	// FIELD_EDITOR_BACKEND_SPLIT and FIELD-EDITOR-BACKENDS.md.
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

	protected _restoreFocusAfterDeactivate(blockId: string | null): void {
		const selection = this._editor.selection;
		if (
			this._focusSink &&
			(selection?.type === "block" || selection?.type === "cell")
		) {
			this._focusController.requestDomFocus(
				this._focusSink.element,
				"restore",
				{ preventScroll: true },
			);
			return;
		}
		this._focusController.restoreFocusAfterDeactivate(blockId);
	}

	protected _emitStateChange(): void {
		for (const callback of this._storeListeners) {
			callback();
		}
	}

	protected _emitFocusLifecycle(event: PenFocusLifecycleEvent): void {
		this._focusController.emitLifecycle(event);
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
			this._backendLifecycle.updateSelection(null);
		}
	}

	protected _updateSurfaceState(
		mode: "inactive" | "single" | "expanded" | "block",
		blockIds: string[],
	): void {
		const modeChanged = this._mode !== mode;
		const blockIdsChanged = !areBlockIdsEqual(
			this._activeBlockIds,
			blockIds,
		);
		if (!modeChanged && !blockIdsChanged) return;
		this._mode = mode;
		this._activeBlockIds = blockIds;
		this._syncBackendForSurfaceMode();

		if (this._isEditing && blockIdsChanged) {
			for (const cb of this._activateListeners) cb([...blockIds]);
			this._emitFocusLifecycle({
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
		const NextBackendClass = this._resolveBackendClass();
		if (!this._backendLifecycle.hasBackend(NextBackendClass)) {
			this.withBackendSelectionWrite(() => {
				this._backendLifecycle.replace(NextBackendClass);
			});
			this._attachedElement = null;
		}

		if (this._mode === "expanded") {
			const expandedHost = this._findExpandedHost();
			this._attachedElement = null;
			if (expandedHost) {
				this.attachElement(expandedHost);
			}
			return;
		}

		if (this._mode === "block") {
			return;
		}

		if (this._mode === "single") {
			const inlineEl = this._resolveInlineElement(this._focusBlockId);
			if (inlineEl) {
				this.attachElement(inlineEl);
				return;
			}
		}

		if (!this._attachedElement) return;

		const ytext = this._getYText(this._focusBlockId);
		if (!ytext) return;
		if (!this.requestActivation(this._attachedElement, "backend-attach")) {
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
		this._pendingMarkController.reset();

		if (options.stopCapturing) {
			this._editor.undoManager.stopCapturing();
		}

		this._inputMode = resolveInputMode(schema);
		this._backendLifecycle.replace(this._resolveBackendClass());
		this._attachedElement = null;
		if (options.attachImmediately) {
			this._syncActiveElement(false);
		}
		this._recomputeSurfaceFromSelection({
			syncSelectionToBackend: options.syncSelectionToBackend,
		});

		for (const cb of this._activateListeners) cb([...this._activeBlockIds]);
		this._emitFocusLifecycle({
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

		this._historySelectionCoordinator.beginDeferredProjection(
			event.requestId,
		);

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
		this._historySelectionCoordinator.completeDeferredProjection(
			event.requestId,
		);
	}

	protected _attachedElementOwnsFocus(): boolean {
		return this._focusController.attachedElementOwnsFocus();
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

	protected _getYTextForCell(
		blockId: string,
		row: number,
		col: number,
	): FieldEditorTextLike | null {
		return getCellYText(this._editor, blockId, row, col);
	}
}

function isInEditorContentPointerTarget(
	root: HTMLElement,
	target: EventTarget | null,
): boolean {
	if (!(target instanceof Element) || !root.contains(target)) {
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
