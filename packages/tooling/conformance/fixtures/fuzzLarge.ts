import type { DocumentOp } from "@input/pen-types";
import type { TestBlock } from "@input/pen-test";

/**
 * `fuzz-large`: 60 blocks for the DOM fuzzer's long-range actions (W3.R19,
 * D5): a drag across more than 50 blocks and select-all over a document
 * taller than the viewport. Mostly paragraphs, with a heading every tenth
 * block and a short list, so a long selection crosses more than one kind.
 */
export const FUZZ_LARGE_BLOCK_COUNT = 60;

function largeBlock(index: number): TestBlock {
	const id = `fuzz-large-${index}`;
	if (index % 10 === 0) {
		return { id, type: "heading", props: { level: 2 }, content: `Section ${index / 10 + 1}` };
	}
	if (index >= 41 && index <= 43) {
		return { id, type: "bulletListItem", props: { indent: 0 }, content: `Item ${index}` };
	}
	return { id, type: "paragraph", content: `Line ${index} of the large fuzz document.` };
}

export const FUZZ_LARGE_BLOCKS: readonly TestBlock[] = Array.from(
	{ length: FUZZ_LARGE_BLOCK_COUNT },
	(_, index) => largeBlock(index),
);

/** A mention mid-document, so a long range also crosses an atom. */
export function fuzzLargeOps(): DocumentOp[] {
	return [
		{
			type: "splice-text",
			blockId: "fuzz-large-25",
			from: 5,
			to: 5,
			insert: { nodeType: "mention", props: { id: "fuzz-large", label: "Ada" } },
		},
	];
}
