import {
	caretDown,
	caretLeft,
	caretRight,
	caretUp,
	getInlineCompletionController,
	historyRedo,
	historyUndo,
	isCollapsed,
	isMultiBlock,
	setCellCaretFocus,
} from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import type { FieldEditorKeyboardController } from "./controller";
import {
	activateFieldEditorFromSelection,
	dispatchEditorCommand,
	keymapContextFromSelection,
	syncEditorTextSelection,
} from "./commandDispatch";
import type { SelectionRange } from "./commands";
import { getAutocompleteController } from "../utils/autocompleteController";
import { selectInlineAtomWithArrowKey } from "./keyHandlingInlineAtoms";
import {
	collectKeyBindings,
	isRedoShortcut,
	isSelectAllShortcut,
	isUndoShortcut,
	matchesBindingContext,
	matchesKey,
	tryHandleHistoryOverrideBinding,
} from "./keyBindingShortcuts";
import { dispatchKeymapEvent } from "./keymap";
import {
	isNavigationSelectionKey,
	measureVisualLineEdge,
} from "./contenteditableDomHelpers";

const LINE_EDGE_SEAM = Symbol.for("pen.lineEdgeSeam");

type LineEdgeMeasure = (
	editor: Editor,
	current: { blockId: string; offset: number },
	edge: "start" | "end",
) => { blockId: string; offset: number } | null;

export function ensureLineEdgeMeasure(editor: Editor): void {
	const host = editor as unknown as Record<
		symbol,
		LineEdgeMeasure | undefined
	>;
	if (host[LINE_EDGE_SEAM]) {
		return;
	}
	host[LINE_EDGE_SEAM] = (_ed, current, edge) =>
		measureVisualLineEdge(current, edge);
}

export function handleFieldEditorKeyDown(options: {
	event: KeyboardEvent;
	editor: Editor;
	fieldEditor: FieldEditorKeyboardController;
	ytext: {
		length: number;
		toString(): string;
		toDelta(): Array<{ insert?: string | Record<string, unknown> }>;
		insert(offset: number, text: string): void;
		delete(offset: number, length: number): void;
	};
	range: SelectionRange | null;
}): boolean {
	const { event, editor, fieldEditor, ytext, range } = options;
	const blockId = fieldEditor.focusBlockId;
	if (!blockId) return false;
	const autocomplete = getAutocompleteController(editor);

	if (shouldDismissAutocompleteOnKeyDown(event, autocomplete)) {
		autocomplete?.dismiss("typing");
	}

	if (!event.defaultPrevented && handleHistoryShortcut(editor, event)) {
		return true;
	}

	if (
		!event.defaultPrevented &&
		handleSelectAllShortcut(editor, event, fieldEditor)
	) {
		return true;
	}

	if (fieldEditor.activeCellCoord) {
		const tableHandled = handleTableCellKey(
			event,
			editor,
			fieldEditor,
			range,
		);
		if (tableHandled !== null) {
			return tableHandled;
		}
	}

	if (
		(event.key === "ArrowLeft" || event.key === "ArrowRight") &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey &&
		selectInlineAtomWithArrowKey({
			blockId,
			editor,
			event,
			fieldEditor,
			range,
			ytext,
		})
	) {
		return true;
	}

	if (range && editor.selection?.type !== "cell") {
		syncEditorTextSelection(editor, blockId, range);
	}

	ensureLineEdgeMeasure(editor);

	if (
		dispatchKeymapEvent(editor, event, {
			composing: event.isComposing === true,
			context: keymapContextFromSelection(
				editor.selection,
				!!fieldEditor.activeCellCoord,
			),
		})
	) {
		event.preventDefault();
		activateFieldEditorFromSelection(editor, fieldEditor);
		return true;
	}

	if (
		event.key === "Tab" &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey
	) {
		const inlineCompletion = getInlineCompletionController(editor);
		if (inlineCompletion?.hasVisibleSuggestion()) {
			event.preventDefault();
			if (autocomplete?.hasVisibleSuggestion()) {
				return autocomplete.acceptVisibleSuggestion();
			}
			const accepted = inlineCompletion.acceptSuggestion();
			if (accepted) {
				syncAcceptedInlineCompletionSelection(editor, fieldEditor);
			}
			return accepted;
		}

		if (!event.shiftKey) {
			if (autocomplete?.request({ explicit: true })) {
				event.preventDefault();
				return true;
			}
		}
	}

	if (handleEditorKeyBindings(editor, event, { includeSelectAll: false })) {
		return true;
	}

	if (event.isComposing === true) {
		return false;
	}
	if (isNavigationSelectionKey(event)) {
		event.preventDefault();
		return true;
	}

	return false;
}

