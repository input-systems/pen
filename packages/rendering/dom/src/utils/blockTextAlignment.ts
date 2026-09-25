import type { BlockHandle } from "@input/pen-types";

/** Text alignment values supported by Pen's block renderers. */
export type BlockTextAlignment =
	| "left"
	| "right"
	| "center"
	| "justify"
	| "start"
	| "end";

/**
 * Returns a block's text alignment when it is a supported value.
 *
 * @param block - Block whose `textAlignment` prop should be resolved.
 * @returns The supported alignment, or `undefined` for an absent or invalid prop.
 */
export function resolveBlockTextAlignment(
	block: Pick<BlockHandle, "props">,
): BlockTextAlignment | undefined {
	const alignment = block.props.textAlignment;
	return alignment === "left" ||
		alignment === "right" ||
		alignment === "center" ||
		alignment === "justify" ||
		alignment === "start" ||
		alignment === "end"
		? alignment
		: undefined;
}
