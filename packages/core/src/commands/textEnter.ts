import type { BlockHandle, CommandResult, Editor } from "@input/pen-types";
import { generateId } from "@input/pen-types";

import { buildSplitBlockRecipe, spliceDeleteOp } from "../ops/recipes";
import {
	CONTAINER_EXIT_TYPES,
	collapsedAt,
	getAdjacentVisibleBlockId,
	getBlockInputMode,
	getListIndent,
	HEADING_TYPES,
	isInsideParentIdContainer,
	isListBlock,
	LIST_BLOCK_TYPES,
	readTextFocus,
} from "./helpers";
import { applyConvert } from "./textConvert";
import { handleInsertText } from "./textInsert";

export function handleSplitBlock(editor: Editor): CommandResult | false {
	const focus = readTextFocus(editor);
	if (!focus) {
		return false;
	}

	const inputMode = getBlockInputMode(editor, focus.blockId);
	const action = resolveEnterAction(
		editor,
		focus.blockId,
		focus.offset,
		inputMode,
	);
	if (!action) {
		return false;
	}

	switch (action.action) {
		case "insert-text":
			return handleInsertText(editor, { text: action.text });
		case "convert":
			return applyConvert(editor, {
				blockId: focus.blockId,
				newType: action.newType,
			});
		case "outdent":
			return handleListIndent(editor, true);
		case "exit-code": {
			const block = editor.getBlock(focus.blockId);
			if (!block) {
				return false;
			}
			const newBlockId = generateId();
			const length = block.length();
			const recipe = buildSplitBlockRecipe({
				block,
				offset: length,
				newBlockId,
				newBlockType: "paragraph",
			});
			editor.apply(
				[...recipe.ops, spliceDeleteOp(block.id, length - 1, 1)],
				{ origin: "user", structural: recipe.structural },
			);
			return { selection: collapsedAt(newBlockId, 0) };
		}
		case "lift":
			editor.apply(
				[
					{
						type: "set-props",
						blockId: focus.blockId,
						props: { parentId: null },
					},
				],
				{ origin: "user" },
			);
			return { selection: collapsedAt(focus.blockId, 0) };
		case "split": {
			const block = editor.getBlock(focus.blockId);
			if (!block) {
				return false;
			}
			const newBlockId = generateId();
			const recipe = buildSplitBlockRecipe({
				block,
				offset: focus.offset,
				newBlockId,
				newBlockType: action.newBlockType,
			});
			editor.apply(recipe.ops, {
				origin: "user",
				structural: recipe.structural,
			});
			return { selection: collapsedAt(newBlockId, 0) };
		}
		default: {
			const _exhaustive: never = action;
			return _exhaustive;
		}
	}
}

export function handleListIndent(
	editor: Editor,
	shiftKey: boolean,
): CommandResult | false {
	const focus = readTextFocus(editor);
	if (!focus) {
		return false;
	}
	const block = editor.getBlock(focus.blockId);
	if (!isListBlock(block)) {
		return false;
	}

	const currentIndent = getListIndent(block);
	let nextIndent = currentIndent;
	if (shiftKey) {
		nextIndent = Math.max(0, currentIndent - 1);
	} else {
		const previousBlockId = getAdjacentVisibleBlockId(
			editor,
			focus.blockId,
			"previous",
		);
		const previousBlock = previousBlockId
			? editor.getBlock(previousBlockId)
			: null;
		const sharesParent =
			previousBlockId !== null &&
			editor.documentState.parentOf(previousBlockId) ===
				editor.documentState.parentOf(focus.blockId);
		if (
			isListBlock(previousBlock) &&
			sharesParent &&
			getListIndent(previousBlock) >= currentIndent
		) {
			nextIndent = currentIndent + 1;
		}
	}

	if (nextIndent === currentIndent) {
		return false;
	}

	editor.apply(
		[
			{
				type: "set-props",
				blockId: focus.blockId,
				props: { indent: nextIndent },
			},
		],
		{ origin: "user" },
	);
	return {
		selection: collapsedAt(focus.blockId, focus.offset),
	};
}

type EnterAction =
	| { action: "split"; newBlockType: string | undefined }
	| { action: "convert"; newType: string }
	| { action: "outdent" }
	| { action: "exit-code" }
	| { action: "lift" }
	| { action: "insert-text"; text: string };

function resolveEnterAction(
	editor: Editor,
	blockId: string,
	offset: number,
	inputMode: "richtext" | "code" | "table" | "none",
): EnterAction | null {
	if (inputMode === "code") {
		return resolveCodeEnterAction(editor, blockId, offset);
	}
	if (inputMode !== "richtext") {
		return null;
	}

	const block = editor.getBlock(blockId);
	if (!block) {
		return null;
	}
	const emptyBlockAction =
		block.length() === 0
			? resolveEmptyBlockEnterAction(editor, block)
			: null;
	if (emptyBlockAction) {
		return emptyBlockAction;
	}
	if (HEADING_TYPES.has(block.type)) {
		return { action: "split", newBlockType: "paragraph" };
	}
	return { action: "split", newBlockType: undefined };
}

// Enter on an empty last line leaves the code block: the line goes and a
// paragraph opens below
function resolveCodeEnterAction(
	editor: Editor,
	blockId: string,
	offset: number,
): EnterAction {
	const text = editor.getBlock(blockId)?.textContent() ?? "";
	if (offset === text.length && text.endsWith("\n")) {
		return { action: "exit-code" };
	}
	return { action: "insert-text", text: "\n" };
}

function resolveEmptyBlockEnterAction(
	editor: Editor,
	block: BlockHandle,
): EnterAction | null {
	// an empty nested item steps out one level at a time before it leaves the list
	if (isListBlock(block) && getListIndent(block) > 0) {
		return { action: "outdent" };
	}
	if (
		LIST_BLOCK_TYPES.has(block.type) ||
		CONTAINER_EXIT_TYPES.has(block.type)
	) {
		return { action: "convert", newType: "paragraph" };
	}
	if (isInsideParentIdContainer(editor, block.id)) {
		return { action: "lift" };
	}
	return null;
}