function handleTableCellKey(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorKeyboardController,
	range: SelectionRange | null,
): boolean | null {
	if (
		event.key === "Tab" &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey
	) {
		event.preventDefault();
		const coord = fieldEditor.activeCellCoord;
		if (!coord) return true;
		const block = editor.getBlock(coord.blockId);
		if (block) {
			const table = block.as("table");
			const rowCount = table?.tableRowCount() ?? 0;
			const colCount = table?.tableColumnCount() ?? 0;
			let nextRow = coord.row;
			let nextCol = coord.col;

			if (event.shiftKey) {
				nextCol--;
				if (nextCol < 0) {
					nextRow--;
					nextCol = colCount - 1;
				}
				if (nextRow < 0) {
					nextRow = 0;
					nextCol = 0;
				}
			} else {
				nextCol++;
				if (nextCol >= colCount) {
					nextRow++;
					nextCol = 0;
				}
				if (nextRow >= rowCount) {
					nextRow = rowCount - 1;
					nextCol = colCount - 1;
				}
			}

			fieldEditor.activateCell(coord.blockId, nextRow, nextCol);
		}
		return true;
	}

	if (
		event.key === "Enter" &&
		!event.shiftKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey
	) {
		event.preventDefault();
		const coord = fieldEditor.activeCellCoord;
		if (!coord) return true;
		const block = editor.getBlock(coord.blockId);
		if (block) {
			const rowCount = block.as("table")?.tableRowCount() ?? 0;
			const nextRow = Math.min(coord.row + 1, rowCount - 1);
			fieldEditor.activateCell(coord.blockId, nextRow, coord.col);
		}
		return true;
	}

	if (
		isCellArrowKey(event.key) &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey
	) {
		const coord = fieldEditor.activeCellCoord;
		if (!coord) {
			return true;
		}
		const command = caretCommandForCellArrow(event.key);
		setCellCaretFocus(
			editor,
			{
				blockId: coord.blockId,
				row: coord.row,
				col: coord.col,
				start: range?.start ?? 0,
				end: range?.end ?? 0,
			},
			(next) => {
				fieldEditor.commitCellTextSelection?.(
					coord.blockId,
					coord.row,
					coord.col,
					next.start,
					next.end,
				);
			},
		);
		const handled = dispatchEditorCommand(
			editor,
			command,
			{ extend: event.shiftKey },
			{ origin: "user", fromKeymap: true },
		);
		setCellCaretFocus(editor, null);
		if (!handled) {
			return false;
		}
		event.preventDefault();
		return true;
	}

	return null;
}

type CellArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

function isCellArrowKey(key: string): key is CellArrowKey {
	return (
		key === "ArrowLeft" ||
		key === "ArrowRight" ||
		key === "ArrowUp" ||
		key === "ArrowDown"
	);
}

function caretCommandForCellArrow(key: CellArrowKey) {
	switch (key) {
		case "ArrowLeft":
			return caretLeft;
		case "ArrowRight":
			return caretRight;
		case "ArrowUp":
			return caretUp;
		case "ArrowDown":
			return caretDown;
		default: {
			const _exhaustive: never = key;
			return _exhaustive;
		}
	}
}

function syncAcceptedInlineCompletionSelection(
	editor: Editor,
	fieldEditor: FieldEditorKeyboardController,
): void {
	const selection = editor.selection;
	if (
		selection?.type !== "text" ||
		!isCollapsed(selection) ||
		isMultiBlock(selection)
	) {
		return;
	}

	const blockId = selection.focus.blockId;
	const offset = selection.focus.offset;
	if (typeof fieldEditor.commitProgrammaticTextSelection === "function") {
		fieldEditor.commitProgrammaticTextSelection(blockId, offset, offset);
		return;
	}

	fieldEditor.activateTextSelection(blockId, offset, offset);
}

function shouldDismissAutocompleteOnKeyDown(
	event: KeyboardEvent,
	autocomplete: ReturnType<typeof getAutocompleteController>,
): boolean {
	if (!autocomplete?.hasVisibleSuggestion()) {
		return false;
	}
	if (event.metaKey || event.ctrlKey || event.altKey) {
		return false;
	}
	return (
		event.key.length === 1 ||
		event.key === "Backspace" ||
		event.key === "Delete" ||
		event.key === "Enter"
	);
}

export function handleEditorKeyBindings(
	editor: Editor,
	event: KeyboardEvent,
	options?: { includeSelectAll?: boolean },
): boolean {
	if (event.defaultPrevented) {
		return false;
	}

	const includeSelectAll = options?.includeSelectAll ?? true;
	if (handleHistoryShortcut(editor, event)) {
		return true;
	}

	if (includeSelectAll && handleSelectAllShortcut(editor, event)) {
		return true;
	}

	const bindings = collectKeyBindings(editor);
	for (const binding of bindings) {
		if (
			matchesBindingContext(editor, binding.context) &&
			matchesKey(binding.key, event) &&
			binding.handler(editor, event)
		) {
			return true;
		}
	}

	return false;
}

export function handleSelectAllShortcut(
	editor: Editor,
	event: KeyboardEvent,
	fieldEditor?: FieldEditorKeyboardController,
): boolean {
	if (!isSelectAllShortcut(event)) {
		return false;
	}

	editor.selectAll(fieldEditor?.selectAllBehavior);
	if (fieldEditor) {
		activateFieldEditorFromSelection(editor, fieldEditor);
	}
	return true;
}

export function handleHistoryShortcut(
	editor: Editor,
	event: KeyboardEvent,
): boolean {
	if (tryHandleHistoryOverrideBinding(editor, event)) {
		return true;
	}

	if (isUndoShortcut(event)) {
		if (
			dispatchEditorCommand(editor, historyUndo, undefined, {
				origin: "user",
				fromKeymap: true,
			})
		) {
			return true;
		}
		editor.undoManager.undo();
		return true;
	}

	if (isRedoShortcut(event)) {
		if (
			dispatchEditorCommand(editor, historyRedo, undefined, {
				origin: "user",
				fromKeymap: true,
			})
		) {
			return true;
		}
		editor.undoManager.redo();
		return true;
	}

	return false;
}
