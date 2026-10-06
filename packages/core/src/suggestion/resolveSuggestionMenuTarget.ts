import type { BlockHandle, Editor } from "@input/pen-types";
import { logicalInline } from "../commands/commandBlockContext";
import { isCollapsed } from "../selection/helpers";

const DEFAULT_LOOKBEHIND = 80;

/** Whether a trigger may sit after a non-whitespace character. */
export type SuggestionMenuBoundary = "any" | "whitespace";

/**
 * Match constraints for {@link resolveSuggestionMenuTarget}.
 *
 * Offsets are logical (N6): each inline atom is one unit.
 */
export interface SuggestionMenuTrigger {
	/** Trigger string to find; empty `char` never matches. */
	char: string;
	/** Minimum query length after the trigger. @default 0 */
	minQueryLength?: number;
	/** Maximum query length after the trigger. @default unlimited */
	maxQueryLength?: number;
	/** How many logical offsets before the caret to search. @default 80 */
	lookbehind?: number;
	/** When false, a query containing whitespace is refused. @default false */
	allowSpaces?: boolean;
	/**
	 * `"whitespace"` requires start-of-prefix or a whitespace character before
	 * the trigger (an atom is not whitespace) and anchors on the last trigger
	 * that satisfies it, so later trigger characters belong to the query.
	 * `"any"` anchors on the last trigger regardless.
	 * @default "any"
	 */
	boundary?: SuggestionMenuBoundary;
	/** When set, a query containing this character is refused. @default none */
	closingChar?: string;
	/** When set, the query must match; `lastIndex` is reset first. @default none */
	queryPattern?: RegExp;
}

/** Resolved trigger range in the logical offset domain (N6). */
export interface SuggestionMenuTarget {
	blockId: string;
	startOffset: number;
	endOffset: number;
	query: string;
	trigger: string;
}

/**
 * Logical inline text of a block: stored string text plus one U+FFFC per
 * inline atom, in the same offset domain as caret offsets and
 * `block.length()` (N6).
 *
 * @param block - Live block handle to read.
 * @returns The logical string. Empty blocks return `""`.
 * @throws Never.
 */
export function inlineLogicalText(block: BlockHandle): string {
	return logicalInline(block).text;
}

/**
 * Resolves a collapsed caret to a suggestion-menu trigger range.
 *
 * Matching uses the logical offset domain (N6), not `block.textContent()`.
 * Each inline atom occupies one offset (U+FFFC in {@link inlineLogicalText}).
 * A query range that contains an atom is refused. A trigger immediately after
 * an atom starts at the offset after that atom; `boundary: "whitespace"` still
 * rejects when the preceding unit is the atom. Under that boundary the
 * match anchors on the last trigger preceded by whitespace or sitting at the
 * start of the lookbehind, so a later trigger character is part of the query.
 *
 * @param editor - Editor whose collapsed text caret is read.
 * @param trigger - Trigger character and match constraints. See
 *   {@link SuggestionMenuTrigger} for field defaults.
 * @returns The trigger range in logical offsets, or `null` when the caret is
 *   not a collapsed in-block text selection or the prefix does not match.
 * @throws Never. Non-matches return `null`.
 */
export function resolveSuggestionMenuTarget(
	editor: Editor,
	trigger: SuggestionMenuTrigger,
): SuggestionMenuTarget | null {
	if (trigger.char.length === 0) {
		return null;
	}

	const selection = editor.selection;
	if (selection?.type !== "text" || !isCollapsed(selection)) {
		return null;
	}
	if (selection.anchor.blockId !== selection.focus.blockId) {
		return null;
	}

	const block = editor.getBlock(selection.focus.blockId);
	if (!block) {
		return null;
	}

	const offset = selection.focus.offset;
	const lookbehind = trigger.lookbehind ?? DEFAULT_LOOKBEHIND;
	const prefixStartOffset = Math.max(0, offset - lookbehind);
	const { text, atoms } = logicalInline(block);
	const textBefore = text.slice(prefixStartOffset, offset);
	let triggerIndex = textBefore.lastIndexOf(trigger.char);
	if (trigger.boundary === "whitespace") {
		// a trigger char inside the query ("@ada@example") is query text, so
		// anchor on the last occurrence the boundary accepts
		while (triggerIndex > 0 && !/\s/.test(textBefore[triggerIndex - 1]!)) {
			triggerIndex = textBefore.lastIndexOf(
				trigger.char,
				triggerIndex - 1,
			);
		}
	}
	if (triggerIndex < 0) {
		return null;
	}

	const query = textBefore.slice(triggerIndex + trigger.char.length);
	const startOffset = prefixStartOffset + triggerIndex;
	const queryStartOffset = startOffset + trigger.char.length;
	if (queryRangeContainsAtom(atoms, queryStartOffset, offset)) {
		return null;
	}
	if (!trigger.allowSpaces && /\s/.test(query)) {
		return null;
	}
	if (trigger.closingChar && query.includes(trigger.closingChar)) {
		return null;
	}
	if (query.length < (trigger.minQueryLength ?? 0)) {
		return null;
	}
	if (
		trigger.maxQueryLength !== undefined &&
		query.length > trigger.maxQueryLength
	) {
		return null;
	}
	if (trigger.queryPattern) {
		trigger.queryPattern.lastIndex = 0;
		if (!trigger.queryPattern.test(query)) {
			return null;
		}
	}

	return {
		blockId: selection.focus.blockId,
		startOffset,
		endOffset: offset,
		query,
		trigger: trigger.char,
	};
}

function queryRangeContainsAtom(
	atoms: readonly { start: number; end: number }[],
	queryStart: number,
	queryEnd: number,
): boolean {
	return atoms.some((atom) => atom.start < queryEnd && atom.end > queryStart);
}
