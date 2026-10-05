export function isClearDocumentPrompt(prompt: string): boolean {
	const normalizedPrompt = prompt.trim().toLowerCase();
	return (
		/\b(remove|delete|clear|erase|wipe)\b/.test(normalizedPrompt) &&
		/\b(all|entire|whole|everything)\b/.test(normalizedPrompt) &&
		/\b(document|content|contents|text|story|page)\b/.test(normalizedPrompt)
	);
}

export function isWholeDocumentRewritePrompt(prompt: string): boolean {
	const normalizedPrompt = prompt.trim().toLowerCase();
	return (
		/\b(rewrite|redo|revise|rework|replace)\s+(?:the|this|my)?\s*(?:entire|whole|full|all)?\s*(?:document|content|contents|text|story|page)\b/.test(
			normalizedPrompt,
		) || /\bmake (?:it|this) about\b/.test(normalizedPrompt)
	);
}

export function isDocumentResetPrompt(prompt: string): boolean {
	const normalizedPrompt = prompt.trim().toLowerCase();
	return /\b(start(?:ing)?\s+(?:over|again|from scratch)|begin\s+again|from scratch|restart)\b/.test(
		normalizedPrompt,
	);
}

export function isDocumentFollowUpEditPrompt(prompt: string): boolean {
	const normalizedPrompt = prompt.trim().toLowerCase();
	if (
		/\b(continue|append|add|insert|another|more|next)\b/.test(
			normalizedPrompt,
		)
	) {
		return false;
	}
	return (
		/\b(change|update|adjust|edit|fix|improve|polish|revise|rework|rename|retitle|make)\b/.test(
			normalizedPrompt,
		) &&
		(/\b(title|heading|story|document|content|contents|text|tone|voice|ending|opening|intro|introduction|theme)\b/.test(
			normalizedPrompt,
		) ||
			/\bmake (?:it|this)\b/.test(normalizedPrompt))
	);
}

export function parseParagraphReference(prompt: string): number | null {
	const match = prompt.match(
		/\b(?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)|(\d+)(?:st|nd|rd|th))\s+paragraph\b/i,
	);
	if (!match) {
		return null;
	}
	const wordOrdinal = match[1]?.toLowerCase();
	if (wordOrdinal) {
		return resolveWordOrdinal(wordOrdinal);
	}
	const numericOrdinal = Number.parseInt(match[2] ?? "", 10);
	return Number.isFinite(numericOrdinal) && numericOrdinal > 0
		? numericOrdinal
		: null;
}

function resolveWordOrdinal(word: string): number | null {
	switch (word) {
		case "first":
			return 1;
		case "second":
			return 2;
		case "third":
			return 3;
		case "fourth":
			return 4;
		case "fifth":
			return 5;
		case "sixth":
			return 6;
		case "seventh":
			return 7;
		case "eighth":
			return 8;
		case "ninth":
			return 9;
		case "tenth":
			return 10;
		default:
			return null;
	}
}
