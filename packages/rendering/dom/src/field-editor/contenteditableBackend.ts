import type { Editor, InlineDecoration } from "@input/pen-types";
import type { FieldEditorInputController } from "./controller";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import {
	buildInlineDecorationsRenderSignature,
	inlineDecorationsForBlock,
	inlineDecorationsRequireFullReconcile,
} from "../utils/inlineDecorations";
import { fullReconcileToDOM, applyDeltaToDOM } from "./reconciler";
import {
	computeTextDiff,
	editorSelectionToDOM,
	extractTextFromDOM,
	getSelectionOffsets,
} from "./selectionBridge";
import { applyListInputRule } from "./commands";
import { isHistoryTransactionOrigin } from "./historyOrigin";
import type { InlineTextDiffOp } from "./inlineTextTransaction";
import {
	applyInlineTextDiffInput,
	applyInlineTextInput,
} from "./textInputPipeline";
import type {
	FieldEditorDelta,
	FieldEditorObserver,
	FieldEditorTextChangeEvent,
	FieldEditorTextLike,
} from "./crdt";
import { DIRECT_HANDLERS } from "./contenteditableDirectHandlers";
import {
	canResolveInputRange,
	isNavigationSelectionKey,
	rebaseTextDiffOps,
	requiresResolvedInputRange,
	setSelectionOffsets,
} from "./contenteditableDomHelpers";
import {
	resolveLiveTextSelection,
	resolveRestoreCellEndpoints,
	resolveRestoreTextEndpoints,
} from "./selectionAuthority";
import { BackendAttachment } from "./backendAttachment";
import { bindBackendTransferEvents } from "./backendTransferEvents";
import { mapBeforeInput } from "./beforeinputMap";
import { handleFieldEditorKeyDown } from "./keyHandling";
import {
	forwardDomSelectionToReader,
	readNormalizedDomProposal,
	resolveEditorRoot,
	shouldStopEquivalentDomRead,
} from "./selectionReader";
import {
	isCollapsedDomAgainstProjectedOffsets,
	isFullBlockEchoAgainstCollapsedCaret,
} from "./selectionProjectionController";

