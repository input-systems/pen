import type { PenFieldEditorFocusOptions } from "./controller";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import { FieldInputBackendBase } from "./inputBackendBase";
import { getLogicalInlineText } from "./commandsShared";
import { isNavigationSelectionKey } from "./contenteditableDomHelpers";
import {
	commitEditContextComposition,
	deferEditContextCompositionDelta,
	openEditContextComposition,
	openEditContextCompositionAround,
	updateEditContextComposition,
	type CompositionPaint,
	type EditContextComposition,
} from "./editContextComposition";
import { computeTextDiff } from "./textDiff";
import {
	writeEditContextSelection,
	writeNativeRangeBetween,
	writeNativeRangeFromField,
} from "./selectionProjector";
import {
	resolveEditContextKeyDownRange,
	resolveEditContextTextUpdateRange,
	type EditContextRange,
	type EditContextSelection,
	type TextUpdateRangeResolution,
} from "./editContextSelectionAuthority";
import {
	applyEditContextTextFormats,
	buildEditContextCharacterBounds,
	applyDeltaToLogicalText,
	findTextPosition,
	paintEditContextComposition,
} from "./editContextDom";
import type {
	EditContext,
	EditContextCharacterBoundsUpdateEvent,
	EditContextGlobal,
	EditContextTextFormatUpdateEvent,
	EditContextTextUpdateEvent,
} from "./editContextTypes";
import { authorityOffsetsInBlock } from "./selectionReader";
import { resolveFieldInsertMarks } from "./pendingMarkController";
import { handleEditContextBeforeInput } from "./editContextBeforeInput";
import { handleFieldEditorKeyDown } from "./keyHandling";
import { isHistoryTransactionOrigin } from "./transactionOrigin";
import { getPasteImporters, handleClipboardPaste } from "./clipboard";
import { applyListInputRule } from "./commands";
import { isFieldEditorTextEditingKey } from "../utils/textEntryTarget";
import { applyInlineInputRule } from "./inlineInputRules";
import {
	applyInlineTextDiffInput,
	applyInlineTextInput,
} from "./textInputPipeline";
import { isDomCompositionEvent, isDomNode } from "../utils/domNodes";
import type { FieldEditorTextChangeEvent, FieldEditorTextLike } from "./crdt";

/**
 * Where an EditContext selection write came from. A `text-update` write
 * carries offsets the IME already resolved against the text it just sent, so
 * they are used as given; any other caller's offsets are resolved against the
 * live text, which may still be empty.
 */
export type EditContextSelectionOptions = {
	source?: "text-update";
};

type PendingEditContextTextUpdate = {
	blockId: string;
	text: string;
	originRange: { start: number; end: number };
	selection: EditContextSelection | null;
};

type EditContextTextUpdateInput = {
	blockId: string;
	updateRangeStart: number;
	updateRangeEnd: number;
	text: string;
	selectionStart?: number;
	selectionEnd?: number;
};

export class EditContextBackend extends FieldInputBackendBase {
	protected editContext: EditContext | null = null;
	/**
	 * FE9: the last caret a `textupdate` resolved. EditContext can report a
	 * stale range after it, so it is input to `resolveEditContextTextUpdateRange`
	 * and never projected; a `mapped` `selectionChange`, a pointerdown, a
	 * navigation key and history clear it.
	 */
	protected trustedTypingCaret: EditContextSelection | null = null;
	/**
	 * The field's logical text as `Y.Text` last reported it, followed by
	 * delta so the buffer sync never reads `Y.Text` back (SCALE6).
	 */
	protected modelText = "";

