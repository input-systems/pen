import type { DocumentOp } from "@input/pen-types";
import type { TestBlock } from "@input/pen-test";

/**
 * `fuzz-mixed`: the DOM fuzzer's document (W3.R19). Every block kind the
 * selection surface treats differently sits within a few blocks of every
 * other, so a short random walk crosses text, structural, cell, atom and
 * nested positions. `populateYDoc` drops marks, inline atoms and tables, so
 * those arrive through `fuzzMixedOps` on `editor.apply` before any surface
 * mounts.
 */
const MARKED_ID = "fuzz-marked";
const ATOMS_ID = "fuzz-atoms";
const TABLE_ID = "fuzz-table";
const TOGGLE_ID = "fuzz-toggle";

const MARKED_TEXT = "Plain words with bold, italic and code marks.";
const ATOMS_TEXT = "Ping  and  inline.";

export const FUZZ_MIXED_BLOCKS: readonly TestBlock[] = [
	{
		id: "fuzz-title",
		type: "heading",
		props: { level: 1 },
		content: "Fuzz mixed",
	},
	{ id: MARKED_ID, type: "paragraph", content: MARKED_TEXT },
	{ id: ATOMS_ID, type: "paragraph", content: ATOMS_TEXT },
	{ id: "fuzz-empty", type: "paragraph", content: "" },
	{
		id: "fuzz-astral",
		type: "paragraph",
		content: "Astral \u{1F600} and \u{1D4B3} glyphs",
	},
	{ id: "fuzz-combining", type: "paragraph", content: "Café and ñ combine" },
	{
		id: "fuzz-zwj",
		type: "paragraph",
		content:
			"Family \u{1F468}‍\u{1F469}‍\u{1F467} and \u{1F469}\u{1F3FD}‍\u{1F4BB} here",
	},
	{ id: "fuzz-divider", type: "divider" },
	{
		id: "fuzz-after-divider",
		type: "paragraph",
		content: "After the divider",
	},
	{ id: "fuzz-image", type: "image", props: { src: "", alt: "Fuzz image" } },
	{ id: "fuzz-before-list", type: "paragraph", content: "Before the list" },
	{
		id: "fuzz-list-1",
		type: "bulletListItem",
		props: { indent: 0 },
		content: "First item",
	},
	{
		id: "fuzz-list-2",
		type: "bulletListItem",
		props: { indent: 1 },
		content: "Second item",
	},
	{
		id: "fuzz-list-3",
		type: "bulletListItem",
		props: { indent: 0 },
		content: "Third item",
	},
	{ id: "fuzz-code", type: "codeBlock", content: "const x = 1;\nreturn x;" },
	{
		id: TOGGLE_ID,
		type: "toggle",
		props: { open: true },
		content: "Toggle head",
	},
	{
		id: "fuzz-toggle-child",
		type: "paragraph",
		props: { parentId: TOGGLE_ID },
		content: "Toggle child",
	},
	{
		id: "fuzz-subhead",
		type: "heading",
		props: { level: 2 },
		content: "Second section",
	},
	{
		id: "fuzz-p1",
		type: "paragraph",
		content: "The quick brown fox jumps over the lazy dog.",
	},
	{ id: "fuzz-p2", type: "paragraph", content: "Short line" },
	{
		id: "fuzz-p3",
		type: "paragraph",
		content: "Typing in the middle must stay cheap.",
	},
	{ id: "fuzz-p4", type: "paragraph", content: "x" },
	{
		id: "fuzz-last",
		type: "paragraph",
		content: "Last paragraph of the fixture",
	},
];

function markOp(
	from: number,
	to: number,
	marks: Record<string, unknown>,
): DocumentOp {
	return { type: "format-text", blockId: MARKED_ID, from, to, marks };
}

/** Marks, the two inline atoms, and the 2×2 table (after the image) — 24 blocks in all. */
export function fuzzMixedOps(): DocumentOp[] {
	const bold = MARKED_TEXT.indexOf("bold");
	const italic = MARKED_TEXT.indexOf("italic");
	const code = MARKED_TEXT.indexOf("code");
	const firstGap = ATOMS_TEXT.indexOf("  ") + 1;
	const ops: DocumentOp[] = [
		markOp(bold, bold + 4, { bold: true }),
		markOp(italic, italic + 6, { italic: true }),
		markOp(code, code + 4, { code: true }),
		// The second insert lands after the first atom, which shifts the gap by one.
		{
			type: "splice-text",
			blockId: ATOMS_ID,
			from: firstGap,
			to: firstGap,
			insert: {
				nodeType: "mention",
				props: { id: "user-ada", label: "Ada" },
			},
		},
		{
			type: "splice-text",
			blockId: ATOMS_ID,
			from: ATOMS_TEXT.indexOf("  ", firstGap) + 2,
			to: ATOMS_TEXT.indexOf("  ", firstGap) + 2,
			insert: {
				nodeType: "inlineApp",
				props: { appType: "chip", config: {} },
			},
		},
		{
			type: "insert-block",
			blockId: TABLE_ID,
			blockType: "table",
			props: {},
			position: { after: "fuzz-image" },
		},
	];
	for (const [row, col] of [
		[0, 0],
		[0, 1],
		[1, 0],
		[1, 1],
	] as const) {
		ops.push({
			type: "splice-text",
			blockId: TABLE_ID,
			cell: { row, col },
			from: 0,
			to: 0,
			insert: `r${row}c${col}`,
		});
	}
	return ops;
}