export class ContentEditableBackend {
	protected element: HTMLElement | null = null;
	protected ytext: FieldEditorTextLike | null = null;
	protected observer: FieldEditorObserver | null = null;
	protected mutationObserver: MutationObserver | null = null;
	protected isComposing = false;
	// block-policy beforeinput: do not absorb later browser leftovers as ops
	protected ignoreBrowserMutations = false;
	// watchdog must not observe its own restore writes
	protected restoringDomFromModel = false;
	protected lastWatchdogMismatch: string | null = null;
	protected compositionStartText: string | null = null;
	protected deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }> = [];
	protected readonly attachment = new BackendAttachment();
	protected inlineDecorationsSignature: readonly InlineDecoration[] | null =
		null;
	protected editor: Editor;
	protected fieldEditor: FieldEditorInputController;

	constructor(editor: Editor, fieldEditor: FieldEditorInputController) {
		this.editor = editor;
		this.fieldEditor = fieldEditor;
	}

	activate(element: HTMLElement, ytext: unknown): void {
		this.element = element;
		const activeYText = ytext as FieldEditorTextLike;
		this.ytext = activeYText;

		element.contentEditable = "true";
		this.fieldEditor.resetBackendSelectionAuthority();
		this.fieldEditor.withBackendSelectionWrite(() => {
			this.isComposing = false;
			this.ignoreBrowserMutations = false;
			this.restoringDomFromModel = false;
			this.lastWatchdogMismatch = null;
			this.compositionStartText = null;
			this.fieldEditor.setComposing(false);

			this.attachment.listen(
				element,
				"beforeinput",
				this.handleBeforeInput,
			);
			this.attachment.listen(
				element,
				"compositionstart",
				this.handleCompositionStart,
			);
			this.attachment.listen(
				element,
				"compositionend",
				this.handleCompositionEnd,
			);
			this.attachment.listen(element, "keydown", this.handleKeyDown);
			bindBackendTransferEvents(
				this.attachment,
				element,
				this.editor,
				this.fieldEditor,
			);
			this.attachment.listen(
				element,
				"pointerdown",
				this.handlePointerDown,
			);
			this.attachment.listen(
				element,
				"contextmenu",
				this.handleContextMenu,
			);
			if (element.ownerDocument) {
				this.attachment.listenDocument(
					element.ownerDocument,
					"selectionchange",
					this.handleSelectionChange,
				);
			}

			this.mutationObserver = this.attachment.observeMutations(
				element,
				this.handleMutations,
				{
					childList: true,
					subtree: true,
					characterData: true,
					characterDataOldValue: true,
				},
			);

			this.observer = (event) => this.handleYTextChange(event);
			this.attachment.observeText(activeYText, this.observer);
			this.attachment.subscribe(
				this.editor.on(
					"decorationsChange",
					this.handleDecorationsChange,
				),
			);
			this.inlineDecorationsSignature =
				this.getInlineDecorationsSignature();

			fullReconcileToDOM(activeYText, element, this.editor.schema, {
				urlPolicy: urlPolicyFromEditor(this.editor),
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(
				this.fieldEditor.focusBlockId ?? undefined,
			);
			this.restoreDOMSelectionFromEditor();
			this.discardObservedMutations();
		});
	}

	protected discardObservedMutations(): void {
		this.mutationObserver?.takeRecords();
	}

	deactivate(): void {
		if (this.element) {
			// remove, never `contentEditable = "false"`. When the surface
			// expands, the blocks host becomes the editing host and this
			// element stays inside it; an explicit `false` would leave a
			// read-only island there. WebKit refuses to extend a selection
			// out of such an island and clamps at its boundary, so a
			// cross-block pointer drag that starts in this field can never
			// reach the next block. Absent is equivalent while the parent is
			// not editable, which is the single-field case.
			this.element.removeAttribute("contenteditable");
		}
		this.attachment.release();
		this.mutationObserver = null;
		this.element = null;
		this.ytext = null;
		this.observer = null;
		this.inlineDecorationsSignature = null;
		this.deferredRemoteDeltas = [];
		this.fieldEditor.resetBackendSelectionAuthority();
		this.isComposing = false;
		this.ignoreBrowserMutations = false;
		this.restoringDomFromModel = false;
		this.lastWatchdogMismatch = null;
		this.compositionStartText = null;
		this.fieldEditor.setComposing(false);
	}

	updateSelection(_relPos: unknown): void {
		this.restoreDOMSelectionFromEditor();
	}

	protected _getActiveCellCoord(blockId: string): {
		blockId: string;
		row: number;
		col: number;
	} | null {
		const coord = this.fieldEditor.activeCellCoord;
		if (!coord || coord.blockId !== blockId) {
			return null;
		}
		return coord;
	}

	applyInlineTextEdit(options: {
		blockId: string;
		range: { start: number; end: number };
		text: string;
		marks?: Record<string, unknown>;
	}): void {
		const { blockId, range, text, marks } = options;
		const cellCoord = this._getActiveCellCoord(blockId);
		applyInlineTextInput({
			editor: this.editor,
			fieldEditor: this.fieldEditor,
			blockId,
			range,
			text,
			marks,
			cellCoord,
		});
		this.ensureActiveDOMMatchesYText();
		this.restoreDOMSelectionFromEditor();
		this.fieldEditor.clearBackendSelectionAuthority("programmatic");
	}

	commitDispatchedEdit(): void {
		const blockId = this.fieldEditor.focusBlockId;
		const selection = this.editor.selection;
		if (
			blockId &&
			selection?.type === "text" &&
			selection.anchor.blockId === blockId &&
			selection.focus.blockId === blockId
		) {
			this.fieldEditor.setBackendSelectionAuthority("programmatic", {
				blockId,
				anchorOffset: selection.anchor.offset,
				focusOffset: selection.focus.offset,
			});
			this.fieldEditor.syncTextSelection(
				blockId,
				selection.anchor.offset,
				selection.focus.offset,
			);
		}
		this.ensureActiveDOMMatchesYText();
		this.restoreDOMSelectionFromEditor();
		this.fieldEditor.clearBackendSelectionAuthority("programmatic");
	}

	applyListInputRule(options: {
		blockId: string;
		range: { start: number; end: number };
		text: string;
	}): boolean {
		const target = applyListInputRule(this.editor, options);
		if (!target) return false;

		this.fieldEditor.setBackendSelectionAuthority("programmatic", {
			blockId: target.blockId,
			anchorOffset: target.anchorOffset,
			focusOffset: target.focusOffset,
		});

		this.fieldEditor.syncTextSelection(
			target.blockId,
			target.anchorOffset,
			target.focusOffset,
		);
		this.restoreDOMSelectionFromEditor();
		this.fieldEditor.clearBackendSelectionAuthority("programmatic");
		return true;
	}

	restoreDOMSelectionFromEditor(): void {
		const element = this.element;
		if (!element) return;

		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) return;
		const selection = this.editor.selection;

		const pendingSelection = this.fieldEditor.getBackendSelectionAuthority(
			"programmatic",
			blockId,
		);
		const activeCell = this._getActiveCellCoord(blockId);
		if (activeCell) {
			const activeSelection = resolveRestoreCellEndpoints(
				pendingSelection,
				this.fieldEditor.getBackendSelectionAuthority("cell", blockId),
				activeCell,
			);
			if (!activeSelection) return;
			const start = activeSelection.anchorOffset;
			const end = activeSelection.focusOffset;
			this.fieldEditor.withBackendSelectionWrite(() => {
				setSelectionOffsets(element, start, end);
			});
			return;
		}
		const restored = resolveRestoreTextEndpoints(
			blockId,
			resolveLiveTextSelection(selection, blockId, activeCell),
			pendingSelection,
		);
		const anchor = restored?.anchor ?? null;
		const focus = restored?.focus ?? null;

		if (!anchor || !focus) return;
		if (anchor.blockId !== blockId || focus.blockId !== blockId) {
			return;
		}
		this.fieldEditor.setBackendSelectionAuthority("programmatic", {
			blockId,
			anchorOffset: anchor.offset,
			focusOffset: focus.offset,
		});

		const root = element.closest(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		if (!root) return;

		this.fieldEditor.withBackendSelectionWrite(() => {
			editorSelectionToDOM(root, anchor, focus);
		});
	}

	protected handleContextMenu = (): void => {
		this.fieldEditor.notifyGestureEvent?.("contextmenu");
	};
	protected handleBeforeInput = (event: InputEvent): void => {
		if (this.isComposing) return;
		if (!this.ytext || !this.element) return;

		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId || !this.editor.getBlock(blockId)) {
			this.fieldEditor.deactivate();
			return;
		}

		// map decides preventDefault / allow / block; DIRECT_HANDLERS only implement commands
		const mapping = mapBeforeInput(event.inputType);
		if ("policy" in mapping) {
			switch (mapping.policy) {
				case "allow":
					this.ignoreBrowserMutations = false;
					return;
				case "block":
					event.preventDefault();
					this.ignoreBrowserMutations = true;
					this.editor.internals.emit("diagnostic", {
						code: mapping.code,
						level: "warn",
						source: "beforeinput",
						message: `unhandled beforeinput inputType: ${event.inputType}`,
						inputType: event.inputType,
					});
					return;
				default: {
					const _exhaustive: never = mapping;
					return _exhaustive;
				}
			}
		}

		event.preventDefault();
		this.ignoreBrowserMutations = false;

		const handler = DIRECT_HANDLERS[event.inputType];
		if (!handler) {
			return;
		}
		if (
			requiresResolvedInputRange(event.inputType) &&
			!this.ensureResolvableInputRange(event)
		) {
			return;
		}

		handler(
			event,
			this.editor,
			this.ytext,
			this.fieldEditor,
			this.element,
			this,
		);
	};

	protected ensureResolvableInputRange(event: InputEvent): boolean {
		if (!this.element) {
			return false;
		}
		if (canResolveInputRange(event, this.element)) {
			return true;
		}

		this.restoreDOMSelectionFromEditor();

		return canResolveInputRange(event, this.element);
	}

	// ── Composition handling ──────────────────────────────────

	protected handleCompositionStart = (): void => {
		if (this.compositionStartText != null) {
			this.reconcileAfterComposition();
			this.fieldEditor.notifyGestureEvent?.("compositionend-completed");
		}
		this.isComposing = true;
		this.ignoreBrowserMutations = false;
		this.compositionStartText = this.ytext?.toString() ?? "";
		this.deferredRemoteDeltas = [];
		this.fieldEditor.setComposing(true);
		this.fieldEditor.notifyGestureEvent?.("compositionstart");
	};

	protected handleCompositionEnd = (event?: CompositionEvent): void => {
		this.isComposing = false;
		this.fieldEditor.setComposing(false);

		const startText = this.compositionStartText ?? "";
		const domText = this.element
			? extractTextFromDOM(this.element)
			: startText;
		const committed = event?.data ?? "";
		const fieldIsQuiescent =
			domText !== startText ||
			committed.length === 0 ||
			domText.includes(committed);

		if (fieldIsQuiescent) {
			this.reconcileAfterComposition();
			this.fieldEditor.notifyGestureEvent?.("compositionend-completed");
		}
	};

	protected reconcileAfterComposition(): void {
		if (!this.element || !this.ytext) return;
		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) return;

		const domText = extractTextFromDOM(this.element);
		const baseText = this.compositionStartText ?? this.ytext.toString();

		if (domText !== baseText) {
			const diff = rebaseTextDiffOps(
				computeTextDiff(baseText, domText),
				this.deferredRemoteDeltas,
			);
			this.applyTextDiffAsOps(blockId, diff);
		}

		if (this.deferredRemoteDeltas.length > 0) {
			this.deferredRemoteDeltas = [];
			fullReconcileToDOM(this.ytext, this.element!, this.editor.schema, {
				urlPolicy: urlPolicyFromEditor(this.editor),
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.discardObservedMutations();
			this.fieldEditor.notifyDomReconciled(
				this.fieldEditor.focusBlockId ?? undefined,
			);
		}

		this.compositionStartText = null;
		this.restoreDOMSelectionFromEditor();
		this.discardObservedMutations();
	}

	// ── Mutation observer watchdog ────────────────────────────

	protected handleMutations = (_mutations: MutationRecord[]): void => {
		if (this.restoringDomFromModel) return;
		if (!this.isComposing && this.compositionStartText != null) {
			this.reconcileAfterComposition();
			this.fieldEditor.notifyGestureEvent?.("compositionend-completed");
			return;
		}
		if (this.isComposing) return;
		if (!this.element || !this.ytext) return;
		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) return;

		const domText = extractTextFromDOM(this.element);
		const crdtText = this.ytext.toString();
		if (domText === crdtText) {
			this.lastWatchdogMismatch = null;
			return;
		}
		const mismatchKey = `${crdtText}\0${domText}`;
		if (this.lastWatchdogMismatch === mismatchKey) {
			return;
		}
		this.lastWatchdogMismatch = mismatchKey;

		if (!this.ignoreBrowserMutations) {
			this.editor.internals.emit("diagnostic", {
				code: "dom-divergence",
				level: "warn",
				source: "mutation-observer",
				message:
					"contenteditable DOM diverged from the document; restoring from the model",
			});
		}

		// do not put a foreign caret back — that re-dirties WebKit/Firefox
		// contenteditable and the observer re-enters on its own write.
		this.restoringDomFromModel = true;
		try {
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				urlPolicy: urlPolicyFromEditor(this.editor),
				preserveSelection: false,
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.discardObservedMutations();
		} finally {
			this.restoringDomFromModel = false;
		}
		this.fieldEditor.notifyDomReconciled(blockId);
	};

	// ── CRDT→DOM reconciliation ───────────────────────────────

	protected handleYTextChange = (event: FieldEditorTextChangeEvent): void => {
		if (this.isComposing) {
			if (
				event.transaction?.origin === "remote" ||
				event.transaction?.origin === "collaborator"
			) {
				this.deferredRemoteDeltas.push({ delta: event.delta });
			}
			return;
		}

		if (!this.element || !this.ytext) return;
		const isHistory = isHistoryTransactionOrigin(event.transaction?.origin);
		if (isHistory) {
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				urlPolicy: urlPolicyFromEditor(this.editor),
				preserveSelection: true,
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(
				this.fieldEditor.focusBlockId ?? undefined,
			);
			this.restoreDOMSelectionFromEditor();
			this.discardObservedMutations();
			return;
		}

		const blockId = this.fieldEditor.focusBlockId;
		const isActiveCell = blockId
			? !!this._getActiveCellCoord(blockId)
			: false;
		if (isActiveCell) {
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				urlPolicy: urlPolicyFromEditor(this.editor),
				preserveSelection: true,
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(blockId ?? undefined);
			if (
				this.fieldEditor.hasBackendSelectionAuthority("programmatic") ||
				event.transaction?.origin === "remote" ||
				event.transaction?.origin === "collaborator"
			) {
				this.restoreDOMSelectionFromEditor();
			}
			this.discardObservedMutations();
			return;
		}

		const inlineDecorations = this.getInlineDecorationsForBlock();
		if (inlineDecorationsRequireFullReconcile(inlineDecorations)) {
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				urlPolicy: urlPolicyFromEditor(this.editor),
				preserveSelection: true,
				inlineDecorations,
			});
			this.fieldEditor.notifyDomReconciled(blockId ?? undefined);
			if (
				this.fieldEditor.hasBackendSelectionAuthority("programmatic") ||
				event.transaction?.origin === "remote" ||
				event.transaction?.origin === "collaborator"
			) {
				this.restoreDOMSelectionFromEditor();
			}
			this.discardObservedMutations();
			return;
		}

		const applied = applyDeltaToDOM(
			event.delta,
			this.element,
			this.editor.schema,
			urlPolicyFromEditor(this.editor),
		);
		if (!applied) {
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				urlPolicy: urlPolicyFromEditor(this.editor),
				preserveSelection: true,
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(blockId ?? undefined);
		}

		if (
			this.fieldEditor.hasBackendSelectionAuthority("programmatic") ||
			event.transaction?.origin === "remote" ||
			event.transaction?.origin === "collaborator"
		) {
			this.restoreDOMSelectionFromEditor();
		}
		this.discardObservedMutations();
	};
	protected applyTextDiffAsOps(
		blockId: string,
		diff: InlineTextDiffOp[],
	): void {
		if (diff.length === 0) return;
		const ytext = this.ytext;
		if (!ytext) return;

		const cellCoord = this._getActiveCellCoord(blockId);
		const range = this.element ? getSelectionOffsets(this.element) : null;
		const selection = range
			? {
					blockId,
					anchorOffset: range.start,
					focusOffset: range.end,
					cell: cellCoord
						? { row: cellCoord.row, col: cellCoord.col }
						: undefined,
				}
			: null;
		const result = applyInlineTextDiffInput({
			editor: this.editor,
			fieldEditor: this.fieldEditor,
			blockId,
			diff,
			ytext,
			selection,
			cellCoord,
		});
		if (!result.applied) return;
		this.ensureActiveDOMMatchesYText();
		this.restoreDOMSelectionFromEditor();
		this.fieldEditor.clearBackendSelectionAuthority("programmatic");
	}

	protected ensureActiveDOMMatchesYText(preserveSelection = true): boolean {
		if (!this.element || !this.ytext) return false;
		const nextInlineDecorationsSignature =
			this.getInlineDecorationsSignature();
		if (
			extractTextFromDOM(this.element) === this.ytext.toString() &&
			nextInlineDecorationsSignature === this.inlineDecorationsSignature
		) {
			return false;
		}

		fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
			urlPolicy: urlPolicyFromEditor(this.editor),
			preserveSelection,
			inlineDecorations: this.getInlineDecorationsForBlock(),
		});
		this.discardObservedMutations();
		this.fieldEditor.notifyDomReconciled(
			this.fieldEditor.focusBlockId ?? undefined,
		);
		this.inlineDecorationsSignature = nextInlineDecorationsSignature;
		return true;
	}

	protected handleDecorationsChange = (): void => {
		if (this.isComposing) {
			return;
		}
		if (
			this.getInlineDecorationsSignature() ===
			this.inlineDecorationsSignature
		) {
			return;
		}
		// a decoration can change while another control owns focus; writing
		// the selection back into this field would drag focus along with it
		const projectSelection =
			this.fieldEditor.shouldProjectSelectionAfterReconcile?.() ?? true;
		if (
			this.ensureActiveDOMMatchesYText(projectSelection) &&
			projectSelection
		) {
			this.restoreDOMSelectionFromEditor();
		}
	};

	protected getInlineDecorationsForBlock(): readonly InlineDecoration[] {
		return inlineDecorationsForBlock(
			this.editor,
			this.fieldEditor.focusBlockId,
		);
	}

	protected getInlineDecorationsSignature(): readonly InlineDecoration[] {
		return buildInlineDecorationsRenderSignature(
			this.getInlineDecorationsForBlock(),
			this.inlineDecorationsSignature,
		);
	}

	// ── Keyboard shortcuts ────────────────────────────────────

	protected handleKeyDown = (event: KeyboardEvent): void => {
		if (!this.ytext) return;
		if (isNavigationSelectionKey(event)) {
			this.fieldEditor.clearBackendSelectionAuthority("programmatic");
			this.fieldEditor.clearBackendSelectionAuthority("user-dom");
		}

		const handled = handleFieldEditorKeyDown({
			event,
			editor: this.editor,
			fieldEditor: this.fieldEditor,
			ytext: this.ytext,
			range: this.element ? getSelectionOffsets(this.element) : null,
		});
		if (handled) {
			event.preventDefault();
			return;
		}
	};

	resolveLiveInputRange(): {
		start: number;
		end: number;
	} | null {
		return this.element ? getSelectionOffsets(this.element) : null;
	}

	resolveCurrentInputRange(): {
		start: number;
		end: number;
	} | null {
		return this.resolveLiveInputRange();
	}

	protected handleSelectionChange = (): void => {
		if (!this.element) return;
		const isApplyingSelection =
			this.fieldEditor.getBackendSelectionApplicationDepth();
		if (
			!this.fieldEditor.shouldHandleDomSelectionChange(
				isApplyingSelection,
			)
		) {
			const suppressed = this.readAttachedNormalizedSelection();
			if (
				suppressed &&
				isFullBlockEchoAgainstCollapsedCaret(
					suppressed,
					this.fieldEditor.selection,
					(blockId) =>
						this.editor.getBlock(blockId)?.length() ?? null,
				)
			) {
				this.restoreDOMSelectionFromEditor();
			} else if (
				isApplyingSelection > 0 &&
				suppressed &&
				isCollapsedDomAgainstProjectedOffsets(
					suppressed,
					(blockId) =>
						this.fieldEditor.getBackendSelectionAuthority(
							"programmatic",
							blockId,
						) ??
						this.fieldEditor.getBackendSelectionAuthority(
							"user-dom",
							blockId,
						),
				)
			) {
				this.restoreDOMSelectionFromEditor();
			}
			return;
		}

		const root = resolveEditorRoot(this.element);
		if (!root) return;

		const normalizedSelection = readNormalizedDomProposal(
			root,
			this.editor,
		);
		if (!normalizedSelection) return;

		if (shouldStopEquivalentDomRead(this.editor, normalizedSelection)) {
			return;
		}

		if (
			isFullBlockEchoAgainstCollapsedCaret(
				normalizedSelection,
				this.fieldEditor.selection,
				(blockId) => this.editor.getBlock(blockId)?.length() ?? null,
			)
		) {
			this.restoreDOMSelectionFromEditor();
			return;
		}

		if (
			isCollapsedDomAgainstProjectedOffsets(
				normalizedSelection,
				(blockId) =>
					this.fieldEditor.getBackendSelectionAuthority(
						"programmatic",
						blockId,
					) ??
					this.fieldEditor.getBackendSelectionAuthority(
						"user-dom",
						blockId,
					),
			)
		) {
			this.restoreDOMSelectionFromEditor();
			return;
		}

		if (
			forwardDomSelectionToReader(this.fieldEditor, normalizedSelection)
		) {
			return;
		}

		if (normalizedSelection.type === "block") {
			this.fieldEditor.deactivate();
			this.editor.setSelection({
				type: "block",
				blockIds: normalizedSelection.blockIds,
			});
			return;
		}

		this.fieldEditor.setBackendSelectionAuthority("user-dom", {
			blockId: normalizedSelection.anchor.blockId,
			anchorOffset: normalizedSelection.anchor.offset,
			focusOffset: normalizedSelection.focus.offset,
		});
		const projectedSelection =
			this.fieldEditor.getBackendSelectionAuthority(
				"programmatic",
				normalizedSelection.anchor.blockId,
			);
		if (
			!projectedSelection ||
			projectedSelection.anchorOffset !==
				normalizedSelection.anchor.offset ||
			projectedSelection.focusOffset !== normalizedSelection.focus.offset
		) {
			this.fieldEditor.clearBackendSelectionAuthority("programmatic");
		}
		this.fieldEditor.applyDomTextSelection(
			normalizedSelection.anchor,
			normalizedSelection.focus,
		);
	};

	private readAttachedNormalizedSelection(): ReturnType<
		typeof readNormalizedDomProposal
	> {
		if (!this.element) {
			return null;
		}
		const root = resolveEditorRoot(this.element);
		if (!root) {
			return null;
		}
		return readNormalizedDomProposal(root, this.editor);
	}

	// ── Clipboard events ──────────────────────────────────────

	protected handlePointerDown = (): void => {
		this.fieldEditor.notifyGestureEvent?.("pointerdown");
		this.fieldEditor.clearBackendSelectionAuthority("programmatic");
	};
}
