import type { DocumentOp, Editor } from "@input/pen-types";
import type { FieldEditorInputController, ActiveCellCoord } from "./controller";
import type { FieldEditorTextLike } from "./crdt";
import {
	buildInlineTextDiffOps,
	buildInlineTextEditTransaction,
	type InlineTextDiffOp,
	type InlineTextRange,
	type InlineTextSelectionTarget,
} from "./inlineTextTransaction";

type TextInputPipelineController = Pick<
	FieldEditorInputController,
	"setBackendSelectionAuthority" | "syncTextSelection" | "resolveInsertMarks"
>;

export interface ApplyInlineTextInputOptions {
	editor: Editor;
	fieldEditor: TextInputPipelineController;
	blockId: string;
	range: InlineTextRange;
	text: string;
	marks?: Record<string, unknown>;
	cellCoord?: ActiveCellCoord | null;
	selection?: InlineTextSelectionTarget | null;
	syncSelection?: boolean;
}

export interface ApplyInlineTextDiffInputOptions {
	editor: Editor;
	fieldEditor: TextInputPipelineController;
	blockId: string;
	diff: readonly InlineTextDiffOp[];
	ytext: FieldEditorTextLike;
	selection?: InlineTextSelectionTarget | null;
	cellCoord?: ActiveCellCoord | null;
}

export interface ApplyInlineTextDiffInputResult {
	applied: boolean;
	selection: InlineTextSelectionTarget | null;
}

export function applyInlineTextInput(
	options: ApplyInlineTextInputOptions,
): InlineTextSelectionTarget {
	const transaction = buildInlineTextEditTransaction({
		blockId: options.blockId,
		range: options.range,
		text: options.text,
		marks: options.marks,
		cellCoord: options.cellCoord,
	});
	const selection = options.selection ?? transaction.selection;
	if (options.syncSelection === false) {
		if (transaction.ops.length > 0) {
			options.editor.apply(transaction.ops, { origin: "user" });
		}
		return selection;
	}
	applyInlineTextOperations(options, transaction.ops, selection);
	return selection;
}

export function applyInlineTextDiffInput(
	options: ApplyInlineTextDiffInputOptions,
): ApplyInlineTextDiffInputResult {
	if (options.diff.length === 0) {
		return { applied: false, selection: null };
	}

	const ops = buildInlineTextDiffOps({
		blockId: options.blockId,
		diff: options.diff,
		ytext: options.ytext,
		resolveInsertMarks: (sourceText, offset) =>
			options.fieldEditor.resolveInsertMarks(sourceText, offset),
		cellCoord: options.cellCoord,
	});
	if (ops.length === 0) {
		return { applied: false, selection: null };
	}

	if (!options.selection) {
		options.editor.apply(ops, { origin: "user" });
		return { applied: true, selection: null };
	}

	applyInlineTextOperations(options, ops, options.selection);
	return { applied: true, selection: options.selection };
}

function applyInlineTextOperations(
	options: {
		editor: Editor;
		fieldEditor: TextInputPipelineController;
		blockId: string;
		cellCoord?: ActiveCellCoord | null;
	},
	ops: readonly DocumentOp[],
	selection: InlineTextSelectionTarget,
): void {
	// The cell caret is not in the authority yet (W3.R18): stamp it before
	// the apply so the rebuild the apply triggers restores it.
	if (options.cellCoord) {
		options.fieldEditor.setBackendSelectionAuthority("cell", selection);
	}

	if (ops.length > 0) {
		options.editor.apply([...ops], { origin: "user" });
	}

	if (options.cellCoord) {
		return;
	}

	options.fieldEditor.syncTextSelection(
		options.blockId,
		selection.anchorOffset,
		selection.focusOffset,
	);
}
