import type { Editor } from "@input/pen-types";
import { editorSelectionToDOM } from "./selectionBridge";
import { getPasteImporters, handlePaste } from "./clipboard";
import { BackendAttachment } from "./backendAttachment";
import { bindBackendTransferEvents } from "./backendTransferEvents";
import type { FieldEditorInputController } from "./controller";
import type { FieldEditorTextLike } from "./crdt";
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
	forwardDomSelectionToReader,
	readNormalizedDomProposal,
	shouldStopEquivalentDomRead,
} from "./selectionReader";

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

	constructor(editor: Editor, fieldEditor: FieldEditorInputController) {
		this.editor = editor;
		this.fieldEditor = fieldEditor;
	}

	activate(element: HTMLElement): void {
		this.element = element;
		element.contentEditable = "true";
		element.tabIndex = -1;
		this.fieldEditor.resetBackendSelectionAuthority();

		this.attachment.listen(element, "beforeinput", this.handleBeforeInput);
		this.attachment.listen(element, "keydown", this.handleKeyDown);
		bindBackendTransferEvents(
			this.attachment,
			element,
			this.editor,
			this.fieldEditor,
		);
		if (element.ownerDocument) {
			this.attachment.listenDocument(
				element.ownerDocument,
				"selectionchange",
				this.handleSelectionChange,
			);
		}

		const selection = this.editor.selection;
		if (selection?.type === "text") {
			this.fieldEditor.withBackendSelectionWrite(() => {
				if (
					!this.fieldEditor.requestDomFocus(
						element,
						"backend-activate",
						{
							preventScroll: true,
						},
					)
				) {
					return;
				}
				editorSelectionToDOM(
					element,
					selection.anchor,
					selection.focus,
				);
			});
			return;
		}

		this.fieldEditor.requestDomFocus(element, "backend-activate", {
			preventScroll: true,
		});
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

	updateSelection(_relPos: unknown): void {
		if (!this.element) return;
		this.projectCurrentSelection();
	}

	private projectCurrentSelection(): void {
		const element = this.element;
		if (!element) return;
		const selection = this.editor.selection;
		if (selection?.type !== "text") return;
		this.fieldEditor.withBackendSelectionWrite(() => {
			editorSelectionToDOM(element, selection.anchor, selection.focus);
		});
	}

	private handleSelectionChange = (): void => {
		if (!this.element) return;
		if (
			!this.fieldEditor.shouldHandleDomSelectionChange(
				this.fieldEditor.getBackendSelectionApplicationDepth(),
			)
		) {
			return;
		}

		const normalizedSelection = readNormalizedDomProposal(
			this.element,
			this.editor,
		);
		if (!normalizedSelection) return;

		if (shouldStopEquivalentDomRead(this.editor, normalizedSelection)) {
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

		this.fieldEditor.applyDomTextSelection(
			normalizedSelection.anchor,
			normalizedSelection.focus,
		);
	};

	private handleBeforeInput = (event: InputEvent): void => {
		const selection = this.editor.selection;
		if (selection?.type !== "text") return;

		// map decides preventDefault / allow / block; the switch is expanded-mode implementation
		const mapping = mapBeforeInput(event.inputType);
		if ("policy" in mapping) {
			switch (mapping.policy) {
				case "allow":
					return;
				case "block":
					event.preventDefault();
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

		switch (event.inputType) {
			case "insertText":
			case "insertFromDrop":
			case "insertReplacementText": {
				const text = event.data ?? "";
				if (!text) return;
				if (
					dispatchEditorCommand(
						this.editor,
						insertText,
						{ text },
						{
							origin: "user",
						},
					)
				) {
					return;
				}
				this.editor.replaceSelection(text);
				return;
			}
			case "insertParagraph":
			case "insertLineBreak": {
				this.fieldEditor.deactivate();

				if (isMultiBlock(selection)) {
					this.editor.replaceSelection("\n");
					const nextSelection = this.editor.selection;
					if (
						nextSelection?.type === "text" &&
						!isMultiBlock(nextSelection)
					) {
						this.fieldEditor.activateTextSelection(
							nextSelection.anchor.blockId,
							nextSelection.anchor.offset,
							nextSelection.focus.offset,
						);
					}
					return;
				}

				const command =
					event.inputType === "insertLineBreak"
						? insertLineBreak
						: splitBlock;
				if (
					dispatchEditorCommand(this.editor, command, undefined, {
						origin: "user",
					})
				) {
					const nextSelection = this.editor.selection;
					if (
						nextSelection?.type === "text" &&
						!isMultiBlock(nextSelection)
					) {
						this.fieldEditor.activateTextSelection(
							nextSelection.anchor.blockId,
							nextSelection.anchor.offset,
							nextSelection.focus.offset,
						);
					}
					return;
				}

				const blockId = selection.anchor.blockId;
				const ytext = getBlockText(this.editor, blockId);
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
					if (
						dispatchEditorCommand(this.editor, command, param, {
							origin: "user",
						})
					) {
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
				if (
					dispatchEditorCommand(this.editor, historyUndo, undefined, {
						origin: "user",
					})
				) {
					return;
				}
				this.editor.undoManager.undo();
				return;
			}
			case "historyRedo": {
				if (
					dispatchEditorCommand(this.editor, historyRedo, undefined, {
						origin: "user",
					})
				) {
					return;
				}
				this.editor.undoManager.redo();
				return;
			}
			case "formatBold": {
				if (
					dispatchEditorCommand(
						this.editor,
						toggleMark,
						{ mark: "bold" },
						{ origin: "user" },
					)
				) {
					return;
				}
				toggleInlineMark(this.editor, "bold");
				return;
			}
			case "formatItalic": {
				if (
					dispatchEditorCommand(
						this.editor,
						toggleMark,
						{ mark: "italic" },
						{ origin: "user" },
					)
				) {
					return;
				}
				toggleInlineMark(this.editor, "italic");
				return;
			}
			case "formatUnderline": {
				if (
					dispatchEditorCommand(
						this.editor,
						toggleMark,
						{ mark: "underline" },
						{ origin: "user" },
					)
				) {
					return;
				}
				toggleInlineMark(this.editor, "underline");
				return;
			}
			default:
				break;
		}
	};

	private handleKeyDown = (event: KeyboardEvent): void => {
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

function getBlockText(
	editor: Editor,
	blockId: string,
): FieldEditorTextLike | null {
	const adapter = editor.internals.adapter;
	const doc = editor.internals.crdtDoc;
	const ydoc = adapter.raw<{
		getMap(name: string): {
			get(key: string): { get(field: string): unknown } | undefined;
		};
	}>(doc);
	return (
		(ydoc
			.getMap("blocks")
			.get(blockId)
			?.get("content") as FieldEditorTextLike | null) ?? null
	);
}
