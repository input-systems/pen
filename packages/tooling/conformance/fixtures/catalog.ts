import type { TestBlock } from "@input/pen-test";
import { BIDI_MIXED_BLOCKS } from "./bidi";
import { GRAPHEME_CLUSTER_BLOCKS } from "./grapheme";

/** Large mixed fixtures (`@input/pen-test` mixed scale fixture), built on demand. */
export type ScaleFixtureName = "scale-1k" | "scale-5k" | "scale-10k" | "scale-50k";

/** Root-block count per scale fixture. */
export const SCALE_FIXTURE_ROOT_COUNTS: Readonly<Record<ScaleFixtureName, number>> = {
	"scale-1k": 1_000,
	"scale-5k": 5_000,
	"scale-10k": 10_000,
	"scale-50k": 50_000,
};

export type FixtureName =
	| ScaleFixtureName
	| "hello-world"
	| "two-paragraph"
	| "empty"
	| "deterministic"
	| "windowed-large"
	| "g5-geometry"
	| "bidi-mixed"
	| "nested-toggle"
	| "grapheme-clusters"
	| "code-block";

export const CODE_BLOCK_LINES_ID = "code-lines";
export const CODE_BLOCK_TRAILING_ID = "code-trailing";

export const NESTED_TOGGLE_PARENT_ID = "nest-parent";
export const NESTED_TOGGLE_CHILD_ID = "nest-child";
export const NESTED_TOGGLE_CHILD_TEXT = "Nested child";

/** Appended after `BIDI_MIXED_BLOCKS` so M5's block index 3 stays line B. */
export const BIDI_DIGITS_RTL_ID = "bidi-digits-rtl";
export const BIDI_DIGITS_RTL_TEXT = "مرحبا 123";
/** Plain RTL host; G3 inserts the mention so the fixture does not ship an atom. */
export const BIDI_ATOM_RTL_ID = "bidi-atom-rtl";
export const BIDI_ATOM_RTL_TEXT = "مرحبا";

const FIXTURE_PRESENT = {
	"hello-world": true,
	"two-paragraph": true,
	empty: true,
	deterministic: true,
	"windowed-large": true,
	"g5-geometry": true,
	"bidi-mixed": true,
	"nested-toggle": true,
	"grapheme-clusters": true,
	"code-block": true,
} as const satisfies Record<Exclude<FixtureName, ScaleFixtureName>, true>;

/**
 * Every small fixture. Scale fixtures are excluded on purpose: suites that
 * iterate this list (AX1 runs axe per fixture) must not mount 50k blocks.
 */
export const FIXTURE_NAMES: readonly Exclude<FixtureName, ScaleFixtureName>[] =
	Object.keys(FIXTURE_PRESENT) as Exclude<FixtureName, ScaleFixtureName>[];

export const WINDOWED_LARGE_BLOCK_COUNT = 40;
export const WINDOWED_WINDOW_SIZE = 8;

export function windowedBlockId(index: number): string {
	return `win-${index}`;
}

function windowedLargeBlocks(): TestBlock[] {
	const blocks: TestBlock[] = [];
	for (let index = 0; index < WINDOWED_LARGE_BLOCK_COUNT; index++) {
		blocks.push({
			id: windowedBlockId(index),
			type: "paragraph",
			content: `Window block ${index}`,
		});
	}
	return blocks;
}

export const LOCAL_FIXTURES: Record<
	Exclude<FixtureName, "deterministic" | ScaleFixtureName>,
	readonly TestBlock[]
> = {
	"hello-world": [
		{
			id: "hello-p1",
			type: "paragraph",
			content: "Hello world",
		},
	],
	empty: [
		{
			id: "empty-p1",
			type: "paragraph",
			// letterless on purpose. hello-world here makes HOST6 empty-click unfailable.
			content: "",
		},
	],
	"two-paragraph": [
		{
			id: "two-p1",
			type: "paragraph",
			content: "Alpha bravo charlie",
		},
		{
			id: "two-p2",
			type: "paragraph",
			content: "Delta echo foxtrot",
		},
	],
	"windowed-large": windowedLargeBlocks(),
	"g5-geometry": [
		{
			id: "g5-wrap",
			type: "paragraph",
			content: "AAAAABBBBBCCCCCDDDDDEEEEE",
		},
		{
			id: "g5-empty",
			type: "paragraph",
			content: "",
		},
		{
			id: "g5-atoms",
			type: "paragraph",
			// plain latin; g2/g5 apply the inline node. the id names the case, the shape does not.
			content: "LEFT WRAP ATOM LINE",
		},
		{
			id: "g5-tail",
			type: "paragraph",
			content: "Tail block for boundaries",
		},
	],
	"bidi-mixed": [
		...BIDI_MIXED_BLOCKS,
		{
			id: BIDI_DIGITS_RTL_ID,
			type: "paragraph",
			props: { direction: "rtl" },
			content: BIDI_DIGITS_RTL_TEXT,
		},
		{
			id: BIDI_ATOM_RTL_ID,
			type: "paragraph",
			props: { direction: "rtl" },
			content: BIDI_ATOM_RTL_TEXT,
		},
	],
	"nested-toggle": [
		{
			id: NESTED_TOGGLE_PARENT_ID,
			type: "toggle",
			props: { open: true },
			content: "Toggle parent",
		},
		{
			id: NESTED_TOGGLE_CHILD_ID,
			type: "paragraph",
			props: { parentId: NESTED_TOGGLE_PARENT_ID },
			content: NESTED_TOGGLE_CHILD_TEXT,
		},
	],
	"grapheme-clusters": [...GRAPHEME_CLUSTER_BLOCKS],
	"code-block": [
		{
			id: "code-above",
			type: "paragraph",
			content: "Above the code",
		},
		{
			id: CODE_BLOCK_LINES_ID,
			type: "codeBlock",
			// a blank line between two text lines
			content: "hey\n\nthere",
		},
		{
			id: CODE_BLOCK_TRAILING_ID,
			type: "codeBlock",
			// the reported shape: a line, then Enter twice
			content: "hey\n\n",
		},
	],
};

export function isLocalFixtureName(
	name: string,
): name is Exclude<FixtureName, "deterministic" | ScaleFixtureName> {
	return Object.prototype.hasOwnProperty.call(LOCAL_FIXTURES, name);
}

export function isScaleFixtureName(name: string): name is ScaleFixtureName {
	return Object.prototype.hasOwnProperty.call(SCALE_FIXTURE_ROOT_COUNTS, name);
}

export function isFixtureName(name: string): name is FixtureName {
	return (
		isLocalFixtureName(name) ||
		isScaleFixtureName(name) ||
		name === "deterministic"
	);
}
