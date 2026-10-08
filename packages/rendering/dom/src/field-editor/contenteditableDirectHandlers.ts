import { getLogicalInlineText } from "./commandsShared";
import {
	deleteBackward,
	deleteForward,
	historyRedo,
	historyUndo,
	insertLineBreak,
	insertText as insertTextCommand,
	isCollapsed,
	isMultiBlock,
	localeFacet,
	nextGraphemeBoundary,
	nextWordBoundary,
	previousGraphemeBoundary,
	previousWordBoundary,
	splitBlock,
	toggleMark,
} from "@input/pen-core";
import type { Command, Editor } from "@input/pen-types";
import type { FieldEditorInputController } from "./controller";
import type { FieldEditorTextLike } from "./crdt";
import { resolveFieldInsertMarks } from "./pendingMarkController";
import { toggleInlineMark } from "./commands";
import {
	dispatchAndActivate,
	dispatchEditorCommand,
	syncEditorTextSelection,
} from "./commandDispatch";
import { reportCellMarkDecline } from "./cellMarkDecline";
import { getPasteImporters, handlePaste } from "./clipboard";
import { staticRangeToOffsets } from "./contenteditableDomHelpers";

export interface ContentEditableDirectInputBackend {
	resolveCurrentInputRange(): { start: number; end: number } | null;
	applyListInputRule(options: {
		blockId: string;
		range: { start: number; end: number };
		text: string;
	}): boolean;
	applyInlineTextEdit(options: {
		blockId: string;
		range: { start: number; end: number };
		text: string;
		marks?: Record<string, unknown>;
	}): void;
	commitDispatchedEdit?(): void;
}

export type DirectHandler = (
	event: InputEvent,
	editor: Editor,
	ytext: FieldEditorTextLike,
	fieldEditor: FieldEditorInputController,
	element: HTMLElement,
	backend: ContentEditableDirectInputBackend,
) => void;

const insertText: DirectHandler = (
	event,
	editor,
	ytext,
	fe,
	_element,
	backend,
) => {
	insertTextOverRange(event, editor, ytext, fe, backend, () =>
		backend.resolveCurrentInputRange(),
	);
};

/**
 * A word or line delete. Undispatched, it removes a non-collapsed range, else
 * the span from the caret to `boundary` in the delete's direction.
 */
function boundaryDelete(
	command: typeof deleteBackward | typeof deleteForward,
	granularity: "word" | "line",
	boundary: (
		ytext: FieldEditorTextLike,
		caret: number,
		editor: Editor,
	) => number,
): DirectHandler {
	return (_event, editor, ytext, fe, _element, backend) => {
		const resolved = resolveUndispatchedDelete(
			editor,
			fe,
			backend,
			command,
			granularity,
		);
		if (!resolved) return;
		const { blockId, range } = resolved;

		if (range.start !== range.end) {
			deleteInlineRange(backend, blockId, range);
			return;
		}

		const caret = range.start;
		const target = boundary(ytext, caret, editor);
		if (command === deleteBackward ? target < caret : target > caret) {
			deleteInlineRange(backend, blockId, {
				start: Math.min(target, caret),
				end: Math.max(target, caret),
			});
		}
	};
}

const deleteLineBackward = boundaryDelete(deleteBackward, "line", () => 0);

const deleteLineForward = boundaryDelete(
	deleteForward,
	"line",
	(ytext) => getLogicalInlineText(ytext).length,
);

