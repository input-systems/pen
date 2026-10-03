import {
	isCollapsed,
	isMultiBlock,
	usesInlineTextSelection,
} from "@input/pen-core";
import {
	generateId,
	type Editor,
	type InteractionModel,
} from "@input/pen-types";
import {
	activateFieldEditorFromSelection,
	keymapContextFromSelection,
} from "../field-editor/commandDispatch";
import type { FieldEditorSession } from "../field-editor/controller";
import {
	handleHistoryShortcut,
	handleSelectAllShortcut,
} from "../field-editor/keyHandling";
import { dispatchKeymapEvent } from "../field-editor/keymap";
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
		handleHistoryShortcut(editor, event)
	);
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
		if (isMultiBlock(selection)) {
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