	activate(
		element: HTMLElement,
		ytext: unknown,
		focusOptions?: PenFieldEditorFocusOptions,
	): void {
		this.composition = null;
		this.lastIdleTextUpdate = null;
		this.element = element;
		this.ytext = ytext as FieldEditorTextLike;
		this.fieldEditor.setComposing(false);

		const editContextConstructor = (globalThis as EditContextGlobal)
			.EditContext;
		if (!editContextConstructor) {
			throw new Error(
				"EditContext is not available in this environment.",
			);
		}

		// The buffer is in `Y.Text` index space: one U+FFFC per inline atom.
		const initialText = getLogicalInlineText(this.ytext);
		this.modelText = initialText;
		const initialSelectionOffset = initialText.length;
		this.editContext = new editContextConstructor({
			text: initialText,
			selectionStart: initialSelectionOffset,
			selectionEnd: initialSelectionOffset,
		});

		const ec = this.editContext!;

		(
			element as HTMLElement & { editContext: EditContext | null }
		).editContext = ec;
		element.tabIndex = -1;

		// Chromium fires composition events on the EditContext, before the
		// first `textupdate` and after the last; the element listeners serve
		// an engine that fires them on the element instead.
		this.bindInputEvents(element);
		this.attachment.listen(element, "paste", this.handlePasteEvent);
		this.attachment.listen(element, "pointerdown", this.handlePointerDown);
		this.attachment.listenEditContext(
			ec,
			"compositionstart",
			this.handleCompositionStart,
		);
		this.attachment.listenEditContext(
			ec,
			"compositionend",
			this.handleCompositionEnd,
		);
		this.attachment.listenEditContext(
			ec,
			"textupdate",
			this.handleTextUpdate,
		);
		this.attachment.listenEditContext(
			ec,
			"textformatupdate",
			this.handleTextFormatUpdate,
		);
		this.attachment.listenEditContext(
			ec,
			"characterboundsupdate",
			this.handleCharacterBoundsUpdate,
		);

		this.observeField(this.ytext);
		this.rebuildField();
		this.trustedTypingCaret = null;
		this.updateSelection();
		this.fieldEditor.requestDomFocus(
			element,
			"backend-activate",
			{ preventScroll: true },
			focusOptions,
		);
		this.attachment.listen(
			element,
			"keydown",
			this.handleCompositionCancelKey,
		);
	}

	deactivate(): void {
		// Blur or a click elsewhere ends the composition with its text kept,
		// as Chromium keeps it in the buffer; the caret is no longer this
		// field's to move.
		this.endComposition("commit", { detaching: true });
		this.lastIdleTextUpdate = null;
		const element = this.element;
		this.detach();
		if (element) {
			// After the EditContext listeners are gone, so the browser cannot
			// deliver a textupdate against a context this backend no longer
			// owns.
			(
				element as HTMLElement & {
					editContext: EditContext | null;
				}
			).editContext = null;
			element.removeAttribute("tabindex");
		}
		this.editContext = null;
		this.trustedTypingCaret = null;
		this.fieldEditor.setComposing(false);
	}

	updateSelection(): void {
		const written = this.writeSelectionState();
		if (written && this.element) {
			writeNativeRangeFromField(
				this.element,
				{ blockId: written.blockId, offset: written.anchorOffset },
				{ blockId: written.blockId, offset: written.focusOffset },
			);
		}
	}

	/**
	 * Writes the record into the EditContext buffer only, for a DOM that
	 * already shows it (W3.R6). Returns the written selection when the
	 * record is a text selection in this field; otherwise the buffer caret
	 * goes to the end and nothing is returned.
	 */
	writeSelectionState(): EditContextSelection | null {
		if (!this.editContext || !this.ytext) return null;

		const selection = this.fieldEditor.selection;
		const blockId = this.fieldEditor.focusBlockId;
		if (
			selection?.type === "text" &&
			blockId &&
			selection.anchor.blockId === blockId &&
			selection.focus.blockId === blockId
		) {
			const written = {
				blockId,
				anchorOffset: this.resolveEditContextOffset(
					selection.anchor.offset,
				),
				focusOffset: this.resolveEditContextOffset(
					selection.focus.offset,
				),
			};
			this.setEditContextSelection(written);
			return written;
		}

		const len = this.ytext.length;
		writeEditContextSelection(this.editContext, len, len);
		return null;
	}