// command-policy implementations; preventDefault / allow / block live in BEFOREINPUT_MAP
export const DIRECT_HANDLERS: Record<string, DirectHandler> = {
	insertText,
	insertFromDrop: insertText,

	insertReplacementText: (event, editor, ytext, fe, element, backend) => {
		insertTextOverRange(event, editor, ytext, fe, backend, () => {
			const targetRanges = event.getTargetRanges?.();
			return targetRanges?.length
				? staticRangeToOffsets(targetRanges[0], element)
				: backend.resolveCurrentInputRange();
		});
	},

	deleteContentBackward: (_event, editor, ytext, fe, element, backend) => {
		if (hasMultiBlockTextSelection(editor)) {
			editor.deleteSelection();
			return;
		}
		const resolved = resolveUndispatchedDelete(
			editor,
			fe,
			backend,
			deleteBackward,
			"grapheme",
		);
		if (!resolved) return;
		const { blockId, range } = resolved;

		if (range.start !== range.end) {
			deleteInlineRange(backend, blockId, range);
			return;
		}

		const start = previousGraphemeBoundary(
			getLogicalInlineText(ytext),
			range.start,
			resolveEditorLocale(editor),
		);
		if (start < range.start) {
			deleteInlineRange(backend, blockId, { start, end: range.start });
		}
	},

	deleteContentForward: (_event, editor, ytext, fe, element, backend) => {
		if (hasMultiBlockTextSelection(editor)) {
			editor.deleteSelection();
			return;
		}
		const resolved = resolveUndispatchedDelete(
			editor,
			fe,
			backend,
			deleteForward,
			"grapheme",
		);
		if (!resolved) return;
		const { blockId, range } = resolved;

		if (range.start !== range.end) {
			deleteInlineRange(backend, blockId, range);
			return;
		}

		const start = range.start;
		const end = nextGraphemeBoundary(
			getLogicalInlineText(ytext),
			start,
			resolveEditorLocale(editor),
		);
		if (end > start) {
			deleteInlineRange(backend, blockId, { start, end });
		}
	},

	deleteWordBackward: boundaryDelete(
		deleteBackward,
		"word",
		(ytext, caret, editor) =>
			previousWordBoundary(
				getLogicalInlineText(ytext),
				caret,
				resolveEditorLocale(editor),
			),
	),

	deleteSoftLineBackward: deleteLineBackward,
	deleteHardLineBackward: deleteLineBackward,

	deleteSoftLineForward: deleteLineForward,
	deleteHardLineForward: deleteLineForward,

	deleteWordForward: boundaryDelete(
		deleteForward,
		"word",
		(ytext, caret, editor) =>
			nextWordBoundary(
				getLogicalInlineText(ytext),
				caret,
				resolveEditorLocale(editor),
			),
	),

	insertParagraph: (_event, editor, _ytext, fe, _element, backend) => {
		if (!fe.focusBlockId) return;
		tryDispatchMapped(
			editor,
			fe,
			backend,
			splitBlock,
			undefined,
			backend.resolveCurrentInputRange(),
		);
	},

	insertLineBreak: (_event, editor, ytext, fe, element, backend) => {
		const range = backend.resolveCurrentInputRange();
		if (!range) return;
		const blockId = fe.focusBlockId;
		if (!blockId) return;
		if (
			tryDispatchMapped(
				editor,
				fe,
				backend,
				insertLineBreak,
				undefined,
				range,
			)
		) {
			return;
		}
		backend.applyInlineTextEdit({
			blockId,
			range,
			text: "\n",
			marks: resolveFieldInsertMarks(
				fe.pendingMarks,
				editor.schema,
				ytext,
				range.start,
			),
		});
	},

	historyUndo: (_event, editor, _ytext, fe, _element, backend) => {
		if (tryDispatchMapped(editor, fe, backend, historyUndo, undefined)) {
			return;
		}
		editor.undoManager.undo();
	},

	historyRedo: (_event, editor, _ytext, fe, _element, backend) => {
		if (tryDispatchMapped(editor, fe, backend, historyRedo, undefined)) {
			return;
		}
		editor.undoManager.redo();
	},

	insertFromPaste: (event, editor, _ytext, fe) => {
		handlePaste(event, editor, fe, getPasteImporters(editor));
	},

	formatBold: (_event, editor, _ytext, fe) => {
		toggleMarkOrReport(editor, fe, "bold");
	},

	formatItalic: (_event, editor, _ytext, fe) => {
		toggleMarkOrReport(editor, fe, "italic");
	},

	formatUnderline: (_event, editor, _ytext, fe) => {
		toggleMarkOrReport(editor, fe, "underline");
	},
};

/**
 * Toggle a mark, and say so when a table cell is why nothing happened.
 *
 * Both toggle paths need a text selection, and cell editing holds a `cell`
 * selection, so marks are declared unsupported inside a cell
 * (`CELL-PARITY.md`, FE6). Declining used to be silent, which is the one
 * outcome FE6 rules out: the press left no trace, so a host had no way to
 * tell "not here" from "broken".
 */
function toggleMarkOrReport(
	editor: Editor,
	fe: FieldEditorInputController,
	mark: string,
): void {
	if (tryDispatchMarkToggle(editor, fe, mark)) {
		return;
	}
	if (toggleInlineMark(editor, mark)) {
		return;
	}
	if (!isCellEditing(editor, fe)) {
		return;
	}
	reportCellMarkDecline(editor, mark);
}

function isCellEditing(
	editor: Editor,
	fe: FieldEditorInputController,
): boolean {
	if (fe.activeCellCoord != null || editor.selection?.type === "cell") {
		return true;
	}
	const blockId = fe.focusBlockId;
	if (!blockId) {
		return false;
	}
	return editor.getBlock(blockId)?.type === "table";
}

type InlineRange = { start: number; end: number };

/**
 * The shared `insertText` / `insertReplacementText` body; the two differ only
 * in where the raw input range comes from.
 */
