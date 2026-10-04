import {
	insertText,
	isCollapsed,
	isMultiBlock,
	usesInlineTextSelection,
} from "@input/pen-core";
import {
	generateId,
	type Editor,
	type InteractionModel,
} from "@input/pen-types";
import { FOCUS_SINK_ATTR } from "../a11y/focusSink";
import {
	activateFieldEditorFromSelection,
	dispatchAndActivate,
	keymapContextFromSelection,
} from "../field-editor/commandDispatch";
import type { FieldEditorSession } from "../field-editor/controller";
import {
	handleHistoryShortcut,
	handleSelectAllShortcut,
} from "../field-editor/keyHandling";
import { dispatchKeymapEvent } from "../field-editor/keymap";
import {
	isCompositionKeyDown,
	isUndecidedCompositionKeyDown,
} from "./compositionKeyDown";
import { DATA_ATTRS } from "./dataAttributes";
import { handleEscapeSelectionTransition } from "./escapeSelection";
import { handleTableCellSelectionKeyDown } from "./tableCellNavigation";
import { shouldHandleEditorKeyboardEvent } from "./textEntryTarget";

/** Arguments for {@link bindEditorDocumentKeyDown}. */
export type BindEditorDocumentKeyDownOptions = {
	editor: Editor;
	fieldEditor: FieldEditorSession;
	root: HTMLElement;
	getInteractionModel?: () => InteractionModel | undefined;
};

function isDocumentBubbleKey(key: string): boolean {
	return key === "Escape" || key === "Enter";
}

/**
 * Document key routing for an editor root. Escape (HOST7) and
 * block-selection Enter (HOST8) are bubbling defaults so a host or
 * overlay can preventDefault first. Other document shortcuts stay in
 * capture.
 */
