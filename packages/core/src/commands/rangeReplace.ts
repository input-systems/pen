import type {
	DocumentOp,
	Editor,
	Point,
	StructuralOriginTag,
	TextSelection,
} from "@input/pen-types";
import {
	sliceDeltasFrom,
	spliceDeleteOp,
	spliceInsertOp,
} from "../ops/recipes";
import { documentPreorderBlockIds } from "../editor/documentPreorder";
import { isEditableTextBlock } from "./commandBlockContext";
import { documentOrderedTextPoints } from "./commandSelection";

export type RangeReplaceResult = {
	ops: DocumentOp[];
	caret: Point;
	structural?: StructuralOriginTag;
};

export function replaceRangeOps(
	editor: Editor,
	selection: TextSelection,
	text: string,
	marks?: Record<string, unknown | null>,
): RangeReplaceResult | null {
	const range = documentOrderedTextPoints(editor, selection);
	if (!range) {
		return null;
	}
	if (range.start.blockId === range.end.blockId) {
		return replaceSingleBlockRange(
			range.start.blockId,
			range.start.offset,
			range.end.offset,
			text,
			marks,
		);
	}
	return replaceMultiBlockRange(editor, range.start, range.end, text, marks);
}

function replaceSingleBlockRange(
	blockId: string,
	start: number,
	end: number,
	text: string,
	marks?: Record<string, unknown | null>,
): RangeReplaceResult {
	const ops: DocumentOp[] = [];
	if (end > start) {
		ops.push(spliceDeleteOp(blockId, start, end - start));
	}
	if (text.length > 0) {
		ops.push(spliceInsertOp(blockId, start, text, marks));
	}
	return {
		ops,
		caret: { blockId, offset: start + text.length },
	};
}

function replaceMultiBlockRange(
	editor: Editor,
	start: Point,
	end: Point,
	text: string,
	marks?: Record<string, unknown | null>,
): { ops: DocumentOp[]; caret: Point } | null {
	const startIndex = editor.documentState.preorderIndexOf(start.blockId);
	const endIndex = editor.documentState.preorderIndexOf(end.blockId);
	if (startIndex < 0 || endIndex < 0 || startIndex >= endIndex) {
		return null;
	}

	const startBlock = editor.getBlock(start.blockId);
	const endBlock = editor.getBlock(end.blockId);
	if (!startBlock || !endBlock) {
		return null;
	}

	const startEditable = isEditableTextBlock(editor, start.blockId);
	const endEditable = isEditableTextBlock(editor, end.blockId);
	if (startEditable && endEditable) {
		return replaceTextToTextRange(
			editor,
			start,
			end,
			text,
			marks,
			startIndex,
			endIndex,
			startBlock.length(),
		);
	}
	return replaceMixedBoundaryRange(
		editor,
		start,
		end,
		text,
		marks,
		startIndex,
		endIndex,
		startEditable,
		endEditable,
		startBlock.length(),
	);
}

/**
 * Text-to-text multi-block replace. Middle structural blocks are
 * deleted; the two text ends merge. A divider sitting between two
 * paragraphs is a middle block, not an N2 endpoint.
 */
function replaceTextToTextRange(
	editor: Editor,
	start: Point,
	end: Point,
	text: string,
	marks: Record<string, unknown | null> | undefined,
	startIndex: number,
	endIndex: number,
	startLength: number,
): RangeReplaceResult {
	const order = documentPreorderBlockIds(editor);
	const ops: DocumentOp[] = [];
	if (start.offset < startLength) {
		ops.push(
			spliceDeleteOp(
				start.blockId,
				start.offset,
				startLength - start.offset,
			),
		);
	}
	if (end.offset > 0) {
		ops.push(spliceDeleteOp(end.blockId, 0, end.offset));
	}
	for (const blockId of order.slice(startIndex + 1, endIndex)) {
		ops.push({ type: "delete-block", blockId });
	}
	const endHandle = editor.getBlock(end.blockId);
	if (endHandle) {
		const remaining = sliceDeltasFrom(endHandle.inlineDeltas(), end.offset);
		let appendAt = start.offset;
		for (const delta of remaining) {
			if (typeof delta.insert === "string") {
				ops.push(
					spliceInsertOp(
						start.blockId,
						appendAt,
						delta.insert,
						delta.attributes,
					),
				);
				appendAt += delta.insert.length;
			} else {
				ops.push({
					type: "splice-text",
					blockId: start.blockId,
					from: appendAt,
					to: appendAt,
					insert: {
						nodeType: delta.insert.type,
						props: { ...delta.insert.props },
					},
				});
				appendAt += 1;
			}
		}
		ops.push({ type: "delete-block", blockId: end.blockId });
	}
	if (text.length > 0) {
		ops.push(spliceInsertOp(start.blockId, start.offset, text, marks));
	}
	return {
		ops,
		caret: { blockId: start.blockId, offset: start.offset + text.length },
		structural: {
			kind: "merge",
			targetBlockId: start.blockId,
			sourceBlockId: end.blockId,
		},
	};
}

/**
 * N2 mixed-boundary replace. A text endpoint mid-paragraph plus a
 * non-text 0..1 endpoint must not become `BlockSelection` of both
 * blocks — that delete would drop the whole paragraph. Delete the
 * covered text suffix/prefix and `delete-block` a fully covered
 * structural end. Do not merge a divider into a paragraph.
 */
function replaceMixedBoundaryRange(
	editor: Editor,
	start: Point,
	end: Point,
	text: string,
	marks: Record<string, unknown | null> | undefined,
	startIndex: number,
	endIndex: number,
	startEditable: boolean,
	endEditable: boolean,
	startLength: number,
): { ops: DocumentOp[]; caret: Point } | null {
	const order = documentPreorderBlockIds(editor);
	const ops: DocumentOp[] = [];

	if (startEditable) {
		if (start.offset < startLength) {
			ops.push(
				spliceDeleteOp(
					start.blockId,
					start.offset,
					startLength - start.offset,
				),
			);
		}
	} else if (coversStructuralBlock(start.offset, 1)) {
		ops.push({ type: "delete-block", blockId: start.blockId });
	}

	for (const blockId of order.slice(startIndex + 1, endIndex)) {
		ops.push({ type: "delete-block", blockId });
	}

	if (endEditable) {
		if (end.offset > 0) {
			ops.push(spliceDeleteOp(end.blockId, 0, end.offset));
		}
	} else if (coversStructuralBlock(0, end.offset)) {
		ops.push({ type: "delete-block", blockId: end.blockId });
	}

	const caret = startEditable
		? { blockId: start.blockId, offset: start.offset }
		: endEditable
			? { blockId: end.blockId, offset: 0 }
			: null;
	if (!caret) {
		return ops.length > 0 ? { ops, caret: start } : null;
	}
	if (text.length > 0) {
		ops.push(spliceInsertOp(caret.blockId, caret.offset, text, marks));
		return {
			ops,
			caret: {
				blockId: caret.blockId,
				offset: caret.offset + text.length,
			},
		};
	}
	return { ops, caret };
}

function coversStructuralBlock(
	startOffset: number,
	endOffset: number,
): boolean {
	return startOffset <= 0 && endOffset >= 1;
}
