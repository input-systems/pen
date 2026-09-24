import {
	getBlockContentRole,
	selectionToRange,
	usesInlineTextSelection,
} from "@input/pen-core";
import {
	type Editor,
	type ModelOperationScopedRangeTarget,
	type TextSelection,
} from "@input/pen-types";
import type { AIContentFormat } from "../runtime/contracts";
import {
	isClearDocumentPrompt,
	isDocumentFollowUpEditPrompt,
	isDocumentResetPrompt,
	isWholeDocumentRewritePrompt,
	parseParagraphReference,
} from "../runtime/promptTargeting";
import type {
	AICommandExecutionOptions,
	AISession,
	ResolvedEditProposal,
	ResolvedEditTarget,
} from "../types";
import { resolveSelectionText } from "./selection";
import { recreateTextSelection } from "./session";

function createResolvedSelectionEditTarget(
	editor: Editor,
	selection: TextSelection,
): ResolvedEditTarget {
	const range = selectionToRange(editor.internals.doc, selection);
	return {
		kind: "selection",
		blockId: range.start.blockId,
		anchor: { ...selection.anchor },
		focus: { ...selection.focus },
		sourceText: resolveSelectionText(editor, selection),
	};
}

function createResolvedScopedEditTarget(
	editor: Editor,
	selection: TextSelection,
	scope: ModelOperationScopedRangeTarget["scope"],
	contentFormat: AIContentFormat,
): ResolvedEditTarget {
	const range = selectionToRange(editor.internals.doc, selection);
	return {
		kind: "scoped-range",
		scope,
		blockId: range.start.blockId,
		anchor: { ...selection.anchor },
		focus: { ...selection.focus },
		blockIds: [...range.blockRange],
		sourceText: resolveSelectionText(editor, selection),
		contentFormat,
	};
}

// This is the AI rewrite policy, not the full Pen Markdown fidelity table.
// Only blocks whose complete structure is safe to replace from model-authored
// Markdown belong here; lossy container formats such as callout and toggle do not.
const AI_MARKDOWN_REWRITE_BLOCK_TYPES = new Set([
	"blockquote",
	"bulletListItem",
	"checkListItem",
	"codeBlock",
	"divider",
	"heading",
	"image",
	"numberedListItem",
	"paragraph",
	"table",
]);

/**
 * The whole-block span a live selection covers, or null when it stops inside a
 * block or reaches a block outside Pen's round-trippable markdown subset. A
 * drag that stops at offset 0 of the next block ended at a block boundary, not
 * inside that block, so it is dropped before the check.
 */
function resolveWholeMarkdownBlockSelection(
	editor: Editor,
	selection: TextSelection,
): TextSelection | null {
	const range = selectionToRange(editor.internals.doc, selection);
	const selectedBlockIds =
		range.end.offset === 0 && range.blockRange.length > 1
			? range.blockRange.slice(0, -1)
			: [...range.blockRange];
	const blockIds = trimChromeBoundaries(editor, selectedBlockIds);
	const firstBlockId = blockIds[0];
	const lastBlockId = blockIds[blockIds.length - 1];
	if (
		!firstBlockId ||
		!lastBlockId ||
		(firstBlockId === range.start.blockId && range.start.offset !== 0)
	) {
		return null;
	}
	const blocks = blockIds.map((blockId) => editor.getBlock(blockId));
	if (
		blocks.some(
			(block) =>
				block == null ||
				!AI_MARKDOWN_REWRITE_BLOCK_TYPES.has(block.type),
		)
	) {
		return null;
	}
	const lastBlock = blocks[blocks.length - 1];
	const lastBlockLength = lastBlock ? selectionLength(editor, lastBlock) : 0;
	if (
		lastBlockId === range.end.blockId &&
		range.end.offset !== lastBlockLength
	) {
		return null;
	}
	return recreateTextSelection(editor, {
		anchor: { blockId: firstBlockId, offset: 0 },
		focus: { blockId: lastBlockId, offset: lastBlockLength },
		blockRange: blockIds,
		isMultiBlock: blockIds.length > 1,
	});
}

function trimChromeBoundaries(
	editor: Editor,
	blockIds: readonly string[],
): string[] {
	let start = 0;
	let end = blockIds.length;
	while (start < end && isChromeBlock(editor, blockIds[start]!)) {
		start += 1;
	}
	while (end > start && isChromeBlock(editor, blockIds[end - 1]!)) {
		end -= 1;
	}
	return blockIds.slice(start, end);
}

function isChromeBlock(editor: Editor, blockId: string): boolean {
	const block = editor.getBlock(blockId);
	return (
		block != null &&
		getBlockContentRole(editor.schema.resolve(block.type)) === "chrome"
	);
}

function selectionLength(
	editor: Editor,
	block: NonNullable<ReturnType<Editor["getBlock"]>>,
): number {
	return usesInlineTextSelection(editor.schema.resolve(block.type))
		? block.length()
		: 1;
}

/**
 * A live selection rewrites as a text splice into its first block — which folds
 * every block the model returns into that one block. A selection covering whole
 * markdown blocks resolves to a block scope instead, so formatting and block
 * structure can round-trip. A partial selection has text around it to keep and
 * stays on the splice path.
 */
function createResolvedLiveSelectionEditTarget(
	editor: Editor,
	selection: TextSelection,
	defaultBlockFormat: AIContentFormat,
): ResolvedEditTarget {
	const wholeBlockSelection = resolveWholeMarkdownBlockSelection(
		editor,
		selection,
	);
	if (wholeBlockSelection) {
		return createResolvedScopedEditTarget(
			editor,
			wholeBlockSelection,
			"block",
			defaultBlockFormat,
		);
	}
	return createResolvedSelectionEditTarget(editor, selection);
}

