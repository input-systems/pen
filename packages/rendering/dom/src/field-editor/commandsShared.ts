import { INLINE_ATOM_REPLACEMENT_TEXT } from "./inlineAtomModel";
import { type DocumentOp, type Editor } from "@input/pen-types";

export interface SelectionRange {
	start: number;
	end: number;
}

export interface SelectionTarget {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
	selectBlock?: boolean;
}

export type InlineTextLike = {
	length: number;
	toString(): string;
	toDelta?(): Array<{ insert?: string | Record<string, unknown> }>;
};

export type BlockInputRuleEngine = {
	tryMatch(
		editor: Editor,
		blockId: string,
		insertedText: string,
		options?: { offset?: number },
	): DocumentOp[] | null;
};

export const LIST_BLOCK_TYPES = new Set([
	"bulletListItem",
	"numberedListItem",
	"checkListItem",
]);

/**
 * The field's text in the logical domain: each inline embed is one
 * U+FFFC, as `getLogicalTextContent` reads the DOM (N1). `ytext.toString()`
 * drops embeds, so comparing it with the DOM text, or computing offsets on
 * it, misplaces everything after an atom.
 */
export function getLogicalInlineText(ytext: InlineTextLike): string {
	const deltas = ytext.toDelta?.();
	if (!Array.isArray(deltas)) {
		return ytext.toString();
	}
	let text = "";
	for (const delta of deltas) {
		if (!delta || typeof delta !== "object" || !("insert" in delta)) {
			continue;
		}
		const insert = (delta as { insert?: unknown }).insert;
		if (typeof insert === "string") {
			text += insert;
		} else if (insert !== undefined && insert !== null) {
			text += INLINE_ATOM_REPLACEMENT_TEXT;
		}
	}
	return text;
}

export function getLogicalInlineLength(ytext: InlineTextLike): number {
	const delta = ytext.toDelta?.();
	if (delta) {
		return delta.reduce((length, entry) => {
			if (typeof entry.insert === "string") {
				return length + entry.insert.length;
			}
			return entry.insert ? length + 1 : length;
		}, 0);
	}

	const text = ytext.toString();
	if (text === "") {
		return 0;
	}
	return ytext.length;
}

export function normalizeInlineOffset(
	ytext: InlineTextLike,
	offset: number,
): number {
	return Math.max(0, Math.min(offset, getLogicalInlineLength(ytext)));
}

export function normalizeInlineRange(
	ytext: InlineTextLike,
	range: SelectionRange | null,
): SelectionRange | null {
	if (!range) return null;

	return {
		start: normalizeInlineOffset(ytext, range.start),
		end: normalizeInlineOffset(ytext, range.end),
	};
}

export function getSelectionTarget(
	blockId: string,
	ytext: InlineTextLike,
	range: SelectionRange | null,
): SelectionTarget {
	const normalizedRange = normalizeInlineRange(ytext, range);

	return {
		blockId,
		anchorOffset: normalizedRange?.start ?? 0,
		focusOffset: normalizedRange?.end ?? 0,
	};
}

export function isCollapsedRange(range: SelectionRange | null): boolean {
	return !range || range.start === range.end;
}

export function getListIndent(
	block: NonNullable<ReturnType<Editor["getBlock"]>>,
): number {
	const rawIndent = block.props?.indent;
	return typeof rawIndent === "number" && rawIndent >= 0 ? rawIndent : 0;
}

export function isListBlock(
	block: ReturnType<Editor["getBlock"]>,
): block is NonNullable<ReturnType<Editor["getBlock"]>> {
	return !!block && LIST_BLOCK_TYPES.has(block.type);
}
