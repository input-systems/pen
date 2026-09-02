import { isCollapsed } from "@input/pen-core";
import type { Editor, InlineDecoration } from "@input/pen-types";
import type { FieldEditorInputController } from "./controller";
import { BackendAttachment } from "./backendAttachment";
import { bindBackendTransferEvents } from "./backendTransferEvents";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import { fullReconcileToDOM, applyDeltaToDOM } from "./reconciler";
import {
	editorSelectionToDOM,
	getDirectionalSelectionOffsets,
} from "./selectionBridge";
import {
	rangesEqual,
	resolveEditContextKeyDownRange,
	resolveEditContextTextUpdateRange,
	type DirectionalSelectionOffsets,
	type EditContextRange,
	type EditContextSelection,
	type KeyDownRangeResolution,
} from "./editContextSelectionAuthority";
import {
	applyEditContextTextFormats,
	buildEditContextCharacterBounds,
	findTextPosition,
	isNavigationSelectionKey,
	shouldReplaceEditContextText,
} from "./editContextDom";
import type {
	EditContext,
	EditContextCharacterBoundsUpdateEvent,
	EditContextGlobal,
	EditContextTextFormatUpdateEvent,
	EditContextTextUpdateEvent,
} from "./editContextTypes";
import {
	forwardDomSelectionToReader,
	readNormalizedDomProposal,
	resolveEditorRoot,
	shouldStopEquivalentDomRead,
} from "./selectionReader";
import { normalizeSelectionFormation } from "../utils/selectionFormation";
import {
	buildInlineDecorationsRenderSignature,
	inlineDecorationsForBlock,
	inlineDecorationsRequireFullReconcile,
} from "../utils/inlineDecorations";
import { handleEditContextBeforeInput } from "./editContextBeforeInput";
import { handleFieldEditorKeyDown } from "./keyHandling";
import { isHistoryTransactionOrigin } from "./historyOrigin";
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

	constructor(editor: Editor, fieldEditor: FieldEditorInputController) {
		this.editor = editor;
		this.fieldEditor = fieldEditor;
	}

	activate(element: HTMLElement, ytext: unknown): void {
		this.isComposing = false;
		this.deferredRemoteDeltas = [];
		this.clearPendingTextUpdate();
		this._activateEditContext(element, ytext);
		this.attachment.listen(
			element,
			"keydown",
			this.handleCompositionCancelKey,
		);
	}

	deactivate(): void {
		this.isComposing = false;
		this.deferredRemoteDeltas = [];
		this.clearPendingTextUpdate();
		this._deactivateEditContext();
	}

	private _activateEditContext(element: HTMLElement, ytext: unknown): void {
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
		this.attachment.listen(element, "contextmenu", this.handleContextMenu);
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
		if (element.ownerDocument) {
			this.attachment.listenDocument(
				element.ownerDocument,
				"selectionchange",
				this.handleSelectionChange,
			);
		}

		this.observer = (event) => this.handleYTextChange(event);
		this.attachment.observeText(this.ytext, this.observer);
		this.attachment.subscribe(
			this.editor.on("decorationsChange", this.handleDecorationsChange),
		);
		this.inlineDecorationsSignature = this.getInlineDecorationsSignature();

		fullReconcileToDOM(this.ytext, element, this.editor.schema, {
			urlPolicy: urlPolicyFromEditor(this.editor),
			inlineDecorations: this.getInlineDecorationsForBlock(),
		});
		this.fieldEditor.notifyDomReconciled(
			this.fieldEditor.focusBlockId ?? undefined,
		);
		this.fieldEditor.resetBackendSelectionAuthority();
		this.fieldEditor.withBackendSelectionWrite(() => {
			this.updateSelection();
			this.fieldEditor.requestDomFocus(element, "backend-activate", {
				preventScroll: true,
			});
		});
	}

	private _deactivateEditContext(): void {
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
		}
		this.editContext = null;
		this.element = null;
		this.ytext = null;
		this.observer = null;
		this.inlineDecorationsSignature = null;
		this.fieldEditor.resetBackendSelectionAuthority();
		this.fieldEditor.setComposing(false);
	}

	updateSelection(): void {
		if (!this.editContext || !this.ytext) return;

		const selection = this.fieldEditor.selection;
		const blockId = this.fieldEditor.focusBlockId;
		if (
			selection?.type === "text" &&
			blockId &&
			selection.anchor.blockId === blockId &&
			selection.focus.blockId === blockId
		) {
			const anchorOffset = this.resolveEditContextOffset(
				selection.anchor.offset,
			);
			const focusOffset = this.resolveEditContextOffset(
				selection.focus.offset,
			);
			this.setEditContextSelection({
				blockId,
				anchorOffset,
				focusOffset,
			});
			this.fieldEditor.withBackendSelectionWrite(() => {
				this.projectDOMSelection(blockId, anchorOffset, focusOffset);
			});
			return;
		}

		const len = this.ytext.length;
		this.editContext.updateSelection(len, len);
		this.fieldEditor.setEditContextSelectionSnapshot(
			blockId
				? {
						blockId,
						anchorOffset: len,
						focusOffset: len,
					}
				: null,
		);
	}

	protected projectDOMSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void {
		if (!this.element) return;
		const root = this.element.closest(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		if (!root) return;
		editorSelectionToDOM(
			root,
			{ blockId, offset: anchorOffset },
			{ blockId, offset: focusOffset },
		);
	}

	protected handleContextMenu = (): void => {
		this.fieldEditor.notifyGestureEvent?.("contextmenu");
	};

	protected isComposing = false;
	protected deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }> = [];
	protected pendingTextUpdate: PendingEditContextTextUpdate | null = null;
	protected lastCommittedTextUpdate: PendingEditContextTextUpdate | null =
		null;
	protected ignoreNextTextFormatUpdate = false;
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
				this.ignoreNextTextFormatUpdate = true;
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
		return this.isComposing || this.fieldEditor.isComposing;
	}

	protected beginEditContextComposition(): void {
		if (this.isComposing) {
			return;
		}
		this.isComposing = true;
		this.deferredRemoteDeltas = [];
		this.fieldEditor.notifyGestureEvent?.("compositionstart");
		this.fieldEditor.setComposing(true);
	}

	protected closeEditContextComposition(): void {
		this.isComposing = false;
		this.fieldEditor.setComposing(false);
		this.flushDeferredRemoteDeltas();
		this.fieldEditor.notifyGestureEvent?.("compositionend-completed");
	}

	protected clearPendingTextUpdate(): void {
		this.pendingTextUpdate = null;
		this.lastCommittedTextUpdate = null;
		this.ignoreNextTextFormatUpdate = false;
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
		const resolved = this.resolveTextUpdateRange(input);
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
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				urlPolicy: urlPolicyFromEditor(this.editor),
				preserveSelection: true,
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(
				this.fieldEditor.focusBlockId ?? undefined,
			);
			this.restoreDOMCaret();
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
		this.ignoreNextTextFormatUpdate = true;
		this.applyEditContextTextUpdate(pending);
	}

	protected flushDeferredRemoteDeltas(): void {
		if (this.deferredRemoteDeltas.length === 0) {
			return;
		}
		this.deferredRemoteDeltas = [];
		if (!this.editContext || !this.element || !this.ytext) {
			return;
		}
		const nextText = this.ytext.toString();
		this.editContext.updateText(0, this.editContext.text.length, nextText);
		const clampedSelectionStart = Math.min(
			this.editContext.selectionStart,
			nextText.length,
		);
		const clampedSelectionEnd = Math.min(
			this.editContext.selectionEnd,
			nextText.length,
		);
		this.editContext.updateSelection(
			clampedSelectionStart,
			clampedSelectionEnd,
		);
		fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
			urlPolicy: urlPolicyFromEditor(this.editor),
			preserveSelection: true,
			inlineDecorations: this.getInlineDecorationsForBlock(),
		});
		this.fieldEditor.notifyDomReconciled(
			this.fieldEditor.focusBlockId ?? undefined,
		);
		this.restoreDOMCaret();
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
				this.ignoreNextTextFormatUpdate = true;
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
			this.fieldEditor.setBackendSelectionAuthority(
				"programmatic",
				nextSelection,
			);
			this.setEditContextSelection(nextSelection, {
				source: "text-update",
			});
			this.fieldEditor.syncTextSelection(
				listInputRuleTarget.blockId,
				listInputRuleTarget.anchorOffset,
				listInputRuleTarget.focusOffset,
			);
			this.restoreDOMCaret();
			this.fieldEditor.clearBackendSelectionAuthority("programmatic");
			return;
		}

		const inlineInputRuleTarget = applyInlineInputRule(this.editor, {
			blockId,
			offset: range.start,
			text,
		});
		if (inlineInputRuleTarget) {
			this.fieldEditor.setBackendSelectionAuthority(
				"programmatic",
				inlineInputRuleTarget,
			);
			this.setEditContextSelection(inlineInputRuleTarget, {
				source: "text-update",
			});
			this.fieldEditor.syncTextSelection(
				inlineInputRuleTarget.blockId,
				inlineInputRuleTarget.anchorOffset,
				inlineInputRuleTarget.focusOffset,
			);
			this.restoreDOMCaret();
			this.fieldEditor.clearBackendSelectionAuthority("programmatic");
			return;
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
			this.restoreDOMCaret();
		}

		this.fieldEditor.clearBackendSelectionAuthority("programmatic");
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
			isLogicallyEmpty: (this.ytext?.toString() ?? "") === "",
			editorSelectionRange: this.resolveEditorSelectionRange(
				input.blockId,
			),
			editContextSelection:
				this.fieldEditor.getEditContextSelectionSnapshot(input.blockId),
			authoritativeTextInputSelection:
				this.fieldEditor.getBackendSelectionAuthority(
					"edit-context-textupdate",
					input.blockId,
				),
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
		this.fieldEditor.setEditContextSelectionSnapshot(resolvedSelection);
		if (options?.source === "text-update") {
			this.fieldEditor.setBackendSelectionAuthority(
				"edit-context-textupdate",
				resolvedSelection,
			);
		}
		this.editContext?.updateSelection(
			resolvedSelection.anchorOffset,
			resolvedSelection.focusOffset,
		);
	}

	protected resolveEditContextOffset(
		offset: number,
		options?: EditContextSelectionOptions,
	): number {
		return options?.source !== "text-update" &&
			(this.ytext?.toString() ?? "") === ""
			? 0
			: offset;
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

	protected shouldIgnoreStaleCollapsedDomSelection(
		selection: ReturnType<typeof normalizeSelectionFormation>,
	): boolean {
		if (selection.type === "block") {
			return false;
		}
		if (
			selection.anchor.blockId !== selection.focus.blockId ||
			selection.anchor.offset !== selection.focus.offset
		) {
			return false;
		}

		// A caret that disagrees with the authority is stale only when
		// nothing is driving it. Inside an open gesture window it is the
		// user moving the caret (R3), and the reader owns that proposal.
		if (this.fieldEditor.isAdmissibleGestureRead?.()) {
			return false;
		}

		const editorSelectionRange =
			this.resolveEditorSelectionRange(selection.anchor.blockId) ??
			this.resolveCollapsedEditorSelectionRange(selection.anchor.blockId);
		if (!editorSelectionRange) {
			return false;
		}

		return (
			selection.anchor.offset !== editorSelectionRange.start ||
			selection.focus.offset !== editorSelectionRange.end
		);
	}

	protected handleTextFormatUpdate = (event: Event): void => {
		if (!this.element) return;

		const ranges =
			(event as EditContextTextFormatUpdateEvent).getTextFormats?.() ??
			[];
		if (this.ignoreNextTextFormatUpdate) {
			this.ignoreNextTextFormatUpdate = false;
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

	protected handleSelectionChange = (): void => {
		if (!this.element || !this.editContext) return;
		const isApplyingSelection =
			this.fieldEditor.getBackendSelectionApplicationDepth();
		if (
			!this.fieldEditor.shouldHandleDomSelectionChange(
				isApplyingSelection,
			)
		) {
			if (isApplyingSelection === 0) {
				this.restoreDOMCaret();
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

		if (this.shouldIgnoreStaleCollapsedDomSelection(normalizedSelection)) {
			this.restoreDOMCaret();
			return;
		}

		if (normalizedSelection.type === "block") {
			if (
				forwardDomSelectionToReader(
					this.fieldEditor,
					normalizedSelection,
				)
			) {
				return;
			}
			this.fieldEditor.deactivate();
			this.editor.setSelection({
				type: "block",
				blockIds: normalizedSelection.blockIds,
			});
			return;
		}

		if (
			normalizedSelection.anchor.blockId !==
			normalizedSelection.focus.blockId
		) {
			if (
				forwardDomSelectionToReader(
					this.fieldEditor,
					normalizedSelection,
				)
			) {
				return;
			}
			this.fieldEditor.applyDocumentTextSelection(
				normalizedSelection.anchor,
				normalizedSelection.focus,
			);
			return;
		}

		if (
			normalizedSelection.anchor.blockId !== this.fieldEditor.focusBlockId
		) {
			if (
				forwardDomSelectionToReader(
					this.fieldEditor,
					normalizedSelection,
				)
			) {
				return;
			}
			this.fieldEditor.activateTextSelection(
				normalizedSelection.anchor.blockId,
				normalizedSelection.anchor.offset,
				normalizedSelection.focus.offset,
			);
			return;
		}

		const selection = this.element.ownerDocument?.getSelection();
		if (!selection?.rangeCount) return;
		if (!this.element.contains(selection.anchorNode)) return;
		if (!this.element.contains(selection.focusNode)) return;

		const offsets = getDirectionalSelectionOffsets(this.element);
		if (!offsets) return;
		const editorSelectionRange = this.resolveEditorSelectionRange(
			normalizedSelection.anchor.blockId,
		);
		if (
			editorSelectionRange &&
			offsets.anchor === offsets.focus &&
			(offsets.start !== editorSelectionRange.start ||
				offsets.end !== editorSelectionRange.end)
		) {
			this.setEditContextSelection({
				blockId: normalizedSelection.anchor.blockId,
				anchorOffset: editorSelectionRange.start,
				focusOffset: editorSelectionRange.end,
			});
			this.restoreDOMCaret();
			return;
		}
		const authoritativeSelection = this.getAuthoritativeTextInputSelection(
			normalizedSelection.anchor.blockId,
		);
		if (
			authoritativeSelection &&
			offsets.anchor === offsets.focus &&
			(offsets.anchor !== authoritativeSelection.anchorOffset ||
				offsets.focus !== authoritativeSelection.focusOffset)
		) {
			this.setEditContextSelection(authoritativeSelection, {
				source: "text-update",
			});
			this.restoreDOMCaret();
			return;
		}

		this.editContext.updateSelection(offsets.start, offsets.end);
		const nextSelection = {
			blockId: normalizedSelection.anchor.blockId,
			anchorOffset: offsets.anchor,
			focusOffset: offsets.focus,
		};
		this.fieldEditor.setEditContextSelectionSnapshot(nextSelection);
		this.fieldEditor.setBackendSelectionAuthority(
			"user-dom",
			nextSelection,
		);
		if (
			forwardDomSelectionToReader(this.fieldEditor, {
				type: "text",
				anchor: {
					blockId: normalizedSelection.anchor.blockId,
					offset: offsets.anchor,
				},
				focus: {
					blockId: normalizedSelection.anchor.blockId,
					offset: offsets.focus,
				},
			})
		) {
			return;
		}
		this.fieldEditor.syncTextSelection(
			normalizedSelection.anchor.blockId,
			offsets.anchor,
			offsets.focus,
		);
	};

	protected handleYTextChange = (event: FieldEditorTextChangeEvent): void => {
		if (!this.editContext || !this.element || !this.ytext) return;
		const isHistory = isHistoryTransactionOrigin(event.transaction?.origin);
		if (!isHistory && this.hasInFlightEditContextComposition()) {
			if (
				event.transaction?.origin === "remote" ||
				event.transaction?.origin === "collaborator"
			) {
				this.deferredRemoteDeltas.push({ delta: event.delta });
			}
			return;
		}
		if (isHistory) {
			this.fieldEditor.clearBackendSelectionAuthority(
				"edit-context-textupdate",
			);
			const nextText = this.ytext?.toString?.() ?? "";
			this.editContext.updateText(
				0,
				this.editContext.text.length,
				nextText,
			);
			const clampedSelectionStart = Math.min(
				this.editContext.selectionStart,
				nextText.length,
			);
			const clampedSelectionEnd = Math.min(
				this.editContext.selectionEnd,
				nextText.length,
			);
			this.editContext.updateSelection(
				clampedSelectionStart,
				clampedSelectionEnd,
			);
			const blockId = this.fieldEditor.focusBlockId;
			this.fieldEditor.setEditContextSelectionSnapshot(
				blockId
					? {
							blockId,
							anchorOffset: clampedSelectionStart,
							focusOffset: clampedSelectionEnd,
						}
					: null,
			);
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				urlPolicy: urlPolicyFromEditor(this.editor),
				preserveSelection: true,
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(blockId ?? undefined);
			this.restoreDOMCaret();
			return;
		}

		const inlineDecorations = this.getInlineDecorationsForBlock();
		if (inlineDecorationsRequireFullReconcile(inlineDecorations)) {
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				urlPolicy: urlPolicyFromEditor(this.editor),
				preserveSelection: true,
				inlineDecorations,
			});
			this.fieldEditor.notifyDomReconciled(
				this.fieldEditor.focusBlockId ?? undefined,
			);
		} else {
			const applied = applyDeltaToDOM(
				event.delta,
				this.element,
				this.editor.schema,
				urlPolicyFromEditor(this.editor),
			);
			if (!applied) {
				fullReconcileToDOM(
					this.ytext,
					this.element,
					this.editor.schema,
					{
						urlPolicy: urlPolicyFromEditor(this.editor),
						preserveSelection: true,
						inlineDecorations,
					},
				);
				this.fieldEditor.notifyDomReconciled(
					this.fieldEditor.focusBlockId ?? undefined,
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

		const pendingSelection = this.fieldEditor.focusBlockId
			? this.fieldEditor.getBackendSelectionAuthority(
					"programmatic",
					this.fieldEditor.focusBlockId,
				)
			: null;
		if (pendingSelection) {
			this.setEditContextSelection(pendingSelection, {
				source: "text-update",
			});
		}
		this.restoreDOMCaret();
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
		fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
			urlPolicy: urlPolicyFromEditor(this.editor),
			preserveSelection: projectSelection,
			inlineDecorations: this.getInlineDecorationsForBlock(),
		});
		this.inlineDecorationsSignature = nextInlineDecorationsSignature;
		this.fieldEditor.notifyDomReconciled(
			this.fieldEditor.focusBlockId ?? undefined,
		);
		if (projectSelection) {
			this.restoreDOMCaret();
		}
	};

	protected restoreDOMCaret(): void {
		if (!this.editContext || !this.element) return;

		const root = this.element.closest(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const selection = this.fieldEditor.selection;
		const blockId = this.fieldEditor.focusBlockId;
		const pendingSelection =
			blockId != null
				? this.fieldEditor.getBackendSelectionAuthority(
						"programmatic",
						blockId,
					)
				: null;
		const authoritativeInputSelection =
			blockId != null
				? this.fieldEditor.getBackendSelectionAuthority(
						"edit-context-textupdate",
						blockId,
					)
				: null;
		const editContextSelection =
			this.fieldEditor.getEditContextSelectionSnapshot(blockId);
		const editorSelection =
			selection?.type === "text" &&
			blockId &&
			selection.anchor.blockId === blockId &&
			selection.focus.blockId === blockId
				? selection
				: null;
		const anchorOffset =
			pendingSelection?.anchorOffset ??
			authoritativeInputSelection?.anchorOffset ??
			editorSelection?.anchor.offset ??
			editContextSelection?.anchorOffset ??
			null;
		const focusOffset =
			pendingSelection?.focusOffset ??
			authoritativeInputSelection?.focusOffset ??
			editorSelection?.focus.offset ??
			editContextSelection?.focusOffset ??
			null;
		if (root && blockId && anchorOffset != null && focusOffset != null) {
			this.fieldEditor.withBackendSelectionWrite(() => {
				editorSelectionToDOM(
					root,
					{ blockId, offset: anchorOffset },
					{ blockId, offset: focusOffset },
				);
			});
			return;
		}

		const start = this.editContext.selectionStart;
		const end = this.editContext.selectionEnd;

		const anchorPoint = findTextPosition(this.element, start);
		const focusPoint =
			start === end ? anchorPoint : findTextPosition(this.element, end);
		if (!anchorPoint || !focusPoint) return;

		const sel = this.element.ownerDocument?.getSelection();
		if (!sel) return;

		this.fieldEditor.withBackendSelectionWrite(() => {
			sel.removeAllRanges();
			const range = document.createRange();
			range.setStart(anchorPoint.node, anchorPoint.offset);
			range.setEnd(focusPoint.node, focusPoint.offset);
			sel.addRange(range);
		});
	}

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

	protected handleKeyDown = (event: KeyboardEvent): void => {
		if (!this.editContext || !this.element || !this.ytext) return;
		if (isNavigationSelectionKey(event)) {
			this.fieldEditor.clearBackendSelectionAuthority(
				"edit-context-textupdate",
			);
		}

		const blockId = this.fieldEditor.focusBlockId;
		const liveDomOffsets = getDirectionalSelectionOffsets(this.element);
		const { range, nextSelection, shouldSyncEditContextSelection } =
			this.resolveKeyDownRange(blockId, event, liveDomOffsets);

		if (shouldSyncEditContextSelection) {
			this.editContext.updateSelection(range.start, range.end);
			this.fieldEditor.setEditContextSelectionSnapshot(nextSelection);
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
			projectedTextSelection: blockId
				? this.getProjectedTextSelection(blockId)
				: null,
			synchronizedEditContextRange: blockId
				? this.resolveSynchronizedEditContextRange(blockId)
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

	protected getProjectedTextSelection(
		blockId: string,
	): EditContextSelection | null {
		return this.fieldEditor.getEditContextSelectionSnapshot(blockId);
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

	protected resolveSynchronizedEditContextRange(
		blockId: string,
	): EditContextRange | null {
		if (!this.editContext) {
			return null;
		}

		const editContextRange = {
			start: Math.min(
				this.editContext.selectionStart,
				this.editContext.selectionEnd,
			),
			end: Math.max(
				this.editContext.selectionStart,
				this.editContext.selectionEnd,
			),
		};
		const editorRange =
			this.resolveEditorSelectionRange(blockId) ??
			this.resolveCollapsedEditorSelectionRange(blockId);

		if (editorRange && rangesEqual(editContextRange, editorRange)) {
			return editContextRange;
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

	protected handlePointerDown = (): void => {
		this.fieldEditor.notifyGestureEvent?.("pointerdown");
		this.fieldEditor.clearBackendSelectionAuthority(
			"edit-context-textupdate",
		);
	};

	protected getAuthoritativeTextInputSelection(
		blockId: string,
	): EditContextSelection | null {
		const selection = this.fieldEditor.getBackendSelectionAuthority(
			"edit-context-textupdate",
			blockId,
		);
		if (!selection || selection.anchorOffset !== selection.focusOffset) {
			return null;
		}
		return {
			blockId: selection.blockId,
			anchorOffset: selection.anchorOffset,
			focusOffset: selection.focusOffset,
		};
	}
}
