import {
	blocksToOps,
	buildSplitBlockRecipe,
	inlineContentToOps,
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
	const placement = buildBlockPlacement(editor, blocks, cursor);
	if (!placement) {
		editor.internals.emit("diagnostic", {
			code: "paste-target-missing",
			level: "warn",
			source: "paste",
			message: "caret block no longer exists; paste dropped",
		});
		return;
	}
	const { split, ops, caret } = placement;
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
 * caret line without children is replaced unless the first pasted block can
 * fill it in place.
 * Returns null when the caret block no longer exists.
 */
function buildBlockPlacement(
	editor: Editor,
	blocks: PendingBlock[],
	cursor: TransferCursorContext | null,
): BlockPlacement | null {
	if (!cursor) {
		return insertBlocks(editor, blocks, "last");
	}
	const line = editor.getBlock(cursor.blockId);
	if (!line) {
		return null;
	}

	// pasted blocks stay in the caret line's container
	const siblings = withParentId(
		blocks,
		editor.documentState.parentOf(line.id),
	);
	const afterLine: Position = {
		after: getLastDescendantBlockId(editor, line.id) ?? line.id,
	};
	if (!cursor.isInline) {
		return insertBlocks(editor, siblings, afterLine);
	}
	// a line with children is never replaced; deleting it would drop them
	if (
		cursor.isEmpty &&
		editor.documentState.childrenOf(line.id).length === 0 &&
		!fillsEmptyLine(editor, blocks[0], line.type)
	) {
		const replaced = insertBlocks(editor, siblings, { before: line.id });
		replaced.ops.push({ type: "delete-block", blockId: line.id });
		return replaced;
	}

	const { offset } = cursor;
	const [first, ...rest] = siblings;
	const mergeFirst = canMergeInline(editor, first);
	const between = mergeFirst ? rest : siblings;

	if (between.length === 0) {
		return {
			split: null,
			ops: inlineContentToOps(first, line.id, offset),
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
		ops.push(...inlineContentToOps(first, line.id, offset));
	}

	const last = between[between.length - 1];
	if (tailBlockId && canMergeInline(editor, last)) {
		const inserted = insertBlocks(editor, between.slice(0, -1), position);
		ops.push(...inserted.ops, ...inlineContentToOps(last, tailBlockId, 0));
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

// an empty line keeps its id and props when the first pasted block brings no
// type or props of its own and its content can be written into the line
function fillsEmptyLine(
	editor: Editor,
	block: PendingBlock,
	lineType: string,
): boolean {
	return (
		block.type === lineType &&
		Object.values(block.props).every((value) => value === undefined) &&
		canMergeInline(editor, block)
	);
}

function canMergeInline(editor: Editor, block: PendingBlock): boolean {
	return (
		editor.schema.resolve(block.type)?.content === "inline" &&
		(block.children?.length ?? 0) === 0
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
