import type {
	DocumentOp,
	Editor,
	InlineCompletionPreviewBlock,
} from "@input/pen-types";
import {
	blocksToOps,
	normalizePendingBlocksForImport,
	type PendingBlock,
} from "@input/pen-core";
import {
	parseMarkdownToBlocks,
	splitPlainTextLineBlocks,
} from "@input/pen-ingest";
import { DEFAULT_PARAGRAPH_GAP } from "./constants";
import type { AutocompleteParagraphGap } from "./types";

export interface AutocompleteStructuredCandidate {
	rawText: string;
	inlineText: string;
	appendedBlocks: readonly PendingBlock[];
	previewBlocks: readonly InlineCompletionPreviewBlock[];
}

export interface AutocompleteStructuredCandidateOptions {
	activeBlockType?: string | null;
	continuationDepth?: number;
	paragraphGap?: AutocompleteParagraphGap;
}

export function createAutocompleteStructuredCandidate(
	editor: Editor,
	text: string,
	options?: AutocompleteStructuredCandidateOptions,
): AutocompleteStructuredCandidate {
	const structuredSuggestion = parseStructuredSuggestion(
		editor,
		text,
		options,
	);
	if (!structuredSuggestion) {
		return {
			rawText: text,
			inlineText: text,
			appendedBlocks: [],
			previewBlocks: [],
		};
	}
	return {
		rawText: text,
		inlineText: structuredSuggestion.inlineText,
		appendedBlocks: structuredSuggestion.blocks,
		previewBlocks: structuredSuggestion.blocks.map((block, index) => ({
			id: `preview-${index}`,
			text: getPendingBlockPreviewText(block),
			blockType: block.type,
			props: block.props,
		})),
	};
}

export function materializeStructuredCandidateAcceptance(options: {
	blockId: string;
	offset: number;
	candidate: AutocompleteStructuredCandidate;
}): {
	ops: DocumentOp[];
	selection: { blockId: string; offset: number };
} {
	const { blockId, candidate, offset } = options;
	if (candidate.appendedBlocks.length === 0) {
		return {
			ops: [
				{
					type: "splice-text",
					blockId,
					from: offset,
					to: offset,
					insert: candidate.inlineText,
				},
			],
			selection: {
				blockId,
				offset: offset + candidate.inlineText.length,
			},
		};
	}

	const ops: DocumentOp[] = [];
	if (candidate.inlineText.length > 0) {
		ops.push({
			type: "splice-text",
			blockId,
			from: offset,
			to: offset,
			insert: candidate.inlineText,
		});
	}
	const blockOps = blocksToOps([...candidate.appendedBlocks], {
		position: { after: blockId },
	});
	ops.push(...blockOps);
	return {
		ops,
		selection: resolveSuggestionSelection(blockOps, {
			blockId,
			offset: offset + candidate.inlineText.length,
		}),
	};
}

function parseStructuredSuggestion(
	editor: Editor,
	text: string,
	options?: AutocompleteStructuredCandidateOptions,
): {
	inlineText: string;
	blocks: PendingBlock[];
} | null {
	const normalizedText = text.replace(/\r/g, "");
	const paragraphGap = options?.paragraphGap ?? DEFAULT_PARAGRAPH_GAP;
	if (
		isProseBlockType(options?.activeBlockType) &&
		normalizedText.includes("\n") &&
		!containsStructuredBlockContinuation(normalizedText)
	) {
		const proseStructuredSuggestion = parseProseLineStructuredSuggestion(
			normalizedText,
			paragraphGap,
		);
		if (proseStructuredSuggestion) {
			return proseStructuredSuggestion;
		}
	}

	const splitIndex = findStructuredSuggestionBoundary(normalizedText);
	if (splitIndex >= 0) {
		const inlineText = normalizedText.slice(0, splitIndex);
		const tail = normalizedText.slice(splitIndex);
		const markdownTail = tail.replace(/^\n+/, "");
		if (markdownTail.trim().length > 0) {
			const parsedBlocks = parseMarkdownToBlocks(markdownTail, editor);
			const normalizedBlocks = normalizePendingBlocksForImport(
				parsedBlocks,
				editor.documentProfile,
				editor.schema,
			).blocks;
			if (normalizedBlocks.length > 0) {
				return {
					inlineText,
					blocks: normalizedBlocks,
				};
			}
		} else if (/^\n{2,}/.test(tail)) {
			return {
				inlineText,
				blocks: [
					{
						type: "paragraph",
						props: {},
						content: "",
					},
				],
			};
		}
	}

	if (
		isProseBlockType(options?.activeBlockType) &&
		normalizedText.includes("\n")
	) {
		const proseStructuredSuggestion = parseProseLineStructuredSuggestion(
			normalizedText,
			paragraphGap,
		);
		if (proseStructuredSuggestion) {
			return proseStructuredSuggestion;
		}
	}

	if (isProseBlockType(options?.activeBlockType)) {
		const implicitMultiParagraphSuggestion =
			parseImplicitMultiParagraphSuggestion(
				normalizedText,
				options?.continuationDepth ?? 0,
				paragraphGap,
			);
		if (implicitMultiParagraphSuggestion) {
			return implicitMultiParagraphSuggestion;
		}
	}
	return null;
}

