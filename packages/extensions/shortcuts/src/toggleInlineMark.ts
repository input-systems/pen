import {
	fieldEditorHostFacet,
	isCollapsed,
	selectionToRange,
} from "@input/pen-core";
import type {
	DocumentOp,
	Editor,
	FieldEditor,
	TextSelection,
} from "@input/pen-types";

/**
 * Toggle an inline mark over the current text selection, returning
 * whether the toggle was expressible. The mark is removed only when
 * every character in range already carries it; a partially marked range
 * gains the mark instead, which is what makes repeated presses
 * converge. On a collapsed selection there is no text to format, so the
 * mark becomes a pending mark on the attached field editor and applies
 * to the next typed character.
 *
 * Returns `false` when the selection is not text, the mark is not in the
 * schema, or a collapsed toggle has no rich-text field editor to hold
 * the pending mark.
 */
export function toggleInlineMark(editor: Editor, markType: string): boolean {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") return false;
	if (!editor.schema.resolveInline(markType)) return false;

	const fieldEditor = getAttachedFieldEditor(editor);
	if (isCollapsed(selection)) {
		if (
			!fieldEditor ||
			fieldEditor.inputMode !== "richtext" ||
			!fieldEditor.togglePendingMark
		) {
			return false;
		}
		return fieldEditor.togglePendingMark(markType);
	}

	const segments = getSelectionSegments(editor, selection);
	if (segments.length === 0) return false;

	fieldEditor?.clearPendingMarks?.();

	const hasMark = hasMarkAcrossSegments(editor, segments, markType);
	editor.apply(buildFormatTextOps(segments, markType, hasMark ? null : true), {
		origin: "user",
	});
	return true;
}

function getAttachedFieldEditor(editor: Editor): FieldEditor | null {
	return (editor.facet(fieldEditorHostFacet) as FieldEditor | null) ?? null;
}

function isInlineMarkEditableBlock(editor: Editor, blockId: string): boolean {
	const block = editor.getBlock(blockId);
	if (!block) return false;

	const schema = editor.schema.resolve(block.type);
	if (!schema) return false;
	if (schema.fieldEditor && schema.fieldEditor !== "richtext") return false;
	return schema.content === "inline";
}

function getBlockTextLength(editor: Editor, blockId: string): number {
	return editor.getBlock(blockId)?.textContent().length ?? 0;
}

function getSelectionSegments(
	editor: Editor,
	selection: TextSelection,
): Array<{ blockId: string; start: number; end: number }> {
	const range = selectionToRange(editor.internals.doc, selection);
	const blockIds = range.blockRange;
	const segments: Array<{ blockId: string; start: number; end: number }> = [];

	for (let index = 0; index < blockIds.length; index++) {
		const blockId = blockIds[index]!;
		if (!isInlineMarkEditableBlock(editor, blockId)) continue;

		const blockLength = getBlockTextLength(editor, blockId);
		const start = index === 0 ? range.start.offset : 0;
		const end =
			index === blockIds.length - 1 ? range.end.offset : blockLength;
		if (end > start) {
			segments.push({ blockId, start, end });
		}
	}

	return segments;
}

function hasMarkAcrossSegments(
	editor: Editor,
	segments: Array<{ blockId: string; start: number; end: number }>,
	markType: string,
): boolean {
	if (segments.length === 0) return false;

	for (const segment of segments) {
		const block = editor.getBlock(segment.blockId);
		if (!block) return false;

		const deltas = block.textDeltas();
		let offset = 0;

		for (const delta of deltas) {
			const len = delta.insert.length;
			const segStart = offset;
			const segEnd = offset + len;
			offset = segEnd;

			if (segEnd <= segment.start || segStart >= segment.end) continue;
			if (!delta.attributes?.[markType]) {
				return false;
			}
		}
	}

	return true;
}

/**
 * Set an inline mark to an explicit value over the current text
 * selection, or clear it with `null`. Unlike
 * {@link toggleInlineMark} this does not read the existing marks, so it
 * suits marks carrying attributes a caller already holds — a link href,
 * a comment id — where toggling would discard them.
 *
 * Returns `false` when the selection is collapsed, is not text, or the
 * mark is not in the schema: there is no pending-mark equivalent for a
 * value the caller chose.
 */
export function setInlineMark(
	editor: Editor,
	markType: string,
	value: Record<string, unknown> | null,
): boolean {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") return false;
	if (!editor.schema.resolveInline(markType)) return false;

	const fieldEditor = getAttachedFieldEditor(editor);
	if (isCollapsed(selection)) {
		return false;
	}

	const segments = getSelectionSegments(editor, selection);
	if (segments.length === 0) return false;

	fieldEditor?.clearPendingMarks?.();

	editor.apply(buildFormatTextOps(segments, markType, value), {
		origin: "user",
	});
	return true;
}

function buildFormatTextOps(
	segments: Array<{ blockId: string; start: number; end: number }>,
	markType: string,
	nextValue: Record<string, unknown> | true | null,
): DocumentOp[] {
	return segments.map((segment) => ({
		type: "format-text",
		blockId: segment.blockId,
		from: segment.start,
		to: segment.end,
		marks: { [markType]: nextValue },
	}));
}