	/**
	 * C4: the open composition. One lifecycle per IME composition: it opens
	 * on `compositionstart`, stays open across every `textupdate`, and closes
	 * once — `compositionend` with text commits it, an empty `compositionend`
	 * or `Escape` drops it, and deactivation commits what it holds.
	 */
	protected composition: EditContextComposition | null = null;
	/**
	 * The last `textupdate` applied with no composition open, until another
	 * `Y.Text` change follows it. A `textformatupdate` right after it, with no
	 * `compositionstart` before it, makes it a composition's first update
	 * (C1).
	 */
	protected lastIdleTextUpdate: PendingEditContextTextUpdate | null = null;

	protected holdsComposition(): boolean {
		return this.composition !== null;
	}

	protected handleCompositionStart = (): void => {
		this.beginComposition();
	};

	protected handleCompositionEnd = (event?: Event): void => {
		const committed = isDomCompositionEvent(event) ? (event.data ?? "") : "";
		this.endComposition(committed.length === 0 ? "drop" : "commit");
	};

	protected handleCompositionCancelKey = (event: KeyboardEvent): void => {
		if (event.key !== "Escape" || !this.composition) {
			return;
		}
		this.endComposition("drop");
	};

	protected beginComposition(): EditContextComposition | null {
		if (this.composition) {
			return this.composition;
		}
		const blockId = this.fieldEditor.focusBlockId;
		if (!this.ytext || !blockId) {
			return null;
		}
		this.lastIdleTextUpdate = null;
		this.composition = openEditContextComposition(
			blockId,
			this.modelText,
		);
		this.fieldEditor.reader?.notifyGesture("compositionstart");
		this.fieldEditor.setComposing(true);
		return this.composition;
	}

	/**
	 * C1: a `textformatupdate` after a `textupdate` that applied with no
	 * `compositionstart` opens the composition around that update: the apply
	 * is rewound at origin `"system"` and the composition holds its text.
	 * The text it replaced stays deleted, so the composition replaces nothing.
	 */
	protected openCompositionAroundLastUpdate(): void {
		const last = this.lastIdleTextUpdate;
		this.lastIdleTextUpdate = null;
		if (!last || !this.ytext) {
			return;
		}
		const opened = this.beginComposition();
		if (!opened || opened.blockId !== last.blockId) {
			return;
		}
		const start = last.originRange.start;
		this.editor.apply(
			[
				{
					type: "splice-text",
					blockId: last.blockId,
					from: start,
					to: start + last.text.length,
					insert: "",
				},
			],
			{ origin: "system" },
		);
		// The rewind is the composition's own edit: its base text and its
		// deferral list start after it.
		this.composition = openEditContextCompositionAround(
			last.blockId,
			this.modelText,
			start,
			last.text,
		);
	}

	/**
	 * C4: a `textupdate` inside the open composition is held and painted
	 * into the field, never applied. Before any deferred delta the buffer is
	 * `Y.Text`, so the authority resolves the first update's range (FE9);
	 * after one the buffer's own range is taken.
	 */
	protected updateComposition(
		composition: EditContextComposition,
		input: EditContextTextUpdateInput,
	): void {
		const firstRange =
			composition.replaced === null && composition.deferred.length === 0
				? this.resolveTextUpdateRange(input).range
				: undefined;
		const updated = updateEditContextComposition(
			composition,
			{
				start: input.updateRangeStart,
				end: input.updateRangeEnd,
				text: input.text,
			},
			firstRange,
		);
		this.composition = this.paintComposition(
			updated.composition,
			updated.paint,
		);
	}

