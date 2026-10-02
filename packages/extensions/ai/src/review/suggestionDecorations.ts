import type {
	BlockDecoration,
	Decoration,
	Editor,
	InlineDecoration,
} from "@input/pen-types";
import {
	REVIEW_SURFACE_BLOCK_SUGGESTION_CLASSES,
	REVIEW_SURFACE_CLASSES,
} from "@input/pen-types";
import { readBlockSuggestionMeta } from "../suggestions/persistent";
import type { AIExtensionConfig } from "../types";
import {
	AI_REVIEW_ROLE_ATTRIBUTE,
	FINAL_TEXT_REVIEW_HIDDEN_ATTRIBUTE,
	type AIReviewPresentationRole,
} from "./reviewPresentationState";

interface InlineRange {
	from: number;
	to: number;
}

export interface SuggestionInlineRange extends InlineRange {
	action: "insert" | "delete";
	attributes: DecorationAttributes;
}

interface YTextLike {
	toDelta(): Array<{
		insert: string | object;
		attributes?: Record<string, unknown>;
	}>;
}

type SuggestionPresentation = NonNullable<
	AIExtensionConfig["suggestionPresentation"]
>;
type DecorationAttributes = Record<string, string | number | boolean>;

/** One block's suggestion decorations and the inline ranges they came from. */
export interface BlockSuggestionDecorations {
	readonly decorations: Decoration[];
	readonly ranges: SuggestionInlineRange[];
}

/** Suggestion decorations for one block: its block-level meta and inline marks. */
export function suggestionDecorationsForBlock(
	editor: Editor,
	blockId: string,
	suggestionPresentation: SuggestionPresentation,
): BlockSuggestionDecorations | null {
	const block = editor.getBlock(blockId);
	if (!block) return null;
	const decorations: Decoration[] = [];
	const blockSuggestion = readBlockSuggestionMeta(block);
	if (blockSuggestion) {
		decorations.push(createBlockSuggestionDecoration(blockId, blockSuggestion));
	}
	const ranges = readSuggestionInlineRanges(editor, blockId, suggestionPresentation);
	decorations.push(...ranges.map((range) => createSuggestionInlineDecoration(blockId, range)));
	return decorations.length > 0 ? { decorations, ranges } : null;
}

/** Every block's suggestion decorations: the full walk the scoped index must equal. */
export function collectSuggestionDecorations(
	editor: Editor,
	suggestionPresentation: SuggestionPresentation,
): {
	decorations: Decoration[];
	suggestionRangesByBlock: Map<string, SuggestionInlineRange[]>;
	hasSuggestions: boolean;
} {
	const decorations: Decoration[] = [];
	const suggestionRangesByBlock = new Map<string, SuggestionInlineRange[]>();
	for (const block of editor.documentState.allBlocks()) {
		const entry = suggestionDecorationsForBlock(editor, block.id, suggestionPresentation);
		if (!entry) continue;
		decorations.push(...entry.decorations);
		if (entry.ranges.length > 0) suggestionRangesByBlock.set(block.id, entry.ranges);
	}
	return {
		decorations,
		suggestionRangesByBlock,
		hasSuggestions: decorations.length > 0,
	};
}

function createBlockSuggestionDecoration(
	blockId: string,
	blockSuggestion: NonNullable<ReturnType<typeof readBlockSuggestionMeta>>,
): BlockDecoration {
	return {
		type: "block",
		blockId,
		attributes: {
			class: [
				REVIEW_SURFACE_CLASSES.blockSuggestion,
				REVIEW_SURFACE_BLOCK_SUGGESTION_CLASSES[blockSuggestion.action],
			].join(" "),
			"data-suggestion-id": blockSuggestion.id,
			"data-suggestion-action": blockSuggestion.action,
			"data-suggestion-author-type": blockSuggestion.authorType,
			[AI_REVIEW_ROLE_ATTRIBUTE]: resolveBlockSuggestionRole(blockSuggestion.action),
		},
	};
}

function readSuggestionInlineRanges(
	editor: Editor,
	blockId: string,
	suggestionPresentation: SuggestionPresentation,
): SuggestionInlineRange[] {
	const ytext = editor.internals.getBlockText(blockId) as YTextLike | null;
	if (!ytext || typeof ytext.toDelta !== "function") {
		return [];
	}

	const ranges: SuggestionInlineRange[] = [];
	let offset = 0;
	for (const delta of ytext.toDelta()) {
		const length =
			typeof delta.insert === "string" ? delta.insert.length : 1;
		const suggestion = delta.attributes?.suggestion as
			| Record<string, unknown>
			| undefined;
		if (suggestion && typeof suggestion.id === "string") {
			const action = suggestion.action === "delete" ? "delete" : "insert";
			ranges.push({
				action,
				from: offset,
				to: offset + length,
				attributes: buildSuggestionAttributes(
					action,
					suggestion,
					suggestionPresentation,
				),
			});
		}
		offset += length;
	}

	return ranges;
}

function buildSuggestionAttributes(
	action: "insert" | "delete",
	suggestion: Record<string, unknown>,
	suggestionPresentation: SuggestionPresentation,
): DecorationAttributes {
	const isFinalText = suggestionPresentation === "final-text";
	const isDelete = action === "delete";
	const role: AIReviewPresentationRole =
		isFinalText && isDelete
			? "delete-hidden"
			: isDelete
				? "delete"
				: "insert";
	return {
		class: isDelete
			? REVIEW_SURFACE_CLASSES.suggestionDelete
			: REVIEW_SURFACE_CLASSES.suggestionInsert,
		"data-suggestion-id": String(suggestion.id),
		"data-suggestion-action": action,
		"data-suggestion-author": String(suggestion.author ?? ""),
		"data-suggestion-author-type": String(suggestion.authorType ?? "user"),
		[AI_REVIEW_ROLE_ATTRIBUTE]: role,
		...(isFinalText && isDelete
			? { [FINAL_TEXT_REVIEW_HIDDEN_ATTRIBUTE]: true }
			: isFinalText
				? { "data-pen-final-text-review-change": true }
				: {}),
	};
}

function createSuggestionInlineDecoration(
	blockId: string,
	range: SuggestionInlineRange,
): InlineDecoration {
	return {
		type: "inline",
		blockId,
		from: range.from,
		to: range.to,
		attributes: range.attributes,
		omitFromRender:
			range.action === "delete" &&
			range.attributes[FINAL_TEXT_REVIEW_HIDDEN_ATTRIBUTE] === true,
	};
}

function resolveBlockSuggestionRole(action: string): AIReviewPresentationRole {
	switch (action) {
		case "insert-block":
			return "block-insert";
		case "delete-block":
			return "block-delete";
		default:
			return "block-change";
	}
}
