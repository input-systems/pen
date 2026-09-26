import {
	blocksToOps,
	buildSplitBlockRecipe,
	type PendingBlock,
} from "@input/pen-core";
import type {
	DocumentOp,
	Editor,
	Position,
	StructuralOriginTag,
} from "@input/pen-types";
import { generateId } from "@input/pen-types";
import { getLastDescendantBlockId } from "../utils/parentIdTree";
import type { FieldEditorTransferController } from "./controller";
import type { TransferCursorContext } from "./transferSelection";

interface BlockPlacement {
	/** applied first, on its own, so AN14 anchor repair sees the split */
	split: { ops: DocumentOp[]; structural: StructuralOriginTag } | null;
	ops: DocumentOp[];
	/** offset is absent when the caret lands on a block without inline content */
	caret: { blockId: string; offset?: number } | null;
}

/**
 * Pastes blocks at the caret (IOP9) and places the caret after them.
 */
export function pasteBlocksAtCaret(
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	blocks: PendingBlock[],
	cursor: TransferCursorContext | null,
	options: { undoGroup: boolean },
): void {
	const { split, ops, caret } = buildBlockPlacement(editor, blocks, cursor);
	const undoGroup = options.undoGroup ? { undoGroup: true } : {};
	if (split) {
		editor.apply(split.ops, {
			origin: "user",
			...undoGroup,
			structural: split.structural,
		});
	}
	if (ops.length > 0) {
		// without undoGroup the rest joins the split's undo step
		editor.apply(ops, { origin: "user", ...(split ? {} : undoGroup) });
	}

	if (caret?.offset !== undefined) {
		fieldEditor.activateTextSelection(
			caret.blockId,
			caret.offset,
			caret.offset,
		);
	} else if (caret) {
		editor.selectBlock(caret.blockId);
	}
}

/**
 * The first pasted block joins the text before the caret, the last one joins
 * the text after it, and anything in between splits the caret line. An empty
 * caret line is replaced.
 */
function buildBlockPlacement(
	editor: Editor,
	blocks: PendingBlock[],
	cursor: TransferCursorContext | null,
): BlockPlacement {
	if (!cursor) {
		return insertBlocks(editor, blocks, "last");
	}
	// pasted blocks stay in the caret line's container
	const siblings = withParentId(
		blocks,
		editor.documentState.parentOf(cursor.blockId),
	);
	const afterLine: Position = {
		after:
			getLastDescendantBlockId(editor, cursor.blockId) ?? cursor.blockId,
	};
	if (!cursor.isInline) {
		return insertBlocks(editor, siblings, afterLine);
	}
	if (cursor.isEmpty) {
		const replaced = insertBlocks(editor, siblings, {
			before: cursor.blockId,
		});
		replaced.ops.push({ type: "delete-block", blockId: cursor.blockId });
		return replaced;
	}

	const line = editor.getBlock(cursor.blockId);
	if (!line) {
		return insertBlocks(editor, siblings, afterLine);
	}

	const { offset } = cursor;
	const [first, ...rest] = siblings;
	const mergeFirst = canMergeInline(editor, first);
	const between = mergeFirst ? rest : siblings;

	if (between.length === 0) {
		return {
			split: null,
			ops: inlineContentOps(first, line.id, offset),
			caret: { blockId: line.id, offset: offset + inlineLength(first) },
		};
	}

	let split: BlockPlacement["split"] = null;
	const ops: DocumentOp[] = [];
	let position: Position = afterLine;
	let tailBlockId: string | null = null;
	if (offset < line.length()) {
		if (offset === 0 && !mergeFirst) {
			// nothing stays before the caret, so the whole line is the tail
			position = { before: line.id };
			tailBlockId = line.id;
		} else {
			position = { after: line.id };
			tailBlockId = generateId();
			const recipe = buildSplitBlockRecipe({
				block: line,
				offset,
				newBlockId: tailBlockId,
			});
			split = {
				// the tail is still the caret line, so it keeps its props
				ops: [
					...recipe.ops,
					{
						type: "set-props",
						blockId: tailBlockId,
						props: { ...line.props },
					},
				],
				structural: recipe.structural,
			};
		}
	}
	if (mergeFirst) {
		ops.push(...inlineContentOps(first, line.id, offset));
	}

	const last = between[between.length - 1];
	if (tailBlockId && canMergeInline(editor, last)) {
		const inserted = insertBlocks(editor, between.slice(0, -1), position);
		ops.push(...inserted.ops, ...inlineContentOps(last, tailBlockId, 0));
		return {
			split,
			ops,
			caret: { blockId: tailBlockId, offset: inlineLength(last) },
		};
	}

	const inserted = insertBlocks(editor, between, position);
	ops.push(...inserted.ops);
	return { split, ops, caret: inserted.caret };
}

function insertBlocks(
	editor: Editor,
	blocks: PendingBlock[],
	position: Position,
): BlockPlacement {
	const ops = blocksToOps(blocks, { position });
	const lastBlockId = getLastTopLevelInsertedBlockId(ops);
	const lastBlock = blocks[blocks.length - 1];
	if (!lastBlockId || !lastBlock) {
		return { split: null, ops, caret: null };
	}
	const isInline =
		editor.schema.resolve(lastBlock.type)?.content === "inline";
	return {
		split: null,
		ops,
		caret: isInline
			? { blockId: lastBlockId, offset: inlineLength(lastBlock) }
			: { blockId: lastBlockId },
	};
}

function withParentId(
	blocks: PendingBlock[],
	parentId: string | null,
): PendingBlock[] {
	if (!parentId) {
		return blocks;
	}
	return blocks.map((block) => ({
		...block,
		props: { ...block.props, parentId },
	}));
}

function canMergeInline(editor: Editor, block: PendingBlock): boolean {
	return (
		editor.schema.resolve(block.type)?.content === "inline" &&
		(block.children?.length ?? 0) === 0
	);
}

// materialize the block like an import, then retarget its content into an existing block
function inlineContentOps(
	block: PendingBlock,
	blockId: string,
	offset: number,
): DocumentOp[] {
	return blocksToOps([block]).flatMap((op) =>
		op.type === "splice-text" || op.type === "format-text"
			? [{ ...op, blockId, from: op.from + offset, to: op.to + offset }]
			: [],
	);
}

function inlineLength(block: PendingBlock): number {
	if (block.segments && block.segments.length > 0) {
		return block.segments.reduce(
			(length, segment) =>
				length + (segment.type === "text" ? segment.text.length : 1),
			0,
		);
	}
	return block.content?.length ?? 0;
}

function getLastTopLevelInsertedBlockId(ops: DocumentOp[]): string | null {
	for (let i = ops.length - 1; i >= 0; i--) {
		const op = ops[i];
		if (op.type !== "insert-block") continue;
		if (typeof op.position === "object" && "parent" in op.position)
			continue;
		return op.blockId;
	}
	return null;
}
