import type { CommandResult, Editor, TextSelection } from "@input/pen-types";

import { documentPreorderBlockIds } from "../editor/documentPreorder";
import { isCollapsed } from "../selection/helpers";
import {
	collapsedAt,
	documentOrderedTextPoints,
	marksAtOffset,
	replaceRangeOps,
	usesInlineMarks,
} from "./helpers";
import type { InsertTextParam, ToggleMarkParam } from "./textParams";

export function handleInsertText(
	editor: Editor,
	param: InsertTextParam,
): CommandResult | false {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		return false;
	}
	const block = editor.getBlock(selection.focus.blockId);
	const marks =
		param.marks !== undefined
			? param.marks
			: block
				? marksAtOffset(block, selection.focus.offset)
				: undefined;
	const replacement = replaceRangeOps(editor, selection, param.text, marks);
	if (!replacement) {
		return false;
	}
	if (replacement.ops.length === 0) {
		return {
			selection: collapsedAt(
				replacement.caret.blockId,
				replacement.caret.offset,
			),
		};
	}
	editor.apply(replacement.ops, {
		origin: "user",
		structural: replacement.structural,
	});
	return {
		selection: collapsedAt(
			replacement.caret.blockId,
			replacement.caret.offset,
		),
	};
}

export function handleInsertLineBreak(editor: Editor): CommandResult | false {
	return handleInsertText(editor, { text: "\n" });
}

export function handleToggleMark(
	editor: Editor,
	param: ToggleMarkParam,
): CommandResult | false {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		return false;
	}
	if (!editor.schema.resolveInline(param.mark)) {
		return false;
	}
	if (isCollapsed(selection)) {
		return false;
	}

	const range = documentOrderedTextPoints(editor, selection);
	if (!range || range.start.blockId !== range.end.blockId) {
		return toggleMarkAcrossBlocks(editor, selection, param);
	}
	if (!usesInlineMarks(editor, range.start.blockId)) {
		return false;
	}

	const hasMark = hasMarkInRange(
		editor,
		range.start.blockId,
		range.start.offset,
		range.end.offset,
		param.mark,
	);
	const nextValue =
		param.value === undefined ? (hasMark ? null : true) : param.value;
	editor.apply(
		[
			{
				type: "format-text",
				blockId: range.start.blockId,
				from: range.start.offset,
				to: range.end.offset,
				marks: { [param.mark]: nextValue },
			},
		],
		{ origin: "user" },
	);
	return true;
}

function toggleMarkAcrossBlocks(
	editor: Editor,
	selection: TextSelection,
	param: ToggleMarkParam,
): CommandResult | false {
	const range = documentOrderedTextPoints(editor, selection);
	if (!range) {
		return false;
	}
	const order = documentPreorderBlockIds(editor);
	const startIndex = editor.documentState.preorderIndexOf(range.start.blockId);
	const endIndex = editor.documentState.preorderIndexOf(range.end.blockId);
	if (startIndex < 0 || endIndex < 0) {
		return false;
	}

	const segments: Array<{ blockId: string; start: number; end: number }> = [];
	for (let index = startIndex; index <= endIndex; index += 1) {
		const blockId = order[index];
		if (!blockId || !usesInlineMarks(editor, blockId)) {
			continue;
		}
		const block = editor.getBlock(blockId);
		if (!block) {
			continue;
		}
		const start = index === startIndex ? range.start.offset : 0;
		const end = index === endIndex ? range.end.offset : block.length();
		if (end > start) {
			segments.push({ blockId, start, end });
		}
	}
	if (segments.length === 0) {
		return false;
	}

	const hasMark = segments.every((segment) =>
		hasMarkInRange(
			editor,
			segment.blockId,
			segment.start,
			segment.end,
			param.mark,
		),
	);
	const nextValue =
		param.value === undefined ? (hasMark ? null : true) : param.value;
	editor.apply(
		segments.map((segment) => ({
			type: "format-text" as const,
			blockId: segment.blockId,
			from: segment.start,
			to: segment.end,
			marks: { [param.mark]: nextValue },
		})),
		{ origin: "user" },
	);
	return true;
}

function hasMarkInRange(
	editor: Editor,
	blockId: string,
	start: number,
	end: number,
	mark: string,
): boolean {
	const block = editor.getBlock(blockId);
	if (!block) {
		return false;
	}
	let offset = 0;
	let covered = false;
	for (const delta of block.textDeltas()) {
		const length = delta.insert.length;
		const segStart = offset;
		const segEnd = offset + length;
		offset = segEnd;
		if (segEnd <= start || segStart >= end) {
			continue;
		}
		covered = true;
		if (!delta.attributes?.[mark]) {
			return false;
		}
	}
	return covered;
}
