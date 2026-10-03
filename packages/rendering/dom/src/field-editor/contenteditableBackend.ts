import { getLogicalInlineText } from "./commandsShared";
import type { Editor, InlineDecoration } from "@input/pen-types";
import type { FieldEditorInputController } from "./controller";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import {
	buildInlineDecorationsRenderSignature,
	inlineDecorationsForBlock,
	inlineDecorationsRequireFullReconcile,
} from "../utils/inlineDecorations";
import { fullReconcileToDOM, applyDeltaToDOM } from "./reconciler";
import { extractTextFromDOM } from "./selectionBridge";
import { computeAnchoredTextDiff } from "./textDiff";
import { writeCellTextRange, writeNativeRange } from "./selectionProjector";
import { applyListInputRule } from "./commands";
import {
	isCollaboratorTransaction,
	isHistoryTransactionOrigin,
} from "./transactionOrigin";
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
	mapOffsetThroughRemoteDeltas,
	rebaseTextDiffOps,
	caretAfterRebasedDiff,
	requiresResolvedInputRange,
} from "./contenteditableDomHelpers";
import { BackendAttachment } from "./backendAttachment";
import { bindBackendTransferEvents } from "./backendTransferEvents";
import { mapBeforeInput } from "./beforeinputMap";
import { handleFieldEditorKeyDown } from "./keyHandling";
import {
	authorityOffsetsInBlock,
	resolveEditedCellText,
	resolveLiveTextSelection,
} from "./selectionReader";

export class ContentEditableBackend {
	protected element: HTMLElement | null = null;
	protected ytext: FieldEditorTextLike | null = null;
	protected observer: FieldEditorObserver | null = null;
	protected mutationObserver: MutationObserver | null = null;
	protected isComposing = false;
	/**
	 * B1 watchdog state, not selection state: after a block-policy
	 * `beforeinput` the browser's leftovers are restored without a
	 * `dom-divergence`, and one mismatch is reported once.
	 */
	protected ignoreBrowserMutations = false;
	protected lastWatchdogMismatch: string | null = null;
	protected compositionStartText: string | null = null;
	/** C2: start of the authority selection at compositionstart, a logical offset. */
	protected compositionStartOffset = 0;
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
		element.tabIndex = -1;
		this.isComposing = false;
		this.ignoreBrowserMutations = false;
		this.lastWatchdogMismatch = null;
		this.compositionStartText = null;
		this.fieldEditor.setComposing(false);