	protected paintComposition(
		composition: EditContextComposition,
		paint: CompositionPaint,
	): EditContextComposition {
		if (!this.element || !this.ytext || composition.field === "model") {
			return composition;
		}
		if (
			paintEditContextComposition(
				this.element,
				paint,
				this.editor.schema,
				urlPolicyFromEditor(this.editor),
			)
		) {
			return { ...composition, field: "composed" };
		}
		// The field could not take the edit in place: it shows `Y.Text`
		// until the composition closes and rebuilds it.
		this.rebuildField();
		return { ...composition, field: "model" };
	}

	/**
	 * C4: closes the open composition. A commit applies its text once, as
	 * `"user"`, over the range it replaced, rebased over the deferred deltas
	 * (C2); a drop applies nothing, and the caret returns to the record,
	 * which stayed on the composition start. The buffer and the field then
	 * take `Y.Text` once. `detaching` is deactivation: the field is losing
	 * focus, so nothing is written back into its buffer or selection.
	 */
	protected endComposition(
		outcome: "commit" | "drop",
		options?: { detaching?: boolean },
	): void {
		if (!this.composition) {
			return;
		}
		const detaching = options?.detaching === true;
		if (outcome === "commit") {
			// Still open while it applies, so its own delta is deferred with
			// the rest instead of reconciled into the composed field.
			this.commitComposition(this.composition, !detaching);
		}
		const composition = this.composition;
		this.composition = null;
		this.fieldEditor.setComposing(false);
		// A decoration change the composition deferred rebuilds the field
		// even when the composition left it as it was.
		if (
			this.element &&
			this.ytext &&
			(composition.field !== "base" ||
				composition.deferred.length > 0 ||
				this.decorationsChangedSinceBuild())
		) {
			if (!detaching && this.editContext) {
				syncEditContextBuffer(
					this.editContext,
					this.modelText,
				);
			}
			this.inlineDecorationsSignature = this.getInlineDecorationsSignature();
			this.rebuildField();
			if (!detaching) {
				this.updateSelection();
			}
		}
		if (!detaching) {
			this.fieldEditor.reader?.notifyGesture("compositionend-completed");
		}
	}

	protected commitComposition(
		composition: EditContextComposition,
		syncSelection: boolean,
	): void {
		const commit = commitEditContextComposition(composition);
		const { blockId, replaced, text } = composition;
		if (!commit || !replaced || !this.ytext || !this.editor.getBlock(blockId)) {
			return;
		}
		if (syncSelection && composition.deferred.length === 0) {
			// The plain path: input rules and the W3.R6 buffer caret apply.
			this.applyEditContextTextUpdate({
				blockId,
				text,
				originRange: replaced,
				selection: {
					blockId,
					anchorOffset: commit.caret,
					focusOffset: commit.caret,
				},
			});
			return;
		}
		applyInlineTextDiffInput({
			editor: this.editor,
			fieldEditor: this.fieldEditor,
			blockId,
			diff: commit.diff,
			ytext: this.ytext,
			selection: syncSelection
				? {
						blockId,
						anchorOffset: commit.caret,
						focusOffset: commit.caret,
					}
				: null,
		});
	}

	protected handleTextUpdate = (event: Event): void => {
		if (!this.ytext) return;
		const {
			updateRangeStart,
			updateRangeEnd,
			text,
			selectionStart,
			selectionEnd,
		} = event as EditContextTextUpdateEvent;
		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) return;

		const block = this.editor.getBlock(blockId);
		if (!block) {
			this.fieldEditor.deactivate();
			return;
		}

		const input = {
			blockId,
			updateRangeStart,
			updateRangeEnd,
			text,
			selectionStart,
			selectionEnd,
		};
		if (this.composition) {
			this.updateComposition(this.composition, input);
			return;
		}

