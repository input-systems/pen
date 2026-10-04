import type { Editor, Point, TextSelection } from "@input/pen-types";
import { writeNativeRange } from "./selectionProjector";
import { getPasteImporters, handlePaste } from "./clipboard";
import { BackendAttachment } from "./backendAttachment";
import { bindBackendTransferEvents } from "./backendTransferEvents";
import { bindSurfaceTabStop } from "./surfaceTabStop";
import type {
	FieldEditorInputController,
	PenFieldEditorFocusOptions,
} from "./controller";
import { getResolvedYText } from "./contentResolution";
import {
	deleteBackward,
	deleteForward,
	historyRedo,
	historyUndo,
	insertLineBreak,
	insertText,
	isMultiBlock,
	splitBlock,
	toggleMark,
} from "@input/pen-core";
import { applyEnterBehavior, toggleInlineMark } from "./commands";
import {
	activateFieldEditorFromSelection,
	applyBeforeInputPolicy,
	dispatchEditorCommand,
	keymapContextFromSelection,
} from "./commandDispatch";
import { ensureLineEdgeMeasure } from "./contenteditableDomHelpers";
import {
	handleEditorKeyBindings,
	handleSelectAllShortcut,
} from "./keyHandling";
import { dispatchKeymapEvent } from "./keymap";
import { mapBeforeInput } from "./beforeinputMap";
import { isCompositionKeyDown } from "../utils/compositionKeyDown";

const FORMAT_MARKS = {
	formatBold: "bold",
	formatItalic: "italic",
	formatUnderline: "underline",
} as const;

/**
 * Expanded mode owns the shared cross-block selected state on the real block
 * list DOM. It intentionally handles only range selection plus replace/delete
 * style inputs; once the DOM selection collapses back to a single block we hand
 * control back to the normal single-block backend path.
 */
export class ExpandedContentEditableBackend {
	private element: HTMLElement | null = null;
	private readonly attachment = new BackendAttachment();
	private editor: Editor;
	private fieldEditor: FieldEditorInputController;
	private composingOverRange = false;

	constructor(editor: Editor, fieldEditor: FieldEditorInputController) {
		this.editor = editor;
		this.fieldEditor = fieldEditor;
	}

	activate(
		element: HTMLElement,
		_ytext?: unknown,
		focusOptions?: PenFieldEditorFocusOptions,
	): void {
		this.element = element;
		element.contentEditable = "true";
		bindSurfaceTabStop(this.attachment, element);

		this.attachment.listen(element, "beforeinput", this.handleBeforeInput);
		this.attachment.listen(element, "keydown", this.handleKeyDown);
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
		bindBackendTransferEvents(
			this.attachment,
			element,
			this.editor,
			this.fieldEditor,
		);

		const selection = this.editor.selection;
		if (selection?.type === "text") {
			// HOST9: a passive attach leaves focus where it is; a native
			// range written into an unfocused host would move focus with it.
			if (
				this.fieldEditor.requestDomFocus(
					element,
					"backend-activate",
					{ preventScroll: true },
					focusOptions,
				) &&
				element.contains(element.ownerDocument.activeElement)
			) {
				writeNativeRange(element, selection.anchor, selection.focus);
			}
			return;
		}

		this.fieldEditor.requestDomFocus(
			element,
			"backend-activate",
			{ preventScroll: true },
			focusOptions,
		);
	}

	deactivate(): void {
		if (this.element) {
			// see ContentEditableBackend.deactivate: release editability by
			// removing the attribute so this host never becomes a read-only
			// island inside a wider editing host.
			this.element.removeAttribute("contenteditable");
			this.element.removeAttribute("tabindex");
		}
		this.attachment.release();

		this.element = null;
	}

	updateSelection(): void {
		const element = this.element;
		if (!element) return;
		const selection = this.editor.selection;
		if (selection?.type !== "text") return;
		writeNativeRange(element, selection.anchor, selection.focus);
	}

	/** Hands a selection that collapsed into one block back to its field. */
	private activateSingleBlockTextSelection(): void {
		const selection = this.editor.selection;
		if (selection?.type !== "text" || isMultiBlock(selection)) {
			return;
		}
		this.fieldEditor.activateTextSelection(
			selection.anchor.blockId,
			selection.anchor.offset,
			selection.focus.offset,
			{ origin: "keyboard" },
		);
	}