		this.attachment.listen(element, "beforeinput", this.handleBeforeInput);
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
		this.attachment.listen(element, "pointerdown", this.handlePointerDown);

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
			this.editor.on("decorationsChange", this.handleDecorationsChange),
		);
		this.inlineDecorationsSignature = this.getInlineDecorationsSignature();

		fullReconcileToDOM(activeYText, element, this.editor.schema, {
			urlPolicy: urlPolicyFromEditor(this.editor),
			inlineDecorations: this.getInlineDecorationsForBlock(),
		});
		this.fieldEditor.notifyDomReconciled(
			this.fieldEditor.focusBlockId ?? undefined,
		);
		this.updateSelection();
		this.discardObservedMutations();
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
			this.element.removeAttribute("tabindex");
		}
		this.attachment.release();
		this.mutationObserver = null;
		this.element = null;
		this.ytext = null;
		this.observer = null;
		this.inlineDecorationsSignature = null;
		this.deferredRemoteDeltas = [];
		this.isComposing = false;
		this.ignoreBrowserMutations = false;
		this.lastWatchdogMismatch = null;
		this.compositionStartText = null;
		this.fieldEditor.setComposing(false);
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
		this.updateSelection();
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
			this.fieldEditor.syncTextSelection(
				blockId,
				selection.anchor.offset,
				selection.focus.offset,
			);
		}
		this.ensureActiveDOMMatchesYText();
		this.updateSelection();
	}

	applyListInputRule(options: {
		blockId: string;
		range: { start: number; end: number };
		text: string;
	}): boolean {
		const target = applyListInputRule(this.editor, options);
		if (!target) return false;

		this.fieldEditor.syncTextSelection(
			target.blockId,
			target.anchorOffset,
			target.focusOffset,
		);
		this.updateSelection();
		return true;
	}

	/**
	 * Writes the authority's record into this field: the edited cell's
	 * `CellSelection.text`, else a text selection inside the focused block.
	 * The projector calls it; so do this backend's own rebuilds.
	 */
	updateSelection(_relPos?: unknown): void {
		const element = this.element;
		if (!element) return;

		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) return;
		const activeCell = this._getActiveCellCoord(blockId);
		if (activeCell) {
			const text = resolveEditedCellText(
				this.editor.selection,
				blockId,
				activeCell,
			);
			if (!text) return;
			writeCellTextRange(element, text);
			return;
		}
		const restored = resolveLiveTextSelection(
			this.editor.selection,
			blockId,
			activeCell,
		);
		if (!restored) return;
		const { anchor, focus } = restored;

		const root = element.closest(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		if (!root) return;

		writeNativeRange(root, anchor, focus);
	}

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
		const resolve = () => this.resolveLiveInputRange();
		if (canResolveInputRange(event, this.element, resolve)) {
			return true;
		}

		this.updateSelection();

		return canResolveInputRange(event, this.element, resolve);
	}

	// ── Composition handling ──────────────────────────────────

	protected handleCompositionStart = (): void => {
		if (this.compositionStartText != null) {
			this.reconcileAfterComposition();
			this.fieldEditor.notifyGestureEvent?.("compositionend-completed");
		}
		this.isComposing = true;
		this.ignoreBrowserMutations = false;
		this.compositionStartText = this.ytext ? getLogicalInlineText(this.ytext) : "";
		this.compositionStartOffset = this.readCompositionStartOffset();
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
		const baseText =
			this.compositionStartText ?? getLogicalInlineText(this.ytext);

		if (domText !== baseText) {
			const diff = rebaseTextDiffOps(
				computeAnchoredTextDiff(baseText, domText, this.compositionStartOffset),
				this.deferredRemoteDeltas,
				baseText.length,
			);
			// With deferred remote text the DOM caret predates it; the caret
			// goes to the end of the composed text as rebased (C2).
			const caret =
				this.deferredRemoteDeltas.length > 0 ? caretAfterRebasedDiff(diff) : null;
			this.applyTextDiffAsOps(blockId, diff, this.deferredRemoteDeltas, caret);
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
		this.updateSelection();
		this.discardObservedMutations();
	}

	/** The start of the authority's text selection in this field, else the DOM caret. */
	protected readCompositionStartOffset(): number {
		const selection = this.editor.selection;
		const blockId = this.fieldEditor.focusBlockId;
		if (selection?.type === "text" && selection.focus.blockId === blockId) {
			return selection.anchor.blockId === blockId
				? Math.min(selection.anchor.offset, selection.focus.offset)
				: selection.focus.offset;
		}
		return this.liveFieldOffsets()?.start ?? 0;
	}

	// ── Mutation observer watchdog ────────────────────────────

	protected handleMutations = (_mutations: MutationRecord[]): void => {
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
		const crdtText = getLogicalInlineText(this.ytext);
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
		// contenteditable. The rebuild's own records are taken here, so the
		// observer never sees them.
		fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
			urlPolicy: urlPolicyFromEditor(this.editor),
			inlineDecorations: this.getInlineDecorationsForBlock(),
		});
		this.discardObservedMutations();
		this.fieldEditor.notifyDomReconciled(blockId);
	};

	// ── CRDT→DOM reconciliation ───────────────────────────────

	protected handleYTextChange = (event: FieldEditorTextChangeEvent): void => {
		if (this.isComposing) {
			this.deferCollaboratorDelta(event);
			return;
		}
		if (!this.element || !this.ytext) return;
		const blockId = this.fieldEditor.focusBlockId;
		if (isHistoryTransactionOrigin(event.transaction?.origin)) {
			this.fullReconcileActiveField(blockId);
			this.updateSelection();
		} else {
			this.reconcileDeltaAndProject(blockId, event.delta);
		}
		this.discardObservedMutations();
	};

	/** A full rebuild projects the record (P3). */
	protected reconcileDeltaAndProject(
		blockId: string | null,
		delta: FieldEditorDelta[],
	): void {
		const rebuilt = this.reconcileDelta(blockId, delta);
		if (!rebuilt || !blockId) {
			return;
		}
		this.fieldEditor.projectAfterRebuild?.([blockId]);
	}

	/** C2: a collaborator delta during composition waits for compositionend. */
	protected deferCollaboratorDelta(event: FieldEditorTextChangeEvent): void {
		if (isCollaboratorTransaction(event.transaction)) {
			this.deferredRemoteDeltas.push({ delta: event.delta });
		}
	}

	/** Patches the field with `delta`; true when it fell back to a full rebuild. */
	protected reconcileDelta(
		blockId: string | null,
		delta: FieldEditorDelta[],
	): boolean {
		const inlineDecorations = this.getInlineDecorationsForBlock();
		if (this.requiresFullReconcile(blockId, inlineDecorations)) {
			this.fullReconcileActiveField(blockId, inlineDecorations);
			return true;
		}
		const applied = applyDeltaToDOM(
			delta,
			this.element!,
			this.editor.schema,
			urlPolicyFromEditor(this.editor),
		);
		if (!applied) {
			this.fullReconcileActiveField(blockId);
		}
		return !applied;
	}

	/** Table cells and decorations that split text runs cannot take a delta patch. */
	protected requiresFullReconcile(
		blockId: string | null,
		inlineDecorations: readonly InlineDecoration[],
	): boolean {
		const isActiveCell = blockId
			? !!this._getActiveCellCoord(blockId)
			: false;
		return (
			isActiveCell ||
			inlineDecorationsRequireFullReconcile(inlineDecorations)
		);
	}

	protected fullReconcileActiveField(
		blockId: string | null,
		inlineDecorations = this.getInlineDecorationsForBlock(),
	): void {
		if (!this.element || !this.ytext) return;
		fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
			urlPolicy: urlPolicyFromEditor(this.editor),
			inlineDecorations,
		});
		this.fieldEditor.notifyDomReconciled(blockId ?? undefined);
	}

	protected applyTextDiffAsOps(
		blockId: string,
		diff: InlineTextDiffOp[],
		deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }> = [],
		caretOverride: number | null = null,
	): void {
		if (diff.length === 0) return;
		const ytext = this.ytext;
		if (!ytext) return;

		const cellCoord = this._getActiveCellCoord(blockId);
		// C2: the caret the browser left after its own edit, before the
		// diff reaches the model; the authority cannot answer it yet.
		const domCaret = this.liveFieldOffsets();
		const selection = caretOverride !== null
			? {
					blockId,
					anchorOffset: caretOverride,
					focusOffset: caretOverride,
					cell: cellCoord
						? { row: cellCoord.row, col: cellCoord.col }
						: undefined,
				}
			: domCaret
			? {
					blockId,
					// The DOM caret predates deferred remote deltas (C2); map it
					// the same way the diff was rebased.
					anchorOffset: mapOffsetThroughRemoteDeltas(
						domCaret.start,
						deferredRemoteDeltas,
					),
					focusOffset: mapOffsetThroughRemoteDeltas(
						domCaret.end,
						deferredRemoteDeltas,
					),
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
		this.updateSelection();
	}

	protected ensureActiveDOMMatchesYText(): boolean {
		if (!this.element || !this.ytext) return false;
		const nextInlineDecorationsSignature =
			this.getInlineDecorationsSignature();
		if (
			extractTextFromDOM(this.element) === getLogicalInlineText(this.ytext) &&
			nextInlineDecorationsSignature === this.inlineDecorationsSignature
		) {
			return false;
		}

		fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
			urlPolicy: urlPolicyFromEditor(this.editor),
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
		if (this.ensureActiveDOMMatchesYText() && projectSelection) {
			this.updateSelection();
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

		const handled = handleFieldEditorKeyDown({
			event,
			editor: this.editor,
			fieldEditor: this.fieldEditor,
			ytext: this.ytext,
			// The authority after a reader sync, not the live DOM range (W35.R18).
			range: this.resolveLiveInputRange(),
		});
		if (handled) {
			event.preventDefault();
			return;
		}
	};

	/**
	 * The range an input edits: the authority after a reader sync (W3.R5),
	 * the edited cell's `CellSelection.text` in a cell (W3.R18). A field
	 * activated without a caret in the authority still reads the field,
	 * where the browser's caret is the only one.
	 */
	resolveLiveInputRange(): {
		start: number;
		end: number;
	} | null {
		const blockId = this.fieldEditor.focusBlockId;
		if (!this.element || !blockId) return null;
		this.fieldEditor.syncDomSelectionRead?.();
		return (
			authorityOffsetsInBlock(
				this.editor,
				blockId,
				this._getActiveCellCoord(blockId),
			) ?? this.unclaimedFieldCaretOffsets()
		);
	}

	// A field activated with no caret in the record takes the browser's.
	private unclaimedFieldCaretOffsets(): {
		start: number;
		end: number;
	} | null {
		return this.liveFieldOffsets();
	}

	/** The reader's live range inside this field (S1). */
	private liveFieldOffsets(): { start: number; end: number } | null {
		const element = this.element;
		return element
			? (this.fieldEditor.readFieldSelectionOffsets?.(element) ?? null)
			: null;
	}

	resolveCurrentInputRange(): {
		start: number;
		end: number;
	} | null {
		return this.resolveLiveInputRange();
	}

	// ── Clipboard events ──────────────────────────────────────

	protected handlePointerDown = (): void => {
		this.fieldEditor.notifyGestureEvent?.("pointerdown");
	};
}
