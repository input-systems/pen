import type { BlockHandle } from "@input/pen-types";

export type BlockTextAlignment =
	| "left"
	| "right"
	| "center"
	| "justify"
	| "start"
	| "end";

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
