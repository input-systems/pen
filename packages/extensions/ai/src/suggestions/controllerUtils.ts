import type { Editor } from "@input/pen-types";
import type {
	AISuggestion,
	AISuggestionCandidate,
	AISuggestionScope,
} from "./types";

// a document scope's hash is the whole body, so keying dismissal on it would let a dismissed
// fix return after any edit anywhere; the whole document shares one dismissal namespace instead
export const DOCUMENT_SCOPE_FINGERPRINT_HASH = "document";

export function resolveFingerprintScopeHash(scope: AISuggestionScope): string {
	return scope.segments ? DOCUMENT_SCOPE_FINGERPRINT_HASH : scope.hash;
}

// the same fix in the same block is the same suggestion across analyses, wherever it now sits
export function resolveSuggestionIdentityKey(
	suggestion: Pick<
		AISuggestion,
		"blockId" | "kind" | "originalText" | "replacementText"
	>,
): string {
	return [
		suggestion.blockId,
		suggestion.kind,
		suggestion.originalText,
		suggestion.replacementText,
	].join("\u0000");
}

export function resolveSelectedBlockId(editor: Editor): string | null {
	const selection = editor.selection;
	if (!selection) {
		return null;
	}
	if (selection.type === "text") {
		return selection.focus.blockId;
	}
	if (selection.type === "cell") {
		return selection.blockId;
	}
	if (selection.type === "block") {
		return selection.blockIds[0] ?? null;
	}
	return null;
}

export function resolvePreferredOffset(
	editor: Editor,
	blockId: string,
	textLength: number,
): number {
	const selection = editor.selection;
	if (selection?.type === "text" && selection.focus.blockId === blockId) {
		return selection.focus.offset;
	}
	return textLength;
}

export function compareCandidatesForDisplay(
	left: AISuggestionCandidate,
	right: AISuggestionCandidate,
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

	return left.originalText.length - right.originalText.length;
}

function resolveKindPriority(kind: AISuggestionCandidate["kind"]): number {
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

export function rangesOverlap(
	leftFrom: number,
	leftTo: number,
	rightFrom: number,
	rightTo: number,
): boolean {
	return leftFrom < rightTo && rightFrom < leftTo;
}