function insertTextOverRange(
	event: InputEvent,
	editor: Editor,
	ytext: FieldEditorTextLike,
	fe: FieldEditorInputController,
	backend: ContentEditableDirectInputBackend,
	resolveInputRange: () => InlineRange | null,
): void {
	const text = event.data ?? "";
	if (!text) return;
	if (hasMultiBlockTextSelection(editor)) {
		editor.replaceSelection(text);
		return;
	}
	const blockId = fe.focusBlockId;
	if (!blockId) return;
	const range = resolveFieldInsertRange(editor, fe, resolveInputRange());
	if (!range) return;
	if (backend.applyListInputRule({ blockId, range, text })) {
		return;
	}
	const marks = resolveFieldInsertMarks(
		fe.pendingMarks,
		editor.schema,
		ytext,
		range.start,
	);
	if (tryDispatchInsert(editor, fe, backend, blockId, range, text, marks)) {
		return;
	}
	backend.applyInlineTextEdit({
		blockId,
		range,
		text,
		marks,
	});
}

/**
 * Resolve the focused block and input range for a delete, and try the mapped
 * core command first. Returns `null` when there is nothing to delete or the
 * command already handled it; otherwise the caller edits the field's own text
 * and nothing else. Block-level outcomes (merge, convert, select) are the core
 * command's alone. A cell never dispatches: its text is not the table block's,
 * so a block-level delete would select the table and clear the cell.
 */
function resolveUndispatchedDelete(
	editor: Editor,
	fe: FieldEditorInputController,
	backend: ContentEditableDirectInputBackend,
	command: typeof deleteBackward | typeof deleteForward,
	granularity: "grapheme" | "word" | "line",
): { blockId: string; range: InlineRange } | null {
	const blockId = fe.focusBlockId;
	if (!blockId) return null;
	const range = backend.resolveCurrentInputRange();
	if (!range) return null;
	if (
		tryDispatchMapped(editor, fe, backend, command, { granularity }, range)
	) {
		return null;
	}
	return { blockId, range };
}

function deleteInlineRange(
	backend: ContentEditableDirectInputBackend,
	blockId: string,
	range: InlineRange,
): void {
	backend.applyInlineTextEdit({
		blockId,
		range,
		text: "",
	});
}

function resolveFieldInsertRange(
	editor: Editor,
	fe: FieldEditorInputController,
	resolvedRange: { start: number; end: number } | null,
): { start: number; end: number } | null {
	if (resolvedRange) {
		return resolvedRange;
	}
	if (isCellEditing(editor, fe)) {
		return null;
	}
	const selection = editor.selection;
	if (
		selection?.type === "text" &&
		selection.focus.blockId === fe.focusBlockId
	) {
		return {
			start: selection.anchor.offset,
			end: selection.focus.offset,
		};
	}
	return null;
}

function tryDispatchMarkToggle(
	editor: Editor,
	fe: FieldEditorInputController,
	mark: string,
): boolean {
	const selection = editor.selection;
	if (!selection || selection.type !== "text" || isCollapsed(selection)) {
		return false;
	}
	return dispatchAndActivate(editor, fe, toggleMark, { mark });
}

function tryDispatchInsert(
	editor: Editor,
	fe: FieldEditorInputController,
	backend: ContentEditableDirectInputBackend,
	blockId: string,
	range: { start: number; end: number },
	text: string,
	marks: Record<string, unknown | null> | undefined,
): boolean {
	if (isCellEditing(editor, fe)) {
		return false;
	}
	syncEditorTextSelection(editor, blockId, range);
	if (!dispatchEditorCommand(editor, insertTextCommand, { text, marks })) {
		return false;
	}
	backend.commitDispatchedEdit?.();
	return true;
}

function tryDispatchMapped<P>(
	editor: Editor,
	fe: FieldEditorInputController,
	backend: ContentEditableDirectInputBackend,
	command: Command<P>,
	param: P,
	range?: { start: number; end: number } | null,
): boolean {
	if (isCellEditing(editor, fe)) {
		return false;
	}
	const blockId = fe.focusBlockId;
	if (blockId && range) {
		syncEditorTextSelection(editor, blockId, range);
	}
	if (!dispatchAndActivate(editor, fe, command, param)) {
		return false;
	}
	backend.commitDispatchedEdit?.();
	return true;
}

function hasMultiBlockTextSelection(editor: Editor): boolean {
	const selection = editor.selection;
	return selection?.type === "text" && isMultiBlock(selection);
}

function resolveEditorLocale(editor: Editor): string {
	const locale = editor.facet(localeFacet);
	if (typeof locale === "string" && locale.length > 0) {
		return locale;
	}
	return "en";
}
