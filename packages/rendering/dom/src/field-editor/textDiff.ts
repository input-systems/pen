import { getLogicalTextContent } from "./inlineAtomDom";

export type TextDiffOp =
	| { type: "insert"; offset: number; text: string }
	| { type: "delete"; offset: number; length: number };

/**
 * O(n) scan from both ends to find the changed region.
 * Returns delete + insert ops for the diff.
 */
export function computeTextDiff(
	oldText: string,
	newText: string,
): TextDiffOp[] {
	if (oldText === newText) return [];

	let prefixLen = 0;
	const minLen = Math.min(oldText.length, newText.length);
	while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
		prefixLen++;
	}

	let oldSuffix = oldText.length;
	let newSuffix = newText.length;
	while (
		oldSuffix > prefixLen &&
		newSuffix > prefixLen &&
		oldText[oldSuffix - 1] === newText[newSuffix - 1]
	) {
		oldSuffix--;
		newSuffix--;
	}

	const ops: TextDiffOp[] = [];

	const deleteLen = oldSuffix - prefixLen;
	if (deleteLen > 0) {
		ops.push({ type: "delete", offset: prefixLen, length: deleteLen });
	}

	const insertText = newText.slice(prefixLen, newSuffix);
	if (insertText.length > 0) {
		ops.push({ type: "insert", offset: prefixLen, text: insertText });
	}

	return ops;
}

/**
 * C2: the minimal diff whose change sits nearest `startOffset`. Minimal
 * diffs are not unique: a delete/insert pair slides along a run of repeated
 * characters, and the prefix-greedy one misplaces an IME edit that started
 * later in the run. Ties take the smaller offset. A candidate that would
 * split a surrogate pair is skipped.
 */
export function computeAnchoredTextDiff(
	oldText: string,
	newText: string,
	startOffset: number,
): TextDiffOp[] {
	if (oldText === newText) return [];
	const minLen = Math.min(oldText.length, newText.length);
	let prefix = 0;
	while (prefix < minLen && oldText[prefix] === newText[prefix]) {
		prefix++;
	}
	let suffix = 0;
	while (
		suffix < minLen &&
		oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
	) {
		suffix++;
	}
	const kept = Math.min(prefix + suffix, minLen);
	const deleteLength = oldText.length - kept;
	const insertLength = newText.length - kept;
	const lowest = Math.max(0, kept - suffix);
	const highest = Math.min(prefix, kept);

	let offset = -1;
	for (let candidate = lowest; candidate <= highest; candidate++) {
		if (
			splitsSurrogatePair(oldText, candidate) ||
			splitsSurrogatePair(oldText, candidate + deleteLength) ||
			splitsSurrogatePair(newText, candidate + insertLength)
		) {
			continue;
		}
		if (
			offset === -1 ||
			Math.abs(candidate - startOffset) < Math.abs(offset - startOffset)
		) {
			offset = candidate;
		}
	}
	if (offset === -1) {
		return computeTextDiff(oldText, newText);
	}

	const ops: TextDiffOp[] = [];
	if (deleteLength > 0) {
		ops.push({ type: "delete", offset, length: deleteLength });
	}
	if (insertLength > 0) {
		ops.push({
			type: "insert",
			offset,
			text: newText.slice(offset, offset + insertLength),
		});
	}
	return ops;
}

function splitsSurrogatePair(text: string, index: number): boolean {
	if (index <= 0 || index >= text.length) return false;
	const before = text.charCodeAt(index - 1);
	const after = text.charCodeAt(index);
	return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

export function extractTextFromDOM(element: HTMLElement): string {
	return getLogicalTextContent(element);
}