export function bindEditorDocumentKeyDown(
	options: BindEditorDocumentKeyDownOptions,
): () => void {
	const { editor, fieldEditor, root, getInteractionModel } = options;
	const doc = root.ownerDocument;
	if (!doc) {
		return () => {};
	}

	const route = (event: KeyboardEvent): void => {
		if (
			!shouldHandleEditorKeyboardEvent({
				root,
				event,
				selection: editor.selection,
				hasMappedDomSelection: () => fieldEditor.hasSelectionInRoot(),
			})
		) {
			return;
		}
		// D20: not prevented, so the composition starts in the field.
		if (handleSubstituteCompositionKeyDown(event, editor, fieldEditor)) {
			return;
		}
		if (
			handleEditorDocumentKeyDown({
				event,
				editor,
				fieldEditor,
				interactionModel: getInteractionModel?.(),
				root,
			})
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	};

	const onCapture = (event: KeyboardEvent): void => {
		if (isDocumentBubbleKey(event.key)) {
			return;
		}
		route(event);
	};

	const onBubble = (event: KeyboardEvent): void => {
		if (!isDocumentBubbleKey(event.key)) {
			return;
		}
		route(event);
	};

	doc.addEventListener("keydown", onCapture, true);
	doc.addEventListener("keydown", onBubble, false);
	return () => {
		doc.removeEventListener("keydown", onCapture, true);
		doc.removeEventListener("keydown", onBubble, false);
	};
}

export function handleEditorDocumentKeyDown(options: {
	event: KeyboardEvent;
	editor: Editor;
	fieldEditor: FieldEditorSession;
	interactionModel?: InteractionModel;
	root: HTMLElement;
}): boolean {
	const { event, editor, fieldEditor, interactionModel, root } = options;

	return (
		handleEscapeSelectionTransition({ event, editor, fieldEditor }) ||
		handleDeleteSelectionShortcut(event, editor, fieldEditor, root) ||
		handleTableCellSelectionKeyDown({ event, editor, fieldEditor, root }) ||
		handleSelectAllShortcut(editor, event, fieldEditor) ||
		handleBlockSelectionEnter(
			event,
			editor,
			fieldEditor,
			interactionModel,
		) ||
		handleBlockSelectionArrow(event, editor, fieldEditor) ||
		handleHistoryShortcut(editor, event) ||
		handleSubstituteRangeKeyDown(event, editor, fieldEditor)
	);
}

/**
 * D5: a text range in a substitute state keeps focus on the sink, which is
 * not editable, so the sink's keys reach the authority here.
 */
function isSubstituteSinkKey(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
): boolean {
	const target = event.target as { hasAttribute?: unknown } | null;
	return (
		typeof target?.hasAttribute === "function" &&
		(target as Element).hasAttribute(FOCUS_SINK_ATTR) &&
		editor.selection?.type === "text" &&
		fieldEditor.getSubstituteState() !== null
	);
}

function isPrintableKey(event: KeyboardEvent): boolean {
	return (
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey &&
		[...event.key].length === 1
	);
}

/**
 * D20: a composition keystroke over a D5 range deletes the range and
 * projects the caret into its field, focused in this `keydown` turn, so the
 * composition starts there. An undecided keystroke (an Android keyboard's
 * keyCode 229, which may be Backspace) is left alone: the sink is not
 * editable, so the input that would decide it never reaches the sink, and
 * deleting on the keydown would let that input delete again.
 */
function handleSubstituteCompositionKeyDown(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
): boolean {
	const undecided = isUndecidedCompositionKeyDown(event);
	if (
		(!undecided && !isCompositionKeyDown(event)) ||
		!isSubstituteSinkKey(event, editor, fieldEditor)
	) {
		return false;
	}
	if (!undecided) {
		deleteTextRangeAndActivate(editor, fieldEditor);
	}
	return true;
}

/**
 * D5: the sink routes the text keymap against the authority, as a field
 * does with no DOM range. A printable key replaces the range with one
 * `pen.insertText`, mirroring the cell printable path.
 */
function handleSubstituteRangeKeyDown(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
): boolean {
	if (!isSubstituteSinkKey(event, editor, fieldEditor)) {
		return false;
	}
	if (isPrintableKey(event)) {
		return dispatchAndActivate(
			editor,
			fieldEditor,
			insertText,
			{ text: event.key },
			{ fromKeymap: true },
		);
	}
	if (
		!dispatchKeymapEvent(editor, event, {
			composing: false,
			context: keymapContextFromSelection(editor.selection, false),
		})
	) {
		return false;
	}
	activateFieldEditorFromSelection(editor, fieldEditor);
	return true;
}

/** Deletes a non-collapsed text range and projects the resulting caret into its field. */
function deleteTextRangeAndActivate(
	editor: Editor,
	fieldEditor: FieldEditorSession,
): void {
	if (editor.selection?.type === "text" && isMultiBlock(editor.selection)) {
		fieldEditor.deactivate();
	}
	editor.deleteSelection({ origin: "user" });
	const nextSelection = editor.selection;
	if (nextSelection?.type === "text") {
		fieldEditor.activateTextSelection(
			nextSelection.focus.blockId,
			nextSelection.focus.offset,
			nextSelection.focus.offset,
			{ origin: "keyboard" },
		);
	} else {
		fieldEditor.deactivate();
	}
}

function handleBlockSelectionArrow(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
): boolean {
	if (
		event.key !== "ArrowUp" &&
		event.key !== "ArrowDown" &&
		event.key !== "ArrowLeft" &&
		event.key !== "ArrowRight"
	) {
		return false;
	}

	const selection = editor.selection;
	if (selection?.type !== "block" || selection.blockIds.length === 0) {
		return false;
	}

	if (
		!dispatchKeymapEvent(editor, event, {
			composing: event.isComposing === true,
			context: keymapContextFromSelection(selection, false),
		})
	) {
		return false;
	}

	event.preventDefault();
	activateFieldEditorFromSelection(editor, fieldEditor);
	return true;
}

function handleBlockSelectionEnter(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
	interactionModel: InteractionModel = "content-first",
): boolean {
	if (
		event.defaultPrevented ||
		event.key !== "Enter" ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.isComposing
	) {
		return false;
	}

	const selection = editor.selection;
	if (selection?.type !== "block" || selection.blockIds.length === 0) {
		return false;
	}

	const anchorBlockId = selection.blockIds[selection.blockIds.length - 1]!;
	const anchorBlock = editor.getBlock(anchorBlockId);
	if (!anchorBlock) {
		return false;
	}
	const anchorSchema = editor.schema.resolve(anchorBlock.type);

	if (
		interactionModel === "block-first" &&
		selection.blockIds.length === 1 &&
		usesInlineTextSelection(anchorSchema)
	) {
		const offset = anchorBlock.length();
		fieldEditor.activateTextSelection(anchorBlockId, offset, offset, {
			origin: "keyboard",
		});
		return true;
	}

	const newBlockId = generateId();

	editor.apply(
		[
			{
				type: "insert-block",
				blockId: newBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: anchorBlockId },
			},
		],
		{ origin: "user" },
	);

	fieldEditor.activateTextSelection(newBlockId, 0, 0, { origin: "keyboard" });
	return true;
}

