import type { ModelStreamEvent } from "@input/pen-types";
import type { AutocompleteRequestContext } from "./types";
import { previewAutocompleteTextForLog } from "./autocompleteDebug";

const PROSE_BLOCK_TYPES = new Set([
	"paragraph",
	"heading",
	"blockquote",
	"callout",
]);
const MIN_PROSE_SINGLE_WORD_COMPLETION_CHARS = 3;

export function handleModelEvent(
	event: ModelStreamEvent,
	onTextDelta: (delta: string) => void,
): boolean {
	if (event.type === "text-delta") {
		onTextDelta(event.delta);
		return true;
	}
	if (event.type === "done" || event.type === "error") {
		return false;
	}
	return true;
}

export function normalizeCompletionText(
	context: AutocompleteRequestContext,
	text: string,
): string {
	const normalized = text.replace(/\r/g, "");
	const withoutFence = normalized
		.replace(/^```[a-zA-Z0-9_-]*\n?/, "")
		.replace(/```$/, "");
	const withoutWrappedQuotes = stripWrappedCompletionQuotes(
		context,
		withoutFence,
	);
	const trimmedLeading = normalizeLeadingNewline(
		context,
		withoutWrappedQuotes,
	);
	if (!trimmedLeading) {
		return "";
	}
	let candidate = trimmedLeading;
	const suffixEcho = longestCommonPrefix(context.suffixText, trimmedLeading);
	if (suffixEcho.length > 0) {
		candidate = trimmedLeading.slice(suffixEcho.length);
	} else if (context.suffixText.length === 0) {
		const prefixEcho = longestSuffixPrefixOverlap(
			context.prefixText,
			trimmedLeading,
		);
		if (prefixEcho.length > 0) {
			candidate = trimmedLeading.slice(prefixEcho.length);
		}
	}
	candidate = maybeInsertMissingBoundarySpace(context, candidate);
	candidate = stripLeadingBoundaryPunctuationArtifacts(context, candidate);
	candidate = collapseDuplicateBoundaryWhitespace(context, candidate);
	candidate = maybeCapitalizeSentenceStart(context, candidate);
	if (shouldRejectLowQualityCompletion(context, candidate)) {
		return "";
	}
	return candidate;
}

// A leading blank line or block opener is structure and stays. A single leading newline is
// usually a model artifact and goes — except in prose right after a closed line ("Best,",
// "Thanks for your time."), where it is the one signal that the continuation is a new block;
// stripping it there splices the text onto the closing punctuation ("Best,Krijn").
function normalizeLeadingNewline(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (
		completion.startsWith("\n\n") ||
		startsWithStructuredBlockContinuation(completion)
	) {
		return completion;
	}
	if (startsNewProseBlock(context, completion)) {
		return completion.replace(/^[ \t]*\n/, "\n");
	}
	return completion.replace(/^\s*\n/, "");
}