function containsStructuredBlockContinuation(text: string): boolean {
	if (/\n(?=(?:#{1,6}\s|>\s|[+*]\s|\d+[.)]\s|\[[ xX]\]\s|```))/.test(text)) {
		return true;
	}

	const dashLineMatches = text.match(/\n-\s+\S/g) ?? [];
	if (dashLineMatches.length > 1) {
		return true;
	}

	return /^\n-\s+\S/.test(text);
}

function findStructuredSuggestionBoundary(text: string): number {
	const blankLineMatch = /\n{2,}/.exec(text);
	const markdownLineMatch =
		/\n(?=(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|\[[ xX]\]\s|```))/.exec(text);
	const blankLineIndex = blankLineMatch?.index ?? -1;
	const markdownLineIndex = markdownLineMatch?.index ?? -1;
	if (blankLineIndex === -1) {
		return markdownLineIndex;
	}
	if (markdownLineIndex === -1) {
		return blankLineIndex;
	}
	return Math.min(blankLineIndex, markdownLineIndex);
}

function resolveSuggestionSelection(
	ops: readonly DocumentOp[],
	fallback: { blockId: string; offset: number },
): { blockId: string; offset: number } {
	let selection = fallback;
	for (const op of ops) {
		if (op.type === "insert-block") {
			selection = {
				blockId: op.blockId,
				offset: 0,
			};
			continue;
		}
		if (op.type === "splice-text") {
			selection = {
				blockId: op.blockId,
				offset: op.from + spliceInsertLength(op.insert),
			};
		}
	}
	return selection;
}

function spliceInsertLength(
	insert: Extract<DocumentOp, { type: "splice-text" }>["insert"],
): number {
	const items = Array.isArray(insert) ? insert : [insert];
	let length = 0;
	for (const item of items) {
		length += typeof item === "string" ? item.length : 1;
	}
	return length;
}

function getPendingBlockPreviewText(block: PendingBlock): string {
	const ownContent = block.content?.trim() ?? "";
	if (ownContent.length > 0) {
		return ownContent;
	}
	return (block.children ?? [])
		.map((child) => getPendingBlockPreviewText(child))
		.filter((textPart) => textPart.length > 0)
		.join(" ");
}

function parseProseLineStructuredSuggestion(
	text: string,
	paragraphGap: AutocompleteParagraphGap,
): {
	inlineText: string;
	blocks: PendingBlock[];
} | null {
	const suggestion = splitAutocompleteProseBlocks(text, paragraphGap);
	if (!suggestion) {
		return null;
	}

	return {
		inlineText: suggestion.inlineText,
		blocks: suggestion.blocks.map((content) => ({
			type: "paragraph",
			props: {},
			content,
		})),
	};
}

// With the "separator" gap a blank line between paragraphs separates them and is not a paragraph
// of its own; with "empty-block" it lands as the empty block a margin-less document needs to show
// the gap. Leading and trailing newline runs are handled separately, where an empty block is
// deliberate — that is the block the caret lands in after acceptance.
function splitProseParagraphs(
	text: string,
	paragraphGap: AutocompleteParagraphGap,
): string[] {
	const paragraphs = splitPlainTextLineBlocks(text);
	if (paragraphGap === "empty-block") {
		return paragraphs;
	}
	return paragraphs.filter((paragraph) => paragraph.length > 0);
}

function splitAutocompleteProseBlocks(
	text: string,
	paragraphGap: AutocompleteParagraphGap,
): {
	inlineText: string;
	blocks: string[];
} | null {
	const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const leadingNewlineMatch = /^\n+/.exec(normalizedText);
	if (leadingNewlineMatch) {
		const tailBlocks = splitProseParagraphs(
			normalizedText.slice(leadingNewlineMatch[0].length),
			paragraphGap,
		);
		const leadingEmptyBlocks = createEmptyBlocks(
			tailBlocks.length > 0
				? leadingNewlineMatch[0].length - 1
				: leadingNewlineMatch[0].length,
		);
		const blocks = [...leadingEmptyBlocks, ...tailBlocks];
		return blocks.length > 0 ? { inlineText: "", blocks } : null;
	}

	const paragraphs = splitProseParagraphs(normalizedText, paragraphGap);
	const trailingEmptyBlocks = createTrailingEmptyBlocks(normalizedText);
	if (paragraphs.length <= 1 && trailingEmptyBlocks.length === 0) {
		return null;
	}

	const [inlineParagraph, ...tailParagraphs] = paragraphs;
	return {
		inlineText: resolveAutocompleteInlineParagraphText(
			normalizedText,
			inlineParagraph ?? "",
		),
		blocks: [...tailParagraphs, ...trailingEmptyBlocks],
	};
}

function createTrailingEmptyBlocks(text: string): string[] {
	const trailingNewlineMatch = /\n+$/.exec(text);
	return createEmptyBlocks(trailingNewlineMatch?.[0].length ?? 0);
}

function createEmptyBlocks(count: number): string[] {
	return Array.from({ length: Math.max(0, count) }, () => "");
}

function resolveAutocompleteInlineParagraphText(
	text: string,
	fallback: string,
): string {
	const firstNonEmptyLine = text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.split("\n")
		.find((line) => line.trim().length > 0);

	return firstNonEmptyLine?.trim() === fallback
		? firstNonEmptyLine.replace(/[ \t]+$/u, "")
		: fallback;
}

function isProseBlockType(blockType: string | null | undefined): boolean {
	return (
		blockType === "paragraph" ||
		blockType === "heading" ||
		blockType === "blockquote" ||
		blockType === "callout"
	);
}

function parseImplicitMultiParagraphSuggestion(
	text: string,
	continuationDepth: number,
	paragraphGap: AutocompleteParagraphGap,
): {
	inlineText: string;
	blocks: PendingBlock[];
} | null {
	if (continuationDepth < 1 || text.includes("\n")) {
		return null;
	}
	const thresholds = resolveImplicitParagraphThresholds(continuationDepth);
	if (text.trim().length < thresholds.minChars) {
		return null;
	}
	const sentenceRanges = splitIntoSentenceRanges(text);
	if (sentenceRanges.length < 2) {
		return null;
	}
	const splitIndex = findImplicitParagraphSplitIndex(
		text,
		sentenceRanges,
		thresholds,
	);
	if (splitIndex < 0) {
		return null;
	}
	const inlineText = text.slice(0, splitIndex).replace(/\s+$/, "");
	const remainingText = text.slice(splitIndex).trim();
	if (
		inlineText.length === 0 ||
		remainingText.length < thresholds.minRemainderChars
	) {
		return null;
	}
	const paragraphContents = buildImplicitParagraphContents(
		remainingText,
		thresholds,
	);
	if (paragraphContents.length === 0) {
		return null;
	}
	// an implicit split is a paragraph boundary like any other, so it takes the same gap
	const blockContents =
		paragraphGap === "empty-block"
			? paragraphContents.flatMap((content) => ["", content])
			: paragraphContents;
	return {
		inlineText,
		blocks: blockContents.map((content) => ({
			type: "paragraph",
			props: {},
			content,
		})),
	};
}

function splitIntoSentenceRanges(
	text: string,
): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	const boundaryPattern = /[.!?]["')\]]*\s+(?=(?:["'([{]*[A-Z]))/g;
	let start = 0;
	let match: RegExpExecArray | null;
	while ((match = boundaryPattern.exec(text)) != null) {
		const end = match.index + match[0].length;
		ranges.push({ start, end });
		start = end;
	}
	if (start < text.length) {
		ranges.push({ start, end: text.length });
	}
	return ranges.filter(
		(range) => text.slice(range.start, range.end).trim().length > 0,
	);
}

function findImplicitParagraphSplitIndex(
	text: string,
	sentenceRanges: ReadonlyArray<{ start: number; end: number }>,
	thresholds: {
		inlineTargetChars: number;
		minRemainderChars: number;
	},
): number {
	for (const range of sentenceRanges) {
		const candidateIndex = range.end;
		const inlineLength = text.slice(0, candidateIndex).trimEnd().length;
		const remainderLength = text.slice(candidateIndex).trim().length;
		if (
			inlineLength >= thresholds.inlineTargetChars &&
			remainderLength >= thresholds.minRemainderChars
		) {
			return candidateIndex;
		}
	}
	for (const range of sentenceRanges) {
		const candidateIndex = range.end;
		if (
			text.slice(candidateIndex).trim().length >=
			thresholds.minRemainderChars
		) {
			return candidateIndex;
		}
	}
	return -1;
}

function buildImplicitParagraphContents(
	text: string,
	thresholds: {
		paragraphTargetChars: number;
	},
): string[] {
	const sentenceRanges = splitIntoSentenceRanges(text);
	if (sentenceRanges.length === 0) {
		return [];
	}
	const paragraphs: string[] = [];
	let currentStart = sentenceRanges[0]!.start;
	for (let index = 0; index < sentenceRanges.length; index += 1) {
		const range = sentenceRanges[index]!;
		const currentText = text.slice(currentStart, range.end).trim();
		const remainingSentenceCount = sentenceRanges.length - index - 1;
		if (
			currentText.length >= thresholds.paragraphTargetChars &&
			remainingSentenceCount > 0
		) {
			paragraphs.push(currentText);
			currentStart = range.end;
		}
	}
	const trailingText = text.slice(currentStart).trim();
	if (trailingText.length > 0) {
		paragraphs.push(trailingText);
	}
	return paragraphs.filter((paragraph) => paragraph.length > 0);
}

function resolveImplicitParagraphThresholds(continuationDepth: number): {
	minChars: number;
	inlineTargetChars: number;
	paragraphTargetChars: number;
	minRemainderChars: number;
} {
	if (continuationDepth <= 2) {
		return {
			minChars: 96,
			inlineTargetChars: 64,
			paragraphTargetChars: 96,
			minRemainderChars: 28,
		};
	}
	return {
		minChars: 140,
		inlineTargetChars: 96,
		paragraphTargetChars: 140,
		minRemainderChars: 40,
	};
}