function handleDeleteSelectionShortcut(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
	root: HTMLElement,
): boolean {
	if (
		(event.key !== "Backspace" && event.key !== "Delete") ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.isComposing ||
		fieldEditor.isComposing
	) {
		return false;
	}

	const selection = editor.selection;
	if (!selection) {
		return false;
	}

	if (selection.type === "text" && !isCollapsed(selection)) {
		if (
			!isMultiBlock(selection) &&
			!textSelectionContainsInlineAtom(editor, selection) &&
			!shouldUseDocumentTextDeletionFallback(root, fieldEditor)
		) {
			return false;
		}
		deleteTextRangeAndActivate(editor, fieldEditor);
		return true;
	}

	if (selection.type === "block" && selection.blockIds.length > 0) {
		editor.deleteSelection({ origin: "user" });
		fieldEditor.deactivate();
		const firstBlock = editor.firstBlock();
		if (firstBlock) {
			const schema = editor.schema.resolve(firstBlock.type);
			if (usesInlineTextSelection(schema)) {
				fieldEditor.activateTextSelection(firstBlock.id, 0, 0, {
					origin: "keyboard",
				});
			}
		}
		return true;
	}

	if (selection.type === "cell") {
		editor.deleteSelection({ origin: "user" });
		return true;
	}

	return false;
}

function textSelectionContainsInlineAtom(
	editor: Editor,
	selection: Extract<NonNullable<Editor["selection"]>, { type: "text" }>,
): boolean {
	if (
		isMultiBlock(selection) ||
		selection.anchor.blockId !== selection.focus.blockId
	) {
		return false;
	}

	const block = editor.getBlock(selection.anchor.blockId);
	if (!block) {
		return false;
	}

	const selectionStart = Math.min(
		selection.anchor.offset,
		selection.focus.offset,
	);
	const selectionEnd = Math.max(
		selection.anchor.offset,
		selection.focus.offset,
	);
	if (selectionEnd <= selectionStart) {
		return false;
	}

	let offset = 0;
	for (const delta of block.inlineDeltas()) {
		const length =
			typeof delta.insert === "string" ? delta.insert.length : 1;
		const overlapsSelection =
			offset < selectionEnd && offset + length > selectionStart;
		if (typeof delta.insert !== "string" && overlapsSelection) {
			return true;
		}
		offset += length;
	}

	return false;
}

function shouldUseDocumentTextDeletionFallback(
	root: HTMLElement,
	fieldEditor: FieldEditorSession,
): boolean {
	if (!fieldEditor.isEditing) {
		return true;
	}

	const activeElement = root.ownerDocument?.activeElement;
	if (
		!(activeElement instanceof HTMLElement) ||
		!root.contains(activeElement)
	) {
		return true;
	}

	if (activeElement === root) {
		return true;
	}

	const activeInlineSurface = activeElement.closest(
		`[${DATA_ATTRS.inlineContent}]`,
	);
	if (activeInlineSurface === null) {
		return true;
	}

	return false;
}