	private handleBeforeInput = (event: InputEvent): void => {
		const selection = this.editor.selection;
		if (selection?.type !== "text") return;

		// map decides preventDefault / allow / block; the switch is expanded-mode implementation
		const mapping = mapBeforeInput(event.inputType);
		if ("policy" in mapping) {
			applyBeforeInputPolicy(this.editor, event, mapping);
			return;
		}

		event.preventDefault();

		switch (event.inputType) {
			case "insertText":
			case "insertFromDrop":
			case "insertReplacementText": {
				const text = event.data ?? "";
				if (!text) return;
				if (!dispatchEditorCommand(this.editor, insertText, { text })) {
					this.editor.replaceSelection(text);
				}
				return;
			}
			case "insertParagraph":
			case "insertLineBreak": {
				this.fieldEditor.deactivate();

				if (isMultiBlock(selection)) {
					this.editor.replaceSelection("\n");
					this.activateSingleBlockTextSelection();
					return;
				}

				const command =
					event.inputType === "insertLineBreak"
						? insertLineBreak
						: splitBlock;
				if (dispatchEditorCommand(this.editor, command, undefined)) {
					this.activateSingleBlockTextSelection();
					return;
				}

				const blockId = selection.anchor.blockId;
				const ytext = getResolvedYText(this.editor, blockId, null);
				if (!ytext) return;

				const target = applyEnterBehavior(this.editor, {
					blockId,
					inputMode: this.fieldEditor.inputMode,
					ytext,
					range: {
						start: Math.min(
							selection.anchor.offset,
							selection.focus.offset,
						),
						end: Math.max(
							selection.anchor.offset,
							selection.focus.offset,
						),
					},
				});
				if (!target) return;

				this.fieldEditor.activateTextSelection(
					target.blockId,
					target.anchorOffset,
					target.focusOffset,
					{ origin: "keyboard" },
				);
				return;
			}
			case "deleteContentBackward":
			case "deleteContentForward":
			case "deleteWordBackward":
			case "deleteWordForward":
			case "deleteSoftLineBackward":
			case "deleteHardLineBackward":
			case "deleteSoftLineForward":
			case "deleteHardLineForward": {
				if ("commandName" in mapping) {
					const command =
						mapping.commandName === "pen.deleteForward"
							? deleteForward
							: deleteBackward;
					const param = (mapping.param ?? {
						granularity: "grapheme",
					}) as { granularity: "grapheme" | "word" | "line" };
					if (dispatchEditorCommand(this.editor, command, param)) {
						return;
					}
				}
				this.editor.deleteSelection();
				return;
			}
			case "insertFromPaste": {
				handlePaste(
					event,
					this.editor,
					this.fieldEditor,
					getPasteImporters(this.editor),
				);
				return;
			}
			case "historyUndo": {
				if (!dispatchEditorCommand(this.editor, historyUndo, undefined)) {
					this.editor.undoManager.undo();
				}
				return;
			}
			case "historyRedo": {
				if (!dispatchEditorCommand(this.editor, historyRedo, undefined)) {
					this.editor.undoManager.redo();
				}
				return;
			}
			case "formatBold":
			case "formatItalic":
			case "formatUnderline": {
				const mark =
					FORMAT_MARKS[event.inputType as keyof typeof FORMAT_MARKS];
				if (!dispatchEditorCommand(this.editor, toggleMark, { mark })) {
					toggleInlineMark(this.editor, mark);
				}
				return;
			}
			default:
				break;
		}
	};

	/**
	 * FE2 D20: the expanded host does not compose. A composition keystroke
	 * deletes the range and focuses the caret's field in this `keydown` turn,
	 * so the composition starts there, as the D5 sink does.
	 */
	private handleCompositionKeyDown(event: KeyboardEvent): boolean {
		const selection = this.editor.selection;
		if (
			this.composingOverRange ||
			!isCompositionKeyDown(event) ||
			selection?.type !== "text"
		) {
			return false;
		}
		this.fieldEditor.deactivate();
		this.editor.deleteSelection({ origin: "user" });
		this.activateSingleBlockTextSelection();
		return true;
	}

	/**
	 * FE2: a composition with no composition keystroke before it (Gecko
	 * delivers text from a text input processor this way) starts in this
	 * host. Its `insertCompositionText` cannot be cancelled, and over the
	 * cross-block range it would move text and remove block elements the
	 * renderer owns, so the native range collapses to the range start and the
	 * engine composes inside that block's field DOM. Moving the editing host
	 * now would make Gecko commit the composition empty. The committed text
	 * replaces the authority range at `compositionend`, and the caret's field
	 * rebuilds its DOM from the document.
	 */
	private handleCompositionStart = (): void => {
		const element = this.element;
		const selection = this.editor.selection;
		if (!element || selection?.type !== "text") return;
		const start = rangeStart(this.editor, selection);
		writeNativeRange(element, start, start);
		this.composingOverRange = true;
	};

	private handleCompositionEnd = (event: CompositionEvent): void => {
		if (!this.composingOverRange) return;
		this.composingOverRange = false;
		const text = event.data ?? "";
		if (!text) {
			this.updateSelection();
			return;
		}
		if (!dispatchEditorCommand(this.editor, insertText, { text })) {
			this.editor.replaceSelection(text);
		}
		this.activateSingleBlockTextSelection();
	};

	private handleKeyDown = (event: KeyboardEvent): void => {
		if (this.handleCompositionKeyDown(event)) {
			return;
		}
		if (
			!event.defaultPrevented &&
			handleSelectAllShortcut(this.editor, event, this.fieldEditor)
		) {
			event.preventDefault();
			return;
		}

		ensureLineEdgeMeasure(this.editor);

		if (
			!event.defaultPrevented &&
			!(event.key === "Enter" && isMultiBlock(this.editor.selection)) &&
			dispatchKeymapEvent(this.editor, event, {
				composing: event.isComposing === true,
				context: keymapContextFromSelection(
					this.editor.selection,
					false,
				),
			})
		) {
			event.preventDefault();
			activateFieldEditorFromSelection(this.editor, this.fieldEditor);
			return;
		}

		if (
			handleEditorKeyBindings(this.editor, event, {
				includeSelectAll: false,
			})
		) {
			event.preventDefault();
		}
	};
}

function rangeStart(editor: Editor, selection: TextSelection): Point {
	const order = editor.documentState;
	const anchorIndex = order.preorderIndexOf(selection.anchor.blockId);
	const focusIndex = order.preorderIndexOf(selection.focus.blockId);
	const anchorFirst =
		anchorIndex < focusIndex ||
		(anchorIndex === focusIndex &&
			selection.anchor.offset <= selection.focus.offset);
	return anchorFirst ? selection.anchor : selection.focus;
}
