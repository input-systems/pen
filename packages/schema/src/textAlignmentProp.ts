import {
	prop,
	resolveSchema,
} from "@input/pen-core";

const TEXT_ALIGNMENTS = [
	"left",
	"right",
	"center",
	"justify",
	"start",
	"end",
] as const;

export const textAlignmentProp = resolveSchema(
	prop
		.enum(TEXT_ALIGNMENTS)
		.optional()
		.default(undefined)
		.describe("Block text alignment"),
);

export function textAlignmentStyle(value: unknown): string {
	switch (value) {
		case "left":
			return ' style="text-align: left"';
		case "right":
			return ' style="text-align: right"';
		case "center":
			return ' style="text-align: center"';
		case "justify":
			return ' style="text-align: justify"';
		case "start":
			return ' style="text-align: start"';
		case "end":
			return ' style="text-align: end"';
		default:
			return "";
	}
}
