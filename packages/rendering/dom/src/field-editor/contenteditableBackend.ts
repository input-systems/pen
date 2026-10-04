import { getLogicalInlineText } from "./commandsShared";
import type { InlineDecoration } from "@input/pen-types";
import { extractTextFromDOM } from "./selectionBridge";
import { computeAnchoredTextDiff, type TextDiffOp } from "./textDiff";
import {
	writeCellTextRange,
	writeNativeRangeFromField,
} from "./selectionProjector";
import { applyListInputRule } from "./commands";
import { isHistoryTransactionOrigin } from "./transactionOrigin";
import {
	applyInlineTextDiffInput,
	applyInlineTextInput,
} from "./textInputPipeline";
import type {
	FieldEditorDelta,
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
import { FieldInputBackendBase } from "./inputBackendBase";
import { mapBeforeInput } from "./beforeinputMap";
import { applyBeforeInputPolicy } from "./commandDispatch";
import { handleFieldEditorKeyDown } from "./keyHandling";
import {
	authorityOffsetsInBlock,
	resolveEditedCellText,
	resolveLiveTextSelection,
} from "./selectionReader";

export class ContentEditableBackend extends FieldInputBackendBase {
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
	/** C1: the authority range at compositionstart, restored by a cancel. */
	protected compositionStartRange: { anchor: number; focus: number } | null =
		null;
	protected deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }> = [];

	activate(element: HTMLElement, ytext: unknown): void {
		const activeYText = ytext as FieldEditorTextLike;
		this.ytext = activeYText;
		this.attachEditableHost(element);
		this.resetInputState();

		this.bindInputEvents(element);
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

		this.observeField(activeYText);
		this.rebuildField();
		this.updateSelection();
		this.discardObservedMutations();
	}

	protected override discardObservedMutations(): void {
		this.mutationObserver?.takeRecords();
	}

	deactivate(): void {
		this.releaseEditableHost();
		this.detach();
		this.mutationObserver = null;
		this.resetInputState();
	}

	private resetInputState(): void {
		this.deferredRemoteDeltas = [];
		this.isComposing = false;
		this.ignoreBrowserMutations = false;
		this.lastWatchdogMismatch = null;
		this.compositionStartText = null;
		this.compositionStartRange = null;
		this.fieldEditor.setComposing(false);
	}

	protected holdsComposition(): boolean {
		return this.isComposing;
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
	updateSelection(): void {
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
		writeNativeRangeFromField(element, restored.anchor, restored.focus);
	}

	protected handleBeforeInput = (event: InputEvent): void => {
		if (this.isComposing) return;
		if (!this.ytext || !this.element) return;
		if (!this.liveFocusBlockId()) return;

		// map decides preventDefault / allow / block; DIRECT_HANDLERS only implement commands
		const mapping = mapBeforeInput(event.inputType);
		if ("policy" in mapping) {
			this.ignoreBrowserMutations = mapping.policy === "block";
			applyBeforeInputPolicy(this.editor, event, mapping);
			return;
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
		const resolve = () => this.resolveCurrentInputRange();
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
		this.compositionStartRange = this.readCompositionStartRange();
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
		} else {
			this.restoreCompositionStartRange(blockId);
		}

		if (this.deferredRemoteDeltas.length > 0) {
			this.deferredRemoteDeltas = [];
			this.rebuildField();
		}

		this.compositionStartText = null;
		this.compositionStartRange = null;
		this.updateSelection();
		this.discardObservedMutations();
	}

	protected readCompositionStartRange(): { anchor: number; focus: number } | null {
		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) return null;
		return authorityOffsetsInBlock(
			this.editor,
			blockId,
			this._getActiveCellCoord(blockId),
		);
	}

	/**
	 * C1: a composition that changed nothing (cancelled, or committed empty)
	 * leaves the authority where it started. The reader followed the browser
	 * caret through the composed run (`ime` window), so the record holds a
	 * caret inside text that no longer exists.
	 */
	protected restoreCompositionStartRange(blockId: string): void {
		const range = this.compositionStartRange;
		if (!range) return;
		const anchor = mapOffsetThroughRemoteDeltas(
			range.anchor,
			this.deferredRemoteDeltas,
		);
		const focus = mapOffsetThroughRemoteDeltas(
			range.focus,
			this.deferredRemoteDeltas,
		);
		const cell = this._getActiveCellCoord(blockId);
		if (cell) {
			this.fieldEditor.syncCellTextSelection(cell, anchor, focus);
		} else {
			this.fieldEditor.syncTextSelection(blockId, anchor, focus);
		}
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
		this.rebuildField(undefined, blockId);
	};

	// ── CRDT→DOM reconciliation ───────────────────────────────

	protected handleYTextChange = (event: FieldEditorTextChangeEvent): void => {
		if (this.isComposing) {
			// C2: nothing the composition produces reaches `Y.Text` before
			// compositionend, so every delta now is someone else's edit.
			this.deferredRemoteDeltas.push({ delta: event.delta });
			return;
		}
		if (!this.element || !this.ytext) return;
		const blockId = this.fieldEditor.focusBlockId;
		if (isHistoryTransactionOrigin(event.transaction?.origin)) {
			this.rebuildField();
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

	/** Table cells cannot take a delta patch either. */
	protected override requiresFullReconcile(
		blockId: string | null,
		inlineDecorations: readonly InlineDecoration[],
	): boolean {
		return (
			(blockId ? !!this._getActiveCellCoord(blockId) : false) ||
			super.requiresFullReconcile(blockId, inlineDecorations)
		);
	}

	protected applyTextDiffAsOps(
		blockId: string,
		diff: TextDiffOp[],
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

		this.rebuildField();
		this.inlineDecorationsSignature = nextInlineDecorationsSignature;
		return true;
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
			range: this.resolveCurrentInputRange(),
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
	resolveCurrentInputRange(): {
		start: number;
		end: number;
	} | null {
		const blockId = this.fieldEditor.focusBlockId;
		if (!this.element || !blockId) return null;
		this.fieldEditor.syncDomSelectionRead?.();
		// A field activated with no caret in the record takes the browser's.
		return (
			authorityOffsetsInBlock(
				this.editor,
				blockId,
				this._getActiveCellCoord(blockId),
			) ?? this.liveFieldOffsets()
		);
	}

	/** The reader's live range inside this field (S1). */
	private liveFieldOffsets(): { start: number; end: number } | null {
		const element = this.element;
		return element
			? (this.fieldEditor.readFieldSelectionOffsets?.(element) ?? null)
			: null;
	}

	// ── Clipboard events ──────────────────────────────────────

	// R1: an active table cell carries `ignorePointerGesture`, so the root's
	// capture listener skips it; this is the cell's only pointerdown notify.
	protected handlePointerDown = (): void => {
		this.fieldEditor.notifyGestureEvent?.("pointerdown");
	};
}