		const resolved = this.resolveTextUpdateRange(input);
		const pending = {
			blockId,
			text,
			originRange: resolved.range,
			selection: resolved.selection,
		};
		if (this.applyEditContextTextUpdate(pending)) {
			this.lastIdleTextUpdate = pending;
		}
	};

	/**
	 * Applies one text update as `"user"`. True when the text went in as
	 * given; false when an input rule rewrote it or nothing applied.
	 */
	protected applyEditContextTextUpdate(
		pending: PendingEditContextTextUpdate,
	): boolean {
		if (!this.ytext) {
			return false;
		}
		const { blockId, text, originRange } = pending;
		const range = originRange;
		const listInputRuleTarget = applyListInputRule(this.editor, {
			blockId,
			range,
			text,
		});
		if (listInputRuleTarget) {
			const nextSelection = {
				blockId: listInputRuleTarget.blockId,
				anchorOffset: listInputRuleTarget.anchorOffset,
				focusOffset: listInputRuleTarget.focusOffset,
			};
			this.setEditContextSelection(nextSelection, {
				source: "text-update",
			});
			this.fieldEditor.syncTextSelection(
				listInputRuleTarget.blockId,
				listInputRuleTarget.anchorOffset,
				listInputRuleTarget.focusOffset,
			);
			this.updateSelection();
			return false;
		}

		const inlineInputRuleTarget = applyInlineInputRule(this.editor, {
			blockId,
			offset: range.start,
			text,
		});
		if (inlineInputRuleTarget) {
			this.setEditContextSelection(inlineInputRuleTarget, {
				source: "text-update",
			});
			this.fieldEditor.syncTextSelection(
				inlineInputRuleTarget.blockId,
				inlineInputRuleTarget.anchorOffset,
				inlineInputRuleTarget.focusOffset,
			);
			this.updateSelection();
			return false;
		}

		// A buffer that already holds the edit takes its caret before the
		// apply, so the projection the apply triggers finds it agreeing
		// (W3.R6); every buffer takes it again once `updateText` has run.
		const caret = pending.selection;
		if (
			caret &&
			Math.max(caret.anchorOffset, caret.focusOffset) <=
				(this.editContext?.text.length ?? 0)
		) {
			this.setEditContextSelection(caret, { source: "text-update" });
		}
		const selection = applyInlineTextInput({
			editor: this.editor,
			fieldEditor: this.fieldEditor,
			blockId,
			range,
			text,
			marks: resolveFieldInsertMarks(
				this.fieldEditor.pendingMarks,
				this.editor.schema,
				this.ytext,
				range.start,
			),
			selection: pending.selection,
			syncSelection: pending.selection != null,
		});

		if (pending.selection) {
			this.setEditContextSelection(selection, {
				source: "text-update",
			});
			this.fieldEditor.syncTextSelection(
				blockId,
				selection.anchorOffset,
				selection.focusOffset,
			);
			this.updateSelection();
		}
		return true;
	}

	protected resolveTextUpdateRange(
		input: EditContextTextUpdateInput,
	): TextUpdateRangeResolution {
		return resolveEditContextTextUpdateRange({
			...input,
			// `length` counts inline embeds: an atom-only field is not empty (N1).
			isLogicallyEmpty: (this.ytext?.length ?? 0) === 0,
			authority: this.authorityRangeIn(input.blockId),
			trustedCaret: this.trustedCaretIn(input.blockId),
		});
	}

	protected setEditContextSelection(
		selection: EditContextSelection,
		options?: EditContextSelectionOptions,
	): void {
		const resolvedSelection = {
			blockId: selection.blockId,
			anchorOffset: this.resolveEditContextOffset(
				selection.anchorOffset,
				options,
			),
			focusOffset: this.resolveEditContextOffset(
				selection.focusOffset,
				options,
			),
		};
		if (options?.source === "text-update") {
			this.trustedTypingCaret = resolvedSelection;
		}
		if (!this.editContext) return;
		writeEditContextSelection(
			this.editContext,
			resolvedSelection.anchorOffset,
			resolvedSelection.focusOffset,
		);
	}

	protected resolveEditContextOffset(
		offset: number,
		options?: EditContextSelectionOptions,
	): number {
		// Empty means no logical content: `length` counts inline embeds, so an
		// atom-only field keeps its caret after the atom (N1); `toString()`
		// drops embeds and would clamp it to 0.
		return options?.source !== "text-update" && (this.ytext?.length ?? 0) === 0
			? 0
			: offset;
	}

	selectionSuperseded(): void {
		this.trustedTypingCaret = null;
	}

	/** Whether the EditContext buffer's selection is the authority's (W3.R6). */
	selectionAgreesWithAuthority(): boolean {
		const blockId = this.fieldEditor.focusBlockId;
		if (!this.editContext || !blockId) return true;
		const offsets = authorityOffsetsInBlock(this.editor, blockId);
		return (
			offsets !== null &&
			this.editContext.selectionStart === offsets.start &&
			this.editContext.selectionEnd === offsets.end
		);
	}

	/** The authority's selection in `blockId` (W3.R5). */
	protected authorityRangeIn(blockId: string | null): EditContextRange | null {
		const offsets = blockId
			? authorityOffsetsInBlock(this.editor, blockId)
			: null;
		return offsets && { start: offsets.start, end: offsets.end };
	}

	protected handleTextFormatUpdate = (event: Event): void => {
		if (!this.element) return;

		const ranges =
			(event as EditContextTextFormatUpdateEvent).getTextFormats?.() ??
			[];
		if (!this.composition && this.lastIdleTextUpdate) {
			this.openCompositionAroundLastUpdate();
		}
		applyEditContextTextFormats(this.element, ranges);
	};

	protected handleCharacterBoundsUpdate = (event: Event): void => {
		if (!this.element || !this.editContext) return;

		const { rangeStart, rangeEnd } =
			event as EditContextCharacterBoundsUpdateEvent;
		this.editContext.updateCharacterBounds(
			rangeStart,
			buildEditContextCharacterBounds(this.element, rangeStart, rangeEnd),
		);
	};

	protected handleYTextChange = (event: FieldEditorTextChangeEvent): void => {
		if (!this.editContext || !this.element || !this.ytext) return;
		this.modelText = applyDeltaToLogicalText(this.modelText, event.delta);
		const isHistory = isHistoryTransactionOrigin(event.transaction?.origin);
		if (isHistory) {
			this.trustedTypingCaret = null;
		}
		if (this.composition) {
			// C2: the composing field's buffer and DOM are the IME's until the
			// composition closes; every change waits for it, mapped over at
			// the commit and synced once after it.
			this.composition = deferEditContextCompositionDelta(
				this.composition,
				event.delta,
			);
			return;
		}
		this.lastIdleTextUpdate = null;
		if (isHistory) {
			syncEditContextBuffer(
				this.editContext,
				this.modelText,
			);
			this.rebuildField();
			this.updateSelection();
			return;
		}

		this.reconcileDelta(this.fieldEditor.focusBlockId, event.delta);

		// The buffer takes `Y.Text` by diff: a typed `textupdate` is already
		// in it, while a command, an input rule, or another writer's apply is
		// not, so replaying the delta would duplicate the first.
		syncEditContextBuffer(
			this.editContext,
			this.modelText,
		);

		// Inside the apply the authority still holds the pre-apply caret; the
		// buffer holds the one this backend wrote for its own edit, and P1
		// projects the record once the apply returns.
		this.writeBufferCaretIntoDom();
	};

	/**
	 * Shows the EditContext buffer's caret in the DOM after a local
	 * reconcile inside the apply, where the record still holds the pre-apply
	 * caret; P1 projects the record once the apply returns (FE9, W3.R6).
	 */
	private writeBufferCaretIntoDom(): void {
		if (!this.editContext || !this.element) return;
		// HOST9: a native range written into a field that does not hold focus
		// moves focus into it. A remote change while focus is elsewhere (the
		// body, a host control, another editor) updates the buffer only.
		const active = this.element.ownerDocument.activeElement;
		if (!isDomNode(active) || !this.element.contains(active)) return;
		const start = this.editContext.selectionStart;
		const end = this.editContext.selectionEnd;

		const anchorPoint = findTextPosition(this.element, start);
		const focusPoint =
			start === end ? anchorPoint : findTextPosition(this.element, end);
		if (!anchorPoint || !focusPoint) return;

		writeNativeRangeBetween(this.element, anchorPoint, focusPoint);
	}

	protected handleKeyDown = (event: KeyboardEvent): void => {
		if (!this.editContext || !this.element || !this.ytext) return;
		// C1: keys reach the IME while it composes; neither the reader nor
		// the buffer selection is touched until the composition closes.
		if (this.composition) return;
		if (isNavigationSelectionKey(event)) {
			this.trustedTypingCaret = null;
		}

		const blockId = this.fieldEditor.focusBlockId;
		// W3.R5: the reader catches up first; the key then edits the authority.
		this.fieldEditor.syncDomSelectionRead?.();
		const { range, shouldSyncEditContextSelection } =
			resolveEditContextKeyDownRange({
				authority: this.authorityRangeIn(blockId),
				trustedCaret: this.trustedCaretIn(blockId),
				isTextEditingKey: isFieldEditorTextEditingKey(event),
				bufferRange: this.resolveEditContextSelectionRange(),
			});

		if (shouldSyncEditContextSelection) {
			writeEditContextSelection(this.editContext, range.start, range.end);
		}

		const handled = handleFieldEditorKeyDown({
			event,
			editor: this.editor,
			fieldEditor: this.fieldEditor,
			ytext: this.ytext,
			range,
		});
		if (handled) {
			event.preventDefault();
		}
	};

	protected resolveEditContextSelectionRange(): EditContextRange {
		if (!this.editContext) {
			return { start: 0, end: 0 };
		}

		return {
			start: Math.min(
				this.editContext.selectionStart,
				this.editContext.selectionEnd,
			),
			end: Math.max(
				this.editContext.selectionStart,
				this.editContext.selectionEnd,
			),
		};
	}

	protected handleBeforeInput = (event: InputEvent): void => {
		if (!this.editContext || !this.ytext) return;
		if (this.composition) return;

		if (!this.liveFocusBlockId()) return;

		handleEditContextBeforeInput({
			event,
			editor: this.editor,
			fieldEditor: this.fieldEditor,
		});
	};

	protected handlePasteEvent = (event: ClipboardEvent): void => {
		event.preventDefault();
		handleClipboardPaste(
			event,
			this.editor,
			this.fieldEditor,
			getPasteImporters(this.editor),
		);
	};

	// The root's capture listener already notified the reader (R1).
	protected handlePointerDown = (): void => {
		this.trustedTypingCaret = null;
	};

	/** FE9: the trusted typing caret in `blockId`, when it is collapsed. */
	protected trustedCaretIn(blockId: string | null): number | null {
		const caret = this.trustedTypingCaret;
		return caret?.blockId === blockId &&
			caret.anchorOffset === caret.focusOffset
			? caret.focusOffset
			: null;
	}
}

/**
 * Brings the EditContext buffer to `nextText` with one `updateText` over the
 * changed span, so the buffer outside it is untouched, and clamps the
 * buffer selection to the new length. A buffer that already holds
 * `nextText` is left alone.
 */
function syncEditContextBuffer(
	editContext: EditContext,
	nextText: string,
): void {
	const ops = computeTextDiff(editContext.text, nextText);
	if (ops.length === 0) return;
	const deleted = ops.find((op) => op.type === "delete");
	const inserted = ops.find((op) => op.type === "insert");
	const start = (deleted ?? inserted)!.offset;
	editContext.updateText(
		start,
		start + (deleted?.type === "delete" ? deleted.length : 0),
		inserted?.type === "insert" ? inserted.text : "",
	);
	writeEditContextSelection(
		editContext,
		Math.min(editContext.selectionStart, nextText.length),
		Math.min(editContext.selectionEnd, nextText.length),
	);
}
