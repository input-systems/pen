import type {
	AISuggestion,
	AISuggestionCandidate,
	AISuggestionScopeSegment,
} from "./types";
import { generateId } from "@input/pen-types";

export function materializeSuggestionsFromCandidates(input: {
	blockId: string;
	scopeId: string;
	scopeHash: string;
	scopeText: string;
	scopeFrom: number;
	candidates: readonly AISuggestionCandidate[];
	segments?: readonly AISuggestionScopeSegment[];
}): readonly AISuggestion[] {
	const materializedSuggestions: AISuggestion[] = [];

	for (const candidate of input.candidates) {
		const matchOffset = findUniqueMatchOffset(
			input.scopeText,
			candidate.originalText,
		);
		if (matchOffset == null) {
			continue;
		}

		const matchEnd = matchOffset + candidate.originalText.length;
		const segment = input.segments
			? findSegmentContaining(input.segments, matchOffset, matchEnd)
			: null;
		if (input.segments && !segment) {
			continue;
		}

		const blockId = segment?.blockId ?? input.blockId;
		const blockOffset = segment
			? matchOffset - segment.from
			: input.scopeFrom + matchOffset;

		materializedSuggestions.push({
			id: generateId(),
			kind: candidate.kind,
			title: candidate.title,
			blockId,
			from: blockOffset,
			to: blockOffset + candidate.originalText.length,
			originalText: candidate.originalText,
			replacementText: candidate.replacementText,
			reason: candidate.reason,
			confidence: candidate.confidence,
			scopeId: input.scopeId,
			scopeHash: input.scopeHash,
			createdAt: Date.now(),
			invalidated: false,
		});
	}

	return dedupeOverlappingSuggestions(materializedSuggestions);
}

export function dedupeOverlappingSuggestions(
	suggestions: readonly AISuggestion[],
): readonly AISuggestion[] {
	const sortedSuggestions = [...suggestions].sort(
		compareSuggestionsForDedupe,
	);
	const acceptedSuggestions: AISuggestion[] = [];

	for (const suggestion of sortedSuggestions) {
		const overlapsAcceptedSuggestion = acceptedSuggestions.some(
			(existing) =>
				existing.blockId === suggestion.blockId &&
				rangesOverlap(
					existing.from,
					existing.to,
					suggestion.from,
					suggestion.to,
				),
		);
		if (overlapsAcceptedSuggestion) {
			continue;
		}
		acceptedSuggestions.push(suggestion);
	}

	return acceptedSuggestions.sort((left, right) => left.from - right.from);
}

// a match that crosses a block boundary has no single block to anchor in and is dropped
function findSegmentContaining(
	segments: readonly AISuggestionScopeSegment[],
	from: number,
	to: number,
): AISuggestionScopeSegment | null {
	return (
		segments.find((segment) => from >= segment.from && to <= segment.to) ??
		null
	);
}

function findUniqueMatchOffset(
	scopeText: string,
	originalText: string,
): number | null {
	if (!originalText) {
		return null;
	}

	const firstOffset = scopeText.indexOf(originalText);
	if (firstOffset < 0) {
		return null;
	}

	const secondOffset = scopeText.indexOf(originalText, firstOffset + 1);
	if (secondOffset >= 0) {
		return null;
	}

	return firstOffset;
}

function compareSuggestionsForDedupe(
	left: AISuggestion,
	right: AISuggestion,
): number {
	const leftConfidence = left.confidence ?? 0;
	const rightConfidence = right.confidence ?? 0;
	if (leftConfidence !== rightConfidence) {
		return rightConfidence - leftConfidence;
	}

	const leftPriority = resolveKindPriority(left.kind);
	const rightPriority = resolveKindPriority(right.kind);
	if (leftPriority !== rightPriority) {
		return leftPriority - rightPriority;
	}

	if (left.from !== right.from) {
		return left.from - right.from;
	}

	return left.to - right.to;
}

function resolveKindPriority(kind: AISuggestion["kind"]): number {
	switch (kind) {
		case "spelling":
			return 1;
		case "grammar":
			return 2;
		case "clarity":
			return 3;
		case "rephrase":
			return 4;
	}
}

function rangesOverlap(
	leftFrom: number,
	leftTo: number,
	rightFrom: number,
	rightTo: number,
): boolean {
	return leftFrom < rightTo && rightFrom < leftTo;
}
