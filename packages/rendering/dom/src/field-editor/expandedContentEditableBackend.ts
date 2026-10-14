import type { Editor, Point, TextSelection } from "@input/pen-types";
import { writeNativeRange } from "./selectionProjector";
import { getPasteImporters, handlePaste } from "./clipboard";
import { InputBackendBase } from "./inputBackendBase";
import type { PenFieldEditorFocusOptions } from "./controller";
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
import { toggleInlineMark } from "./commands";
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
import {
	isCompositionKeyDown,
	isUndecidedCompositionKeyDown,
} from "../utils/compositionKeyDown";

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
export class ExpandedContentEditableBackend extends InputBackendBase {
	private composingOverRange = false;

	activate(
		element: HTMLElement,
		_ytext?: unknown,
		focusOptions?: PenFieldEditorFocusOptions,
	): void {
		this.composingOverRange = false;
		this.attachEditableHost(element);
		this.bindInputEvents(element);

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
		this.releaseEditableHost();
		this.detach();
		if (this.composingOverRange) {
			this.composingOverRange = false;
			this.fieldEditor.setComposing(false);
		}
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

	protected handleBeforeInput = (event: InputEvent): void => {
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
				}
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
	 * so the composition starts there, as the D5 sink does. An undecided
	 * keystroke (an Android keyboard's keyCode 229, which may be Backspace or
	 * Enter) does nothing here: the `beforeinput` that follows edits the range,
	 * or the `compositionstart` composes at its start.
	 */
	private handleCompositionKeyDown(event: KeyboardEvent): boolean {
		const selection = this.editor.selection;
		if (this.composingOverRange || selection?.type !== "text") {
			return false;
		}
		if (isUndecidedCompositionKeyDown(event)) {
			return true;
		}
		if (!isCompositionKeyDown(event)) {
			return false;
		}
		this.fieldEditor.deactivate();
		this.editor.deleteSelection({ origin: "user" });
		this.activateSingleBlockTextSelection();
		return true;
	}

	/**
	 * FE2: a composition with no decided composition keystroke before it
	 * (Gecko delivers text from a text input processor this way, and an
	 * Android keyboard's keystroke is undecided) starts in this host. Its
	 * `insertCompositionText` cannot be cancelled, and over the cross-block
	 * range it would move text and remove block elements the renderer owns,
	 * so the native range collapses to the range start and the engine
	 * composes inside that block's field DOM. Moving the editing host now
	 * would make Gecko commit the composition empty. The committed text
	 * replaces the authority range at `compositionend`, and the caret's field
	 * rebuilds its DOM from the document.
	 */
	protected handleCompositionStart = (): void => {
		const element = this.element;
		const selection = this.editor.selection;
		if (!element || selection?.type !== "text") return;
		const start = rangeStart(this.editor, selection);
		writeNativeRange(element, start, start);
		this.composingOverRange = true;
		// C1: the ime window opens, so projections are withheld while the
		// engine composes in the start block's DOM; the reader does not take
		// that caret as a selection, so the range stays the record.
		this.fieldEditor.setComposing(true);
		this.fieldEditor.reader?.notifyGesture("compositionstart");
	};

	protected handleCompositionEnd = (event: CompositionEvent): void => {
		if (!this.composingOverRange) return;
		this.composingOverRange = false;
		this.fieldEditor.setComposing(false);
		const text = event.data ?? "";
		if (text && !dispatchEditorCommand(this.editor, insertText, { text })) {
			this.editor.replaceSelection(text);
		}
		this.fieldEditor.reader?.notifyGesture("compositionend-completed");
		if (!text) {
			this.updateSelection();
			return;
		}
		this.activateSingleBlockTextSelection();
	};

	protected handleKeyDown = (event: KeyboardEvent): void => {
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

		if (this.element) {
			ensureLineEdgeMeasure(this.editor, this.element.ownerDocument);
		}

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
