import { isCollapsed } from "@input/pen-core";
import type { Editor, InlineDecoration } from "@input/pen-types";
import type {
	FieldEditorInputController,
	PenFieldEditorFocusOptions,
} from "./controller";
import { BackendAttachment } from "./backendAttachment";
import { bindBackendTransferEvents } from "./backendTransferEvents";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import { applyDeltaToDOM } from "./reconciler";
import {
	focusedFieldDecorations,
	focusedFieldDecorationsSignature,
	rebuildFocusedField,
} from "./fieldDomRebuild";
import { getLogicalInlineText } from "./commandsShared";
import {
	isNavigationSelectionKey,
	mapOffsetThroughRemoteDeltas,
	mapOffsetThroughRemoteDeltasUpstream,
} from "./contenteditableDomHelpers";
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
	type KeyDownRangeResolution,
} from "./editContextSelectionAuthority";
import {
	applyEditContextTextFormats,
	buildEditContextCharacterBounds,
	findTextPosition,
	shouldReplaceEditContextText,
} from "./editContextDom";
import type {
	EditContext,
	EditContextCharacterBoundsUpdateEvent,
	EditContextGlobal,
	EditContextTextFormatUpdateEvent,
	EditContextTextUpdateEvent,
} from "./editContextTypes";
import { authorityOffsetsInBlock } from "./selectionReader";
import type { DirectionalSelectionOffsets } from "./selectionMapping";
import { inlineDecorationsRequireFullReconcile } from "../utils/inlineDecorations";
import { handleEditContextBeforeInput } from "./editContextBeforeInput";
import { handleFieldEditorKeyDown } from "./keyHandling";
import {
	isCollaboratorTransaction,
	isHistoryTransactionOrigin,
} from "./transactionOrigin";
import { getPasteImporters, handleClipboardPaste } from "./clipboard";
import { applyListInputRule } from "./commands";
import { isFieldEditorTextEditingKey } from "../utils/textEntryTarget";
import { applyInlineInputRule } from "./inlineInputRules";
import { applyInlineTextInput } from "./textInputPipeline";
import type {
	FieldEditorDelta,
	FieldEditorObserver,
	FieldEditorTextChangeEvent,
	FieldEditorTextLike,
} from "./crdt";

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
	selectionStart?: number;
	selectionEnd?: number;
};

export class EditContextBackend {
	protected editContext: EditContext | null = null;
	protected element: HTMLElement | null = null;
	protected ytext: FieldEditorTextLike | null = null;
	protected observer: FieldEditorObserver | null = null;
	protected readonly attachment = new BackendAttachment();
	protected inlineDecorationsSignature: readonly InlineDecoration[] | null =
		null;
	protected editor: Editor;
	protected fieldEditor: FieldEditorInputController;
	/**
	 * FE9: the last caret a `textupdate` resolved. EditContext can report a
	 * stale range after it, so it is input to `resolveEditContextTextUpdateRange`
	 * and never projected; a `mapped` `selectionChange`, a pointerdown, a
	 * navigation key and history clear it.
	 */
	protected trustedTypingCaret: EditContextSelection | null = null;

	constructor(editor: Editor, fieldEditor: FieldEditorInputController) {
		this.editor = editor;
		this.fieldEditor = fieldEditor;
	}

	activate(
		element: HTMLElement,
		ytext: unknown,
		focusOptions?: PenFieldEditorFocusOptions,
	): void {
		this.deferredRemoteDeltas = [];
		this.clearPendingTextUpdate();
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

		const initialText = this.ytext.toString();
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

		this.attachment.listen(element, "keydown", this.handleKeyDown);
		this.attachment.listen(element, "beforeinput", this.handleBeforeInput);
		this.attachment.listen(element, "paste", this.handlePasteEvent);
		bindBackendTransferEvents(
			this.attachment,
			element,
			this.editor,
			this.fieldEditor,
		);
		this.attachment.listen(element, "pointerdown", this.handlePointerDown);
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

		this.observer = (event) => this.handleYTextChange(event);
		this.attachment.observeText(this.ytext, this.observer);
		this.attachment.subscribe(
			this.editor.on("decorationsChange", this.handleDecorationsChange),
		);
		this.inlineDecorationsSignature = this.getInlineDecorationsSignature();

		this.reconcileFullAndNotify(this.ytext, element);
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
		this.deferredRemoteDeltas = [];
		this.clearPendingTextUpdate();
		this.attachment.release();
		if (this.element) {
			// After the EditContext listeners are gone, so the browser cannot
			// deliver a textupdate against a context this backend no longer
			// owns.
			(
				this.element as HTMLElement & {
					editContext: EditContext | null;
				}
			).editContext = null;
			this.element.removeAttribute("tabindex");
		}
		this.editContext = null;
		this.element = null;
		this.ytext = null;
		this.observer = null;
		this.inlineDecorationsSignature = null;
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
	 * C4 composition state. `committed-awaiting-format` drops the one
	 * `textformatupdate` Chromium sends after a commit or an empty
	 * `compositionend`; without it, the rewind would re-open the committed
	 * text as a composition. A new composition supersedes it.
	 */
	protected compositionPhase:
		"idle" | "composing" | "committed-awaiting-format" = "idle";
	protected deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }> = [];
	protected pendingTextUpdate: PendingEditContextTextUpdate | null = null;
	protected lastCommittedTextUpdate: PendingEditContextTextUpdate | null =
		null;
	protected paintedCompositionPreview = false;