function startsNewProseBlock(
	context: AutocompleteRequestContext,
	completion: string,
): boolean {
	return (
		PROSE_BLOCK_TYPES.has(context.blockType ?? "") &&
		context.suffixText.length === 0 &&
		/^[ \t]*\n[^\n]*\S/.test(completion) &&
		/[.!?,:;]["')\]]*[ \t]*$/.test(context.prefixText)
	);
}

function startsWithStructuredBlockContinuation(text: string): boolean {
	return /^\s*\n(?=(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|\[[ xX]\]\s|```))/.test(
		text,
	);
}

function longestCommonPrefix(left: string, right: string): string {
	const maxLength = Math.min(left.length, right.length);
	let index = 0;
	while (index < maxLength && left[index] === right[index]) {
		index += 1;
	}
	return left.slice(0, index);
}

function longestSuffixPrefixOverlap(left: string, right: string): string {
	const maxLength = Math.min(left.length, right.length);
	for (let length = maxLength; length > 0; length -= 1) {
		const overlap = right.slice(0, length);
		if (left.endsWith(overlap)) {
			return overlap;
		}
	}
	return "";
}

function maybeInsertMissingBoundarySpace(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (
		!completion ||
		context.suffixText.length > 0 ||
		!PROSE_BLOCK_TYPES.has(context.blockType ?? "")
	) {
		return completion;
	}
	const lastPrefixChar = context.prefixText.slice(-1);
	const firstCompletionChar = completion[0];
	if (
		!isWordLikeChar(lastPrefixChar) ||
		!isWordLikeChar(firstCompletionChar)
	) {
		return completion;
	}
	if (!hasLikelyWordBoundary(completion)) {
		return completion;
	}
	const leadingWord = completion.match(/^[A-Za-z0-9_'-]+/)?.[0] ?? "";
	if (leadingWord.length > 0 && leadingWord.length <= 2) {
		return completion;
	}
	return ` ${completion}`;
}

function stripWrappedCompletionQuotes(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (!completion || context.suffixText.length > 0) {
		return completion;
	}
	const trimmed = completion.trim();
	if (trimmed.length < 2 || isLikelyInsideOpenQuote(context.prefixText)) {
		return completion;
	}
	const unwrapped = unwrapMatchingQuotes(trimmed);
	if (unwrapped == null) {
		return completion;
	}
	const leadingWhitespace = completion.match(/^\s*/)?.[0] ?? "";
	const trailingWhitespace = completion.match(/\s*$/)?.[0] ?? "";
	return `${leadingWhitespace}${unwrapped}${trailingWhitespace}`;
}

function stripLeadingBoundaryPunctuationArtifacts(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (
		!completion ||
		context.suffixText.length > 0 ||
		!PROSE_BLOCK_TYPES.has(context.blockType ?? "")
	) {
		return completion;
	}
	const prefixEndsWithWhitespace = /\s$/.test(context.prefixText);
	const prefixEndsSentence = /[.!?]["')\]]*\s*$/.test(context.prefixText);
	if (!prefixEndsWithWhitespace && !prefixEndsSentence) {
		return completion;
	}
	if (prefixEndsWithWhitespace) {
		return completion.replace(/^([ \t]*)([,.;:!?]+)(?=\s|["'A-Z])/u, "$1");
	}
	if (prefixEndsSentence) {
		return completion.replace(/^([ \t]*)([,;:]+)(?=\s|["'A-Z])/u, "$1");
	}
	return completion;
}

function collapseDuplicateBoundaryWhitespace(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (!completion || context.suffixText.length > 0) {
		return completion;
	}
	if (!/\s$/.test(context.prefixText)) {
		return completion;
	}
	return completion.replace(/^[ \t]+/u, "");
}

function maybeCapitalizeSentenceStart(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (
		!completion ||
		context.suffixText.length > 0 ||
		!PROSE_BLOCK_TYPES.has(context.blockType ?? "") ||
		!/[.!?]["')\]]*\s*$/.test(context.prefixText)
	) {
		return completion;
	}
	return completion.replace(
		/^(\s*["'([{“‘-]*)([a-z])/u,
		(_, prefix: string, character: string) =>
			`${prefix}${character.toUpperCase()}`,
	);
}

function shouldRejectLowQualityCompletion(
	context: AutocompleteRequestContext,
	completion: string,
): boolean {
	const trimmed = completion.trim();
	if (!trimmed) {
		return true;
	}
	if (
		PROSE_BLOCK_TYPES.has(context.blockType ?? "") &&
		context.suffixText.length === 0 &&
		countWordLikeTokens(trimmed) === 1 &&
		trimmed.length < MIN_PROSE_SINGLE_WORD_COMPLETION_CHARS &&
		!/[.!?]$/.test(trimmed)
	) {
		// Single-character or two-character prose guesses tend to feel like flicker.
		// Allow short but still meaningful continuations such as "cat", "the", or "and".
		return true;
	}
	return false;
}

function countWordLikeTokens(value: string): number {
	return value.match(/[A-Za-z0-9_'-]+/g)?.length ?? 0;
}

function hasLikelyWordBoundary(value: string): boolean {
	return /[\s.,!?;:]/.test(value.slice(1));
}

function isWordLikeChar(value: string): boolean {
	return /[A-Za-z0-9]/.test(value);
}

function unwrapMatchingQuotes(value: string): string | null {
	const quotePairs: Array<[string, string]> = [
		['"', '"'],
		["'", "'"],
		["“", "”"],
		["‘", "’"],
	];
	for (const [open, close] of quotePairs) {
		if (value.startsWith(open) && value.endsWith(close)) {
			const inner = value
				.slice(open.length, value.length - close.length)
				.trim();
			return inner.length > 0 ? inner : null;
		}
	}
	return null;
}

function isLikelyInsideOpenQuote(value: string): boolean {
	const asciiDoubleQuotes = value.match(/"/g)?.length ?? 0;
	const asciiSingleQuotes = value.match(/'/g)?.length ?? 0;
	const smartOpenQuotes = value.match(/“/g)?.length ?? 0;
	const smartCloseQuotes = value.match(/”/g)?.length ?? 0;
	const smartOpenSingles = value.match(/‘/g)?.length ?? 0;
	const smartCloseSingles = value.match(/’/g)?.length ?? 0;
	return (
		asciiDoubleQuotes % 2 === 1 ||
		asciiSingleQuotes % 2 === 1 ||
		smartOpenQuotes > smartCloseQuotes ||
		smartOpenSingles > smartCloseSingles
	);
}

export function head(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : value.slice(0, maxChars);
}

export function tail(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : value.slice(-maxChars);
}
