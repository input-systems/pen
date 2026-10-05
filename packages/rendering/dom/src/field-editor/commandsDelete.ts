import { applyMergeBlocks } from "@input/pen-core";
import type { DocumentOp, Editor } from "@input/pen-types";
import { getAdjacentVisibleBlockId } from "../utils/parentIdTree";
import {
	getEditorFlowCapability,
	isContinuousTextFlowCapability,
} from "../utils/flowCapabilities";
import {
	BACKSPACE_EXIT_TYPES,
	getAdjacentEditableBlock,
	getInlineNodeSelectionTarget,
	getLogicalInlineLength,
	isBlockEmpty,
	isCollapsedRange,
	normalizeInlineRange,
	type BackspaceAction,
	type DeleteDirection,
	type InlineTextLike,
	type SelectionRange,
	type SelectionTarget,
} from "./commandsShared";
import { convertBlock } from "./commandsBlock";

export function resolveBackspaceAction(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
	},
): BackspaceAction | null {
	const { blockId, ytext } = options;
	const range = normalizeInlineRange(ytext, options.range);
	if (!isCollapsedRange(range)) return null;
	if ((range?.start ?? 0) !== 0) return null;
	if (
		!isContinuousTextFlowCapability(
			getEditorFlowCapability(editor, blockId),
		)
	) {
		return null;
	}

	const block = editor.getBlock(blockId);
	if (!block) return null;

	if (
		isBlockEmpty(ytext) &&
		block.type === "toggle" &&
		block.children.length === 0
	) {
		const previousBlock = getAdjacentEditableBlock(
			editor,
			blockId,
			"previous",
		);
		if (previousBlock) {
			return {
				action: "delete",
				targetBlockId: previousBlock.id,
			};
		}
		return { action: "convert", newType: "paragraph" };
	}

	if (isBlockEmpty(ytext) && BACKSPACE_EXIT_TYPES.has(block.type)) {
		return { action: "convert", newType: "paragraph" };
	}

	const immediateBlockId = getAdjacentVisibleBlockId(
		editor,
		blockId,
		"previous",
	);
	if (
		immediateBlockId &&
		!isContinuousTextFlowCapability(
			getEditorFlowCapability(editor, immediateBlockId),
		)
	) {
		return {
			action: "select-block",
			targetBlockId: immediateBlockId,
		};
	}

	const previousBlock = getAdjacentEditableBlock(editor, blockId, "previous");
	if (!previousBlock) return null;

	return {
		action: "merge",
		targetBlockId: previousBlock.id,
	};
}

/**
 * Applies the Backspace behaviour for a block: unwrapping a list or quote,
 * merging into the previous block, or deleting an adjacent inline atom.
 *
 * @param editor - The editor whose document receives the resulting ops.
 * @param options - The block being edited, its inline text, and the current range.
 * @returns The selection target to restore after the edit, or `null` when the
 * keystroke has no effect and the caller should fall through.
 */
export function applyBackspaceBehavior(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
	},
): SelectionTarget | null {
	const { blockId, ytext } = options;
	const action = resolveBackspaceAction(editor, options);
	if (!action) return null;

	if (action.action === "convert") {
		return convertBlock(editor, {
			blockId,
			newType: action.newType,
		});
	}

	if (action.action === "select-block") {
		return {
			blockId: action.targetBlockId,
			anchorOffset: 0,
			focusOffset: 0,
			selectBlock: true,
		};
	}

	const previousBlock = editor.getBlock(action.targetBlockId);
	if (!previousBlock) return null;

	const targetOffset = previousBlock.length();
	if (action.action === "delete" || getLogicalInlineLength(ytext) === 0) {
		editor.apply(
			[
				{
					type: "delete-block",
					blockId,
				} as DocumentOp,
			],
			{ origin: "user" },
		);
	} else {
		applyMergeBlocks(editor, {
			targetBlockId: previousBlock.id,
			sourceBlockId: blockId,
		});
	}

	return {
		blockId: previousBlock.id,
		anchorOffset: targetOffset,
		focusOffset: targetOffset,
	};
}

function getCollapsedTextSelectionTarget(
	editor: Editor,
): SelectionTarget | null {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		return null;
	}

	return {
		blockId: selection.focus.blockId,
		anchorOffset: selection.focus.offset,
		focusOffset: selection.focus.offset,
	};
}

/**
 * Applies a directional delete within a block, collapsing a non-empty range or
 * removing the single grapheme next to a collapsed caret.
 *
 * @param editor - The editor whose document receives the resulting ops.
 * @param options - The block, its inline text, the current range, and the delete direction.
 * @returns The selection target to restore after the edit, or `null` when there
 * is nothing to delete.
 */
export function applyDeleteBehavior(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
		direction: DeleteDirection;
	},
): SelectionTarget | null {
	const { blockId, ytext, direction } = options;
	const range = normalizeInlineRange(ytext, options.range);
	if (!range) return null;

	if (!isCollapsedRange(range)) {
		editor.selectText(blockId, range.start, range.end, {
			origin: "keyboard",
		});
		editor.deleteSelection({ origin: "user" });
		return (
			getCollapsedTextSelectionTarget(editor) ?? {
				blockId,
				anchorOffset: range.start,
				focusOffset: range.start,
			}
		);
	}

	const inlineNodeTarget = getInlineNodeSelectionTarget(editor, {
		blockId,
		offset: range.start,
		direction,
	});
	if (inlineNodeTarget) {
		// SELECT the atom. Live registry `handleDelete` does the same.
		return inlineNodeTarget;
	}

	if (direction === "backward") {
		return applyBackspaceBehavior(editor, {
			blockId,
			ytext,
			range,
		});
	}

	return null;
}

export function mergeBackwardAtBlockStart(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
	},
): SelectionTarget | null {
	return applyBackspaceBehavior(editor, options);
}