	protected handleCompositionStart = (): void => {
		this.beginEditContextComposition();
	};

	protected handleCompositionEnd = (event?: Event): void => {
		const committed =
			event instanceof CompositionEvent ? (event.data ?? "") : "";
		if (this.pendingTextUpdate) {
			if (committed.length === 0) {
				this.dropPendingTextUpdate();
				this.compositionPhase = "committed-awaiting-format";
			} else {
				this.commitPendingTextUpdate();
			}
		}
		this.closeEditContextComposition();
	};

	protected handleCompositionCancelKey = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") {
			return;
		}
		if (
			!this.pendingTextUpdate ||
			!this.hasInFlightEditContextComposition()
		) {
			return;
		}
		this.dropPendingTextUpdate();
		this.closeEditContextComposition();
	};

	protected hasInFlightEditContextComposition(): boolean {
		return (
			this.compositionPhase === "composing" ||
			this.fieldEditor.isComposing
		);
	}

	protected beginEditContextComposition(): void {
		if (this.compositionPhase === "composing") {
			return;
		}
		this.compositionPhase = "composing";
		this.deferredRemoteDeltas = [];
		this.fieldEditor.notifyGestureEvent?.("compositionstart");
		this.fieldEditor.setComposing(true);
	}

	protected closeEditContextComposition(): void {
		if (this.compositionPhase === "composing") {
			this.compositionPhase = "idle";
		}
		this.fieldEditor.setComposing(false);
		this.flushDeferredRemoteDeltas();
		this.fieldEditor.notifyGestureEvent?.("compositionend-completed");
	}

	protected clearPendingTextUpdate(): void {
		this.pendingTextUpdate = null;
		this.lastCommittedTextUpdate = null;
		this.compositionPhase = "idle";
		this.paintedCompositionPreview = false;
	}

	protected capturePendingTextUpdate(input: {
		blockId: string;
		updateRangeStart: number;
		updateRangeEnd: number;
		text: string;
		selectionStart?: number;
		selectionEnd?: number;
	}): PendingEditContextTextUpdate {
		const resolved =
			this.compositionPhase === "composing" &&
			this.deferredRemoteDeltas.length > 0
				? this.resolveRebasedTextUpdateRange(input)
				: this.resolveTextUpdateRange(input);
		return {
			blockId: input.blockId,
			text: input.text,
			originRange: resolved.range,
			selection: resolved.selection,
			selectionStart: input.selectionStart,
			selectionEnd: input.selectionEnd,
		};
	}

	protected rewindLastCommittedIntoPending(): void {
		const last = this.lastCommittedTextUpdate;
		if (!last || last.text.length === 0) {
			this.lastCommittedTextUpdate = null;
			return;
		}
		this.editor.apply(
			[
				{
					type: "splice-text",
					blockId: last.blockId,
					from: last.originRange.start,
					to: last.originRange.start + last.text.length,
					insert: "",
				},
			],
			{ origin: "system" },
		);
		this.pendingTextUpdate = last;
		this.lastCommittedTextUpdate = null;
		this.paintedCompositionPreview = true;
	}

	protected dropPendingTextUpdate(): void {
		if (this.paintedCompositionPreview && this.element && this.ytext) {
			this.reconcileFullAndNotify(this.ytext, this.element);
			this.updateSelection();
		}
		this.pendingTextUpdate = null;
		this.lastCommittedTextUpdate = null;
		this.paintedCompositionPreview = false;
	}

	protected commitPendingTextUpdate(): void {
		const pending = this.pendingTextUpdate;
		if (!pending) {
			return;
		}
		this.pendingTextUpdate = null;
		this.lastCommittedTextUpdate = null;
		this.paintedCompositionPreview = false;
		// The apply still runs inside the composition (C2 rebase, deferred
		// local echo); the phase moves once it has.
		this.applyEditContextTextUpdate(this.rebasePendingTextUpdate(pending));
		this.compositionPhase = "committed-awaiting-format";
	}

	/**
	 * C2: a pending update holds buffer offsets from before the composition's
	 * remote deltas (it is captured when the composition opens, and the
	 * deferral list starts empty there), so it is mapped through all of them
	 * before it applies: start downstream, end upstream.
	 */
	protected rebasePendingTextUpdate(
		pending: PendingEditContextTextUpdate,
	): PendingEditContextTextUpdate {
		const deltas = this.deferredRemoteDeltas;
		if (this.compositionPhase !== "composing" || deltas.length === 0) {
			return pending;
		}
		const { start, end, caret } = rebaseBufferRange(
			pending.originRange.start,
			pending.originRange.end,
			pending.text.length,
			deltas,
		);
		return {
			...pending,
			originRange: { start, end },
			selection: { blockId: pending.blockId, anchorOffset: caret, focusOffset: caret },
			selectionStart: caret,
			selectionEnd: caret,
		};
	}

	protected flushDeferredRemoteDeltas(): void {
		if (this.deferredRemoteDeltas.length === 0) {
			return;
		}
		this.deferredRemoteDeltas = [];
		if (!this.editContext || !this.element || !this.ytext) {
			return;
		}
		resyncEditContextSpan(this.editContext, getLogicalInlineText(this.ytext));
		this.reconcileFullAndNotify(this.ytext, this.element);
		this.updateSelection();
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

		if (
			this.pendingTextUpdate &&
			this.hasInFlightEditContextComposition()
		) {
			if (text.length === 0) {
				this.dropPendingTextUpdate();
				this.compositionPhase = "committed-awaiting-format";
				this.closeEditContextComposition();
				return;
			}
			this.pendingTextUpdate = {
				...this.pendingTextUpdate,
				text,
				selection:
					selectionStart != null && selectionEnd != null
						? {
								blockId,
								anchorOffset: selectionStart,
								focusOffset: selectionEnd,
							}
						: this.pendingTextUpdate.selection,
				selectionStart,
				selectionEnd,
			};
			this.commitPendingTextUpdate();
			this.closeEditContextComposition();
			return;
		}

		const pending = this.capturePendingTextUpdate({
			blockId,
			updateRangeStart,
			updateRangeEnd,
			text,
			selectionStart,
			selectionEnd,
		});
		this.applyEditContextTextUpdate(pending);
		this.lastCommittedTextUpdate = pending;
	};

	protected applyEditContextTextUpdate(
		pending: PendingEditContextTextUpdate,
	): void {
		if (!this.ytext) {
			return;
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
			return;
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
			return;
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
			marks: this.fieldEditor.resolveInsertMarks(this.ytext, range.start),
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
	}

	/**
	 * C2: mid-composition, remote text has entered `Y.Text` but not the
	 * EditContext buffer, so the event's buffer range is mapped onto `Y.Text`
	 * through the deferred deltas — start downstream, end upstream, the
	 * contenteditable rebase's association — before the speculative apply.
	 * The IME's own range is the source here; the authority's selection is
	 * already in `Y.Text` space and would be mapped twice.
	 */
	protected resolveRebasedTextUpdateRange(input: {
		blockId: string;
		updateRangeStart: number;
		updateRangeEnd: number;
		text: string;
		selectionStart?: number;
		selectionEnd?: number;
	}): {
		range: { start: number; end: number };
		selection: EditContextSelection | null;
	} {
		const { start, end, caret } = rebaseBufferRange(
			input.updateRangeStart,
			input.updateRangeEnd,
			input.text.length,
			this.deferredRemoteDeltas,
		);
		return {
			range: { start, end },
			selection: { blockId: input.blockId, anchorOffset: caret, focusOffset: caret },
		};
	}

	protected resolveTextUpdateRange(input: {
		blockId: string;
		updateRangeStart: number;
		updateRangeEnd: number;
		text: string;
		selectionStart?: number;
		selectionEnd?: number;
	}): {
		range: { start: number; end: number };
		selection: EditContextSelection | null;
	} {
		const selection = this.fieldEditor.selection;
		const editorCaret =
			selection?.type === "text" &&
			isCollapsed(selection) &&
			selection.focus.blockId === input.blockId
				? selection.focus.offset
				: null;

		return resolveEditContextTextUpdateRange({
			...input,
			// `length` counts inline embeds: an atom-only field is not empty (N1).
			isLogicallyEmpty: (this.ytext?.length ?? 0) === 0,
			editorSelectionRange: this.resolveEditorSelectionRange(
				input.blockId,
			),
			authoritativeTextInputSelection: this.trustedCaretIn(input.blockId),
			editorCaret,
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

	protected resolveEditorSelectionRange(
		blockId: string,
	): EditContextRange | null {
		const selection = this.fieldEditor.selection;
		if (
			selection?.type !== "text" ||
			isCollapsed(selection) ||
			selection.anchor.blockId !== blockId ||
			selection.focus.blockId !== blockId
		) {
			return null;
		}

		return {
			start: Math.min(selection.anchor.offset, selection.focus.offset),
			end: Math.max(selection.anchor.offset, selection.focus.offset),
		};
	}

	protected handleTextFormatUpdate = (event: Event): void => {
		if (!this.element) return;

		const ranges =
			(event as EditContextTextFormatUpdateEvent).getTextFormats?.() ??
			[];
		if (this.compositionPhase === "committed-awaiting-format") {
			this.compositionPhase = "idle";
			applyEditContextTextFormats(this.element, ranges);
			return;
		}
		this.beginEditContextComposition();
		this.rewindLastCommittedIntoPending();
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
		const isHistory = isHistoryTransactionOrigin(event.transaction?.origin);
		if (!isHistory && this.hasInFlightEditContextComposition()) {
			if (isCollaboratorTransaction(event.transaction)) {
				this.deferredRemoteDeltas.push({ delta: event.delta });
			}
			return;
		}
		if (isHistory) {
			this.trustedTypingCaret = null;
			replaceEditContextText(this.editContext, this.ytext.toString());
			this.reconcileFullAndNotify(this.ytext, this.element);
			this.updateSelection();
			return;
		}

		const inlineDecorations = focusedFieldDecorations(this.editor, this.fieldEditor);
		if (inlineDecorationsRequireFullReconcile(inlineDecorations)) {
			this.reconcileFullAndNotify(
				this.ytext,
				this.element,
				inlineDecorations,
			);
		} else {
			const applied = applyDeltaToDOM(
				event.delta,
				this.element,
				this.editor.schema,
				urlPolicyFromEditor(this.editor),
			);
			if (!applied) {
				this.reconcileFullAndNotify(
					this.ytext,
					this.element,
					inlineDecorations,
				);
			}
		}

		if (
			shouldReplaceEditContextText(
				event.delta,
				this.editContext.text.length,
			)
		) {
			const nextText = this.ytext.toString();
			this.editContext.updateText(
				0,
				this.editContext.text.length,
				nextText,
			);
		} else {
			const delta = event.delta;
			let offset = 0;
			for (const entry of delta) {
				if (entry.retain != null) {
					offset += entry.retain;
				} else if (typeof entry.insert === "string") {
					this.editContext.updateText(offset, offset, entry.insert);
					offset += entry.insert.length;
				} else if (entry.delete != null) {
					this.editContext.updateText(
						offset,
						offset + entry.delete,
						"",
					);
				}
			}
		}

		// Inside the apply the authority still holds the pre-apply caret; the
		// buffer holds the one this backend wrote for its own edit, and P1
		// projects the record once the apply returns.
		this.writeBufferCaretIntoDom();
	};

	protected handleDecorationsChange = (): void => {
		if (!this.element || !this.ytext) {
			return;
		}
		const nextInlineDecorationsSignature =
			this.getInlineDecorationsSignature();
		if (
			nextInlineDecorationsSignature === this.inlineDecorationsSignature
		) {
			return;
		}
		// a decoration can change while another control owns focus; writing
		// the caret back into this field would drag focus along with it
		const projectSelection =
			this.fieldEditor.shouldProjectSelectionAfterReconcile?.() ?? true;
		this.inlineDecorationsSignature = nextInlineDecorationsSignature;
		this.reconcileFullAndNotify(this.ytext, this.element);
		if (projectSelection) {
			this.updateSelection();
		}
	};

	/**
	 * Shows the EditContext buffer's caret in the DOM after a local
	 * reconcile inside the apply, where the record still holds the pre-apply
	 * caret; P1 projects the record once the apply returns (FE9, W3.R6).
	 */
	private writeBufferCaretIntoDom(): void {
		if (!this.editContext || !this.element) return;
		const start = this.editContext.selectionStart;
		const end = this.editContext.selectionEnd;

		const anchorPoint = findTextPosition(this.element, start);
		const focusPoint =
			start === end ? anchorPoint : findTextPosition(this.element, end);
		if (!anchorPoint || !focusPoint) return;

		writeNativeRangeBetween(this.element, anchorPoint, focusPoint);
	}

	private reconcileFullAndNotify(
		ytext: FieldEditorTextLike,
		element: HTMLElement,
		inlineDecorations?: readonly InlineDecoration[],
	): void {
		rebuildFocusedField(
			this.editor,
			this.fieldEditor,
			ytext,
			element,
			inlineDecorations,
		);
	}

	protected getInlineDecorationsSignature(): readonly InlineDecoration[] {
		return focusedFieldDecorationsSignature(
			this.editor,
			this.fieldEditor,
			this.inlineDecorationsSignature,
		);
	}

	protected handleKeyDown = (event: KeyboardEvent): void => {
		if (!this.editContext || !this.element || !this.ytext) return;
		if (isNavigationSelectionKey(event)) {
			this.trustedTypingCaret = null;
		}

		const blockId = this.fieldEditor.focusBlockId;
		// W3.R5: the reader catches up first; the key then edits the authority.
		this.fieldEditor.syncDomSelectionRead?.();
		const liveDomOffsets = blockId
			? authorityOffsetsInBlock(this.editor, blockId)
			: null;
		const { range, shouldSyncEditContextSelection } =
			this.resolveKeyDownRange(blockId, event, liveDomOffsets);

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

	protected resolveKeyDownRange(
		blockId: string | null,
		event: KeyboardEvent,
		liveDomOffsets: DirectionalSelectionOffsets | null,
	): KeyDownRangeResolution {
		const isTextEditingKey = isFieldEditorTextEditingKey(event);
		return resolveEditContextKeyDownRange({
			blockId,
			isTextEditingKey,
			liveDomOffsets,
			editContextRange: this.resolveEditContextSelectionRange(),
			editorSelectionRange: blockId
				? this.resolveEditorSelectionRange(blockId)
				: null,
			authoritativeTextInputSelection: blockId
				? this.getAuthoritativeTextInputSelection(blockId)
				: null,
			collapsedEditorSelectionRange: blockId
				? this.resolveCollapsedEditorSelectionRange(blockId)
				: null,
		});
	}

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

	protected resolveCollapsedEditorSelectionRange(
		blockId: string,
	): EditContextRange | null {
		const selection = this.fieldEditor.selection;
		if (
			selection?.type === "text" &&
			isCollapsed(selection) &&
			selection.focus.blockId === blockId
		) {
			return {
				start: selection.focus.offset,
				end: selection.focus.offset,
			};
		}

		return null;
	}

	protected handleBeforeInput = (event: InputEvent): void => {
		if (!this.editContext || !this.ytext) return;
		if (this.hasInFlightEditContextComposition()) return;

		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId || !this.editor.getBlock(blockId)) {
			this.fieldEditor.deactivate();
			return;
		}

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

	protected trustedCaretIn(blockId: string): EditContextSelection | null {
		const caret = this.trustedTypingCaret;
		return caret?.blockId === blockId ? caret : null;
	}

	/** The trusted typing caret in `blockId`, when it is collapsed. */
	protected getAuthoritativeTextInputSelection(
		blockId: string,
	): EditContextSelection | null {
		const caret = this.trustedCaretIn(blockId);
		return caret && caret.anchorOffset === caret.focusOffset ? caret : null;
	}
}

/**
 * C2: maps a buffer range through the deltas deferred during a composition,
 * start downstream and end upstream (the contenteditable rebase's
 * association), with the caret after `textLength` inserted at the start.
 */
function rebaseBufferRange(
	rawStart: number,
	rawEnd: number,
	textLength: number,
	deltas: Array<{ delta: FieldEditorDelta[] }>,
): { start: number; end: number; caret: number } {
	const start = mapOffsetThroughRemoteDeltas(rawStart, deltas);
	const end =
		rawEnd === rawStart
			? start
			: Math.max(start, mapOffsetThroughRemoteDeltasUpstream(rawEnd, deltas));
	return { start, end, caret: start + textLength };
}

/**
 * C2: brings the EditContext buffer to `nextText` with one `updateText` over
 * the changed span, so the IME's buffer outside the remote edit is untouched.
 */
function resyncEditContextSpan(editContext: EditContext, nextText: string): void {
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

/**
 * Replaces an EditContext's text with `nextText` and clamps its selection to
 * the new length.
 */
function replaceEditContextText(
	editContext: EditContext,
	nextText: string,
): void {
	editContext.updateText(0, editContext.text.length, nextText);
	writeEditContextSelection(
		editContext,
		Math.min(editContext.selectionStart, nextText.length),
		Math.min(editContext.selectionEnd, nextText.length),
	);
}
