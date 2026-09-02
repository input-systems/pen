import { isCollapsed } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { readAllSuggestions } from "../suggestions/persistent";
import type {
	AIRequestedOperation,
	AISessionTarget,
	PersistentBlockSuggestion,
	PersistentTextSuggestion,
} from "../types";
import { recreateTextSelection, resolveSessionTarget } from "./session";

export function resolveLiveInlineSelectionTarget(
	editor: Editor,
): Extract<AISessionTarget, { kind: "selection" }> | null {
	const selection = editor.selection;
	if (selection?.type !== "text" || isCollapsed(selection)) {
		return null;
	}
	const target = resolveSessionTarget(editor, "selection");
	return target.kind === "selection" ? target : null;
}

/**
 * A block-scoped rewrite replaces the blocks it was given instead of splicing
 * text inside one of them, so the span to re-anchor on is the blocks it staged,
 * not the blocks the operation names — those are the ones on their way out.
 */
function resolveStagedBlockRewriteTarget(
	editor: Editor,
	operation: AIRequestedOperation | undefined,
	suggestionIds: readonly string[],
): Extract<AISessionTarget, { kind: "selection" }> | null {
	if (
		operation?.kind !== "rewrite-selection" ||
		operation.target.kind !== "scoped-range"
	) {
		return null;
	}
	const insertedBlockIds = readAllSuggestions(editor)
		.filter(
			(suggestion): suggestion is PersistentBlockSuggestion =>
				suggestion.kind === "block" &&
				suggestion.action === "insert-block" &&
				suggestionIds.includes(suggestion.id),
		)
		.map((suggestion) => suggestion.blockId);
	const firstBlockId = insertedBlockIds[0];
	const lastBlockId = insertedBlockIds[insertedBlockIds.length - 1];
	if (!firstBlockId || !lastBlockId) {
		return null;
	}
	const lastBlock = editor.getBlock(lastBlockId);
	if (!lastBlock) {
		return null;
	}
	return {
		kind: "selection",
		blockId: firstBlockId,
		selection: recreateTextSelection(editor, {
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: {
				blockId: lastBlockId,
				offset: lastBlock.textContent().length,
			},
			blockRange: insertedBlockIds,
			isMultiBlock: insertedBlockIds.length > 1,
		}),
	};
}

export function resolvePendingInlineSelectionTarget(
	editor: Editor,
	operation: AIRequestedOperation | undefined,
	suggestionIds: readonly string[],
): Extract<AISessionTarget, { kind: "selection" }> | null {
	const stagedBlockRewrite = resolveStagedBlockRewriteTarget(
		editor,
		operation,
		suggestionIds,
	);
	if (stagedBlockRewrite) {
		return stagedBlockRewrite;
	}
	if (
		operation?.kind !== "rewrite-selection" ||
		operation.target.kind !== "selection" ||
		operation.target.anchor.blockId !== operation.target.focus.blockId
	) {
		return null;
	}
	const textSuggestions = readAllSuggestions(editor).filter(
		(suggestion): suggestion is PersistentTextSuggestion =>
			suggestion.kind === "text" &&
			(suggestion.action === "insert" ||
				suggestion.action === "delete") &&
			suggestionIds.includes(suggestion.id),
	);
	if (textSuggestions.length === 0) {
		return null;
	}
	const blockId = operation.target.anchor.blockId;
	const startOffset = Math.min(
		operation.target.anchor.offset,
		operation.target.focus.offset,
	);
	const previewSpanLength = textSuggestions.reduce(
		(totalLength, suggestion) => totalLength + suggestion.length,
		0,
	);
	const endOffset = startOffset + previewSpanLength;
	if (endOffset <= startOffset) {
		return null;
	}
	return {
		kind: "selection",
		blockId,
		selection: recreateTextSelection(editor, {
			anchor: { blockId, offset: startOffset },
			focus: { blockId, offset: endOffset },
			blockRange: [blockId],
			isMultiBlock: false,
		}),
	};
}

export function resolveAcceptedInlineSelectionTarget(
	editor: Editor,
	operation: AIRequestedOperation | undefined,
	suggestionIds: readonly string[],
): Extract<AISessionTarget, { kind: "selection" }> | null {
	const stagedBlockRewrite = resolveStagedBlockRewriteTarget(
		editor,
		operation,
		suggestionIds,
	);
	if (stagedBlockRewrite) {
		return stagedBlockRewrite;
	}
	if (
		operation?.kind !== "rewrite-selection" ||
		operation.target.kind !== "selection" ||
		operation.target.anchor.blockId !== operation.target.focus.blockId
	) {
		return null;
	}
	const insertSuggestions = readAllSuggestions(editor).filter(
		(suggestion): suggestion is PersistentTextSuggestion =>
			suggestion.kind === "text" &&
			suggestion.action === "insert" &&
			suggestionIds.includes(suggestion.id),
	);
	if (insertSuggestions.length === 0) {
		return null;
	}
	const blockId = operation.target.anchor.blockId;
	const startOffset = Math.min(
		operation.target.anchor.offset,
		operation.target.focus.offset,
	);
	const insertedLength = insertSuggestions.reduce(
		(totalLength, suggestion) => totalLength + suggestion.length,
		0,
	);
	const endOffset = startOffset + insertedLength;
	if (endOffset <= startOffset) {
		return null;
	}
	return {
		kind: "selection",
		blockId,
		selection: recreateTextSelection(editor, {
			anchor: { blockId, offset: startOffset },
			focus: { blockId, offset: endOffset },
			blockRange: [blockId],
			isMultiBlock: false,
		}),
	};
}
