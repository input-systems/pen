import type { Editor } from "@input/pen-types";
import { DEFAULT_MAX_SCOPE_CHARS } from "./constants";
import type {
	AISuggestionScope,
	AISuggestionScopeSegment,
	AISuggestionsExtensionConfig,
} from "./types";
import { isEligibleSuggestionBlock, type DirtyBlockState } from "./scheduler";
import { generateId } from "@input/pen-types";

export interface BuiltSuggestionScope {
	scope: AISuggestionScope;
	contextBefore: string;
	contextAfter: string;
}

const SENTENCE_BOUNDARY_REGEX = /(?<=[.!?])\s+/g;
export const DOCUMENT_SCOPE_BLOCK_SEPARATOR = "\n\n";

// every eligible block with text, in document order, joined so one analysis covers the draft.
// blocks past maxScopeChars are left out whole rather than cut mid-sentence.
export function buildDocumentSuggestionScope(
	editor: Editor,
	config: AISuggestionsExtensionConfig = {},
): BuiltSuggestionScope | null {
	const maxScopeChars = config.maxScopeChars ?? DEFAULT_MAX_SCOPE_CHARS;
	const segments: AISuggestionScopeSegment[] = [];
	let text = "";

	for (const block of editor.documentState.blocks) {
		if (!isEligibleSuggestionBlock(block, config)) {
			continue;
		}
		const blockText = block.textContent({ resolved: true });
		if (!blockText.trim()) {
			continue;
		}
		const separator = text.length > 0 ? DOCUMENT_SCOPE_BLOCK_SEPARATOR : "";
		if (
			segments.length > 0 &&
			text.length + separator.length + blockText.length > maxScopeChars
		) {
			break;
		}
		const from = text.length + separator.length;
		text += separator + blockText;
		segments.push({ blockId: block.id, from, to: text.length });
	}

	const firstSegment = segments[0];
	if (!firstSegment) {
		return null;
	}

	return {
		scope: {
			id: generateId(),
			blockId: firstSegment.blockId,
			blockType: editor.getBlock(firstSegment.blockId)?.type ?? null,
			text,
			from: 0,
			to: text.length,
			hash: `document:${normalizeScopeText(text)}`,
			documentGeneration: editor.documentState.generation,
			segments,
		},
		contextBefore: "",
		contextAfter: "",
	};
}

export function buildSuggestionScope(
	editor: Editor,
	dirtyBlock: DirtyBlockState,
	config: AISuggestionsExtensionConfig = {},
): BuiltSuggestionScope | null {
	const block = editor.getBlock(dirtyBlock.blockId);
	if (!block) {
		return null;
	}

	const text = block.textContent({ resolved: true });
	if (!text.trim()) {
		return null;
	}

	const maxScopeChars = config.maxScopeChars ?? DEFAULT_MAX_SCOPE_CHARS;
	const sentenceRange =
		config.scopeUnit === "block"
			? { from: 0, to: text.length }
			: findSentenceRange(
					text,
					clampOffset(
						dirtyBlock.lastChangedOffset ?? text.length,
						text.length,
					),
				);
	const boundedRange = clampRangeToMaxChars(
		text,
		sentenceRange,
		maxScopeChars,
	);
	const targetText = text.slice(boundedRange.from, boundedRange.to);
	if (!targetText.trim()) {
		return null;
	}

	const contextRadius = Math.floor(maxScopeChars / 2);

	return {
		scope: {
			id: generateId(),
			blockId: block.id,
			blockType: block.type ?? null,
			text: targetText,
			from: boundedRange.from,
			to: boundedRange.to,
			hash: `${block.id}:${normalizeScopeText(targetText)}`,
			documentGeneration: editor.documentState.generation,
		},
		contextBefore: text.slice(
			Math.max(0, boundedRange.from - contextRadius),
			boundedRange.from,
		),
		contextAfter: text.slice(
			boundedRange.to,
			Math.min(text.length, boundedRange.to + contextRadius),
		),
	};
}

function findSentenceRange(
	text: string,
	anchorOffset: number,
): { from: number; to: number } {
	const boundaries = [0];
	for (const match of text.matchAll(SENTENCE_BOUNDARY_REGEX)) {
		boundaries.push((match.index ?? 0) + match[0].length);
	}
	boundaries.push(text.length);

	let from = 0;
	let to = text.length;
	for (let index = 0; index < boundaries.length - 1; index += 1) {
		const start = boundaries[index] ?? 0;
		const end = boundaries[index + 1] ?? text.length;
		if (anchorOffset >= start && anchorOffset <= end) {
			from = start;
			to = end;
			break;
		}
	}

	return {
		from: trimLeadingWhitespaceIndex(text, from, to),
		to: trimTrailingWhitespaceIndex(text, from, to),
	};
}

function clampRangeToMaxChars(
	text: string,
	range: { from: number; to: number },
	maxChars: number,
): { from: number; to: number } {
	if (range.to - range.from <= maxChars) {
		return range;
	}

	const midpoint = range.from + Math.floor((range.to - range.from) / 2);
	const from = Math.max(0, midpoint - Math.floor(maxChars / 2));
	const to = Math.min(text.length, from + maxChars);

	return {
		from: trimLeadingWhitespaceIndex(text, from, to),
		to: trimTrailingWhitespaceIndex(text, from, to),
	};
}

function trimLeadingWhitespaceIndex(
	text: string,
	from: number,
	to: number,
): number {
	let nextFrom = from;
	while (nextFrom < to && /\s/.test(text[nextFrom] ?? "")) {
		nextFrom += 1;
	}
	return nextFrom;
}

function trimTrailingWhitespaceIndex(
	text: string,
	from: number,
	to: number,
): number {
	let nextTo = to;
	while (nextTo > from && /\s/.test(text[nextTo - 1] ?? "")) {
		nextTo -= 1;
	}
	return nextTo;
}

function clampOffset(offset: number, length: number): number {
	return Math.max(0, Math.min(offset, length));
}

function normalizeScopeText(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}
