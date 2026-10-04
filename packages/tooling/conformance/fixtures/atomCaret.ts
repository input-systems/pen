import type { DocumentOp } from "@input/pen-types";
import type { TestBlock } from "@input/pen-test";

/**
 * `atom-caret` (W35.G7, §6.3): one block per caret-beside-atom case. The
 * skeleton holds the text; `populateYDoc` does not write inline atoms, so
 * they arrive through `atomCaretOps` on `editor.apply` before any surface
 * mounts. Offsets in the comments are logical (an atom is one offset, N1).
 */
export const ATOM_CARET_IDS = {
	mid: "ac-mid",
	start: "ac-start",
	end: "ac-end",
	pair: "ac-pair",
	only: "ac-only",
	app: "ac-app",
	rtl: "ac-rtl",
	wrap: "ac-wrap",
	empty: "ac-empty",
} as const;

/** Text before the atom in `ac-wrap`; long enough to wrap several times in a narrow viewport. */
export const ATOM_CARET_WRAP_PREFIX =
	"A wrapping line of plain words that runs on until the mention wraps ";

export const ATOM_CARET_BLOCKS: readonly TestBlock[] = [
	// "Hello " @Ada " world": atom at 6..7.
	{ id: ATOM_CARET_IDS.mid, type: "paragraph", content: "Hello  world" },
	// @Ada " starts": atom at 0..1.
	{ id: ATOM_CARET_IDS.start, type: "paragraph", content: " starts" },
	// "ends " @Ada: atom at 5..6, block-final.
	{ id: ATOM_CARET_IDS.end, type: "paragraph", content: "ends " },
	// "x " @Ada @Bo " y": atoms at 2..3 and 3..4.
	{ id: ATOM_CARET_IDS.pair, type: "paragraph", content: "x  y" },
	// @Ada only.
	{ id: ATOM_CARET_IDS.only, type: "paragraph", content: "" },
	// "see " inlineApp " here": atom at 4..5.
	{ id: ATOM_CARET_IDS.app, type: "paragraph", content: "see  here" },
	// "مرحبا " @Ada " عالم": atom at 6..7, right-to-left.
	{
		id: ATOM_CARET_IDS.rtl,
		type: "paragraph",
		props: { direction: "rtl" },
		content: "مرحبا  عالم",
	},
	// A long prefix, then @Ada at the soft wrap.
	{
		id: ATOM_CARET_IDS.wrap,
		type: "paragraph",
		content: `${ATOM_CARET_WRAP_PREFIX} and after`,
	},
	{ id: ATOM_CARET_IDS.empty, type: "paragraph", content: "" },
];

function mention(blockId: string, at: number, label: string): DocumentOp {
	return {
		type: "splice-text",
		blockId,
		from: at,
		to: at,
		insert: {
			nodeType: "mention",
			props: { id: `user-${label.toLowerCase()}`, label },
		},
	};
}

export function atomCaretOps(): DocumentOp[] {
	return [
		mention(ATOM_CARET_IDS.mid, 6, "Ada"),
		mention(ATOM_CARET_IDS.start, 0, "Ada"),
		mention(ATOM_CARET_IDS.end, 5, "Ada"),
		mention(ATOM_CARET_IDS.pair, 2, "Ada"),
		mention(ATOM_CARET_IDS.pair, 3, "Bo"),
		mention(ATOM_CARET_IDS.only, 0, "Ada"),
		{
			type: "splice-text",
			blockId: ATOM_CARET_IDS.app,
			from: 4,
			to: 4,
			insert: {
				nodeType: "inlineApp",
				props: { appType: "poll", config: {} },
			},
		},
		mention(ATOM_CARET_IDS.rtl, 6, "Ada"),
		mention(ATOM_CARET_IDS.wrap, ATOM_CARET_WRAP_PREFIX.length, "Ada"),
	];
}