function createResolvedEditProposal(
	promptIntent: string,
	target: ResolvedEditTarget,
): ResolvedEditProposal {
	return {
		promptIntent,
		target,
	};
}

export function resolveResolvedEditProposal(
	editor: Editor,
	session: AISession,
	prompt: string,
	promptIntent: string,
	explicitTarget: AICommandExecutionOptions["target"] | undefined,
	liveSelection: TextSelection | null,
	defaultBlockFormat: AIContentFormat,
): ResolvedEditProposal | null {
	if (liveSelection && explicitTarget === "selection") {
		return createResolvedEditProposal(
			promptIntent,
			createResolvedLiveSelectionEditTarget(
				editor,
				liveSelection,
				defaultBlockFormat,
			),
		);
	}

	const selectionScopedSession = session.target.kind === "selection";
	if (
		liveSelection &&
		(session.surface === "inline-edit" ||
			(selectionScopedSession &&
				(promptIntent === "rewrite" || promptIntent === "local-edit")))
	) {
		return createResolvedEditProposal(
			promptIntent,
			createResolvedLiveSelectionEditTarget(
				editor,
				liveSelection,
				defaultBlockFormat,
			),
		);
	}

	if (session.target.kind !== "document" && explicitTarget !== "document") {
		return null;
	}
	if (
		promptIntent === "continue" ||
		promptIntent === "review" ||
		promptIntent === "search" ||
		promptIntent === "structural"
	) {
		return null;
	}

	const titleSelection = resolveDocumentTitleSelection(editor, prompt);
	if (titleSelection) {
		return createResolvedEditProposal(
			promptIntent,
			createResolvedScopedEditTarget(
				editor,
				titleSelection,
				"heading",
				defaultBlockFormat,
			),
		);
	}

	const paragraphSelection = resolveDocumentParagraphSelection(
		editor,
		prompt,
	);
	if (paragraphSelection) {
		return createResolvedEditProposal(
			promptIntent,
			createResolvedScopedEditTarget(
				editor,
				paragraphSelection,
				"paragraph",
				defaultBlockFormat,
			),
		);
	}

	const documentBlockIds = editor.documentState.blockOrder.filter(
		(blockId) => editor.getBlock(blockId) != null,
	);
	const documentHasMeaningfulContent = documentBlockIds.some((blockId) => {
		const block = editor.getBlock(blockId);
		return (block?.textContent().trim().length ?? 0) > 0;
	});
	const shouldRewriteDocumentScope =
		!documentHasMeaningfulContent ||
		promptIntent === "rewrite" ||
		isClearDocumentPrompt(prompt) ||
		isWholeDocumentRewritePrompt(prompt) ||
		isDocumentResetPrompt(prompt) ||
		isDocumentFollowUpEditPrompt(prompt);
	if (!shouldRewriteDocumentScope) {
		return null;
	}

	const documentSelection = resolveDocumentBlockRangeSelection(
		editor,
		documentBlockIds,
	);
	if (!documentSelection) {
		return null;
	}
	return createResolvedEditProposal(
		promptIntent,
		createResolvedScopedEditTarget(
			editor,
			documentSelection,
			"document",
			defaultBlockFormat,
		),
	);
}

function resolveDocumentBlockRangeSelection(
	editor: Editor,
	blockIds: readonly string[],
): TextSelection | null {
	const resolvedBlockIds = blockIds.filter(
		(blockId, index, allBlockIds) =>
			allBlockIds.indexOf(blockId) === index &&
			editor.getBlock(blockId) != null,
	);
	const firstBlockId = resolvedBlockIds[0];
	const lastBlockId = resolvedBlockIds[resolvedBlockIds.length - 1];
	if (!firstBlockId || !lastBlockId) {
		return null;
	}
	const lastBlock = editor.getBlock(lastBlockId);
	return recreateTextSelection(editor, {
		anchor: { blockId: firstBlockId, offset: 0 },
		focus: {
			blockId: lastBlockId,
			offset: lastBlock?.textContent().length ?? 0,
		},
		blockRange: resolvedBlockIds,
		isMultiBlock: resolvedBlockIds.length > 1,
	});
}

function resolveDocumentTitleSelection(
	editor: Editor,
	prompt: string,
): TextSelection | null {
	if (!/\b(title|heading)\b/i.test(prompt)) {
		return null;
	}
	const headingBlockId =
		editor.documentState.blockOrder.find((blockId) => {
			const block = editor.getBlock(blockId);
			return (
				block?.type === "heading" || block?.type.startsWith("heading-")
			);
		}) ??
		editor.firstBlock()?.id ??
		null;
	return headingBlockId
		? resolveDocumentBlockRangeSelection(editor, [headingBlockId])
		: null;
}

function resolveDocumentParagraphSelection(
	editor: Editor,
	prompt: string,
): TextSelection | null {
	const paragraphIndex = parseParagraphReference(prompt);
	if (paragraphIndex == null) {
		return null;
	}
	const paragraphBlockIds = editor.documentState.blockOrder.filter(
		(blockId) => {
			const block = editor.getBlock(blockId);
			if (!block) {
				return false;
			}
			return (
				block.type === "paragraph" ||
				(block.textContent().trim().length > 0 &&
					block.type !== "heading" &&
					!block.type.startsWith("heading-"))
			);
		},
	);
	const targetParagraphBlockId =
		paragraphBlockIds[paragraphIndex - 1] ?? null;
	return targetParagraphBlockId
		? resolveDocumentBlockRangeSelection(editor, [targetParagraphBlockId])
		: null;
}
