import { usesInlineTextSelection } from "@input/pen-core";
import type { BlockHandle, Editor, InlineDelta } from "@input/pen-types";

/** What the caret rules need to know about a block's inline content (N1). */
export type BlockInlineFacts = {
	/** Logical offsets of the block's inline atoms; each embed is one offset. */
	readonly atoms: ReadonlySet<number>;
	/** Logical length, counting each embed as one offset. */
	readonly length: number;
};

/** N1: read a block's atom offsets and logical length from its deltas. */
export function blockInlineFacts(block: BlockHandle): BlockInlineFacts {
	return inlineFactsFromDeltas(block.inlineDeltas());
}

function inlineFactsFromDeltas(
	deltas: readonly InlineDelta[],
): BlockInlineFacts {
	const atoms = new Set<number>();
	let position = 0;
	for (const delta of deltas) {
		if (typeof delta.insert === "string") {
			position += delta.insert.length;
			continue;
		}
		atoms.add(position);
		position += 1;
	}
	return { atoms, length: position };
}

/** O1 from precomputed facts: an atom sits at `offset - 1` or at `offset`. */
export function isAtomAdjacentOffset(
	facts: BlockInlineFacts,
	offset: number,
): boolean {
	return facts.atoms.has(offset - 1) || facts.atoms.has(offset);
}

/**
 * O1: true when an atomic inline node sits at `offset - 1` or at `offset`
 * in the block's logical domain (N1), so the caret is on one of its edges.
 */
export function isAtomAdjacentCaret(
	block: BlockHandle,
	offset: number,
): boolean {
	return isAtomAdjacentOffset(blockInlineFacts(block), offset);
}

/** Whether the block takes inline text selection (O2's "text-capable"). */
export function isTextCapableBlock(editor: Editor, block: BlockHandle): boolean {
	return usesInlineTextSelection(editor.schema.resolve(block.type));
}

/**
 * O2: the block takes inline text selection and holds nothing, not even an
 * atom. Counted from the deltas, because `BlockHandle.length()` returns 0
 * for an atom-only block (W35.R17 fixes that in step 4).
 */
export function isEmptyTextBlock(editor: Editor, block: BlockHandle): boolean {
	return (
		isTextCapableBlock(editor, block) && blockInlineFacts(block).length === 0
	);
}
