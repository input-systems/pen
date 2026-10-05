import type { DocumentOp } from "@input/pen-types";
import type { TestBlock } from "@input/pen-test";

/**
 * `semantics` (W6 §3.7): every block structure AX1 names, for the axe floor
 * (AX8) and the accessibility-tree snapshot (AX1). The skeleton holds the
 * text; the 3×3 table and the mention arrive through `semanticsOps`, because
 * `populateYDoc` writes neither.
 */
export const SEMANTICS_IDS = {
	table: "sem-table",
	mention: "sem-mention",
	/** The paragraph between the first two bullet lists. */
	between: "sem-between",
} as const;

export const SEMANTICS_BLOCKS: readonly TestBlock[] = [
	{ id: "sem-h1", type: "heading", props: { level: 1 }, content: "Semantics" },
	{ id: "sem-h2", type: "heading", props: { level: 2 }, content: "Lists" },
	// A bullet list with a nested level-2 item.
	{ id: "sem-b1", type: "bulletListItem", content: "First bullet" },
	{ id: "sem-b1a", type: "bulletListItem", props: { indent: 1 }, content: "Nested bullet" },
	{ id: "sem-b2", type: "bulletListItem", content: "Second bullet" },
	// A paragraph between two bullet lists gives two groups.
	{ id: SEMANTICS_IDS.between, type: "paragraph", content: "Between the lists" },
	{ id: "sem-b3", type: "bulletListItem", content: "Second list bullet" },
	// A bullet run followed directly by a numbered run at level 1: two groups.
	{ id: "sem-n1", type: "numberedListItem", props: { start: 3 }, content: "Third" },
	{ id: "sem-n2", type: "numberedListItem", content: "Fourth" },
	{ id: "sem-h3", type: "heading", props: { level: 3 }, content: "Other blocks" },
	{ id: "sem-c1", type: "checkListItem", props: { checked: true }, content: "Done" },
	{ id: "sem-c2", type: "checkListItem", content: "Open" },
	{ id: "sem-quote", type: "blockquote", content: "A quote" },
	{ id: "sem-quote-child", type: "paragraph", props: { parentId: "sem-quote" }, content: "Quoted child" },
	{ id: "sem-code", type: "codeBlock", content: "const answer = 42;" },
	{ id: "sem-callout", type: "callout", content: "A callout" },
	{ id: SEMANTICS_IDS.mention, type: "paragraph", content: "Hello  there" },
];

/** A 3×3 table with a header row after the callout, and a mention at offset 6. */
export function semanticsOps(): DocumentOp[] {
	const ops: DocumentOp[] = [
		{
			type: "insert-block",
			blockId: SEMANTICS_IDS.table,
			blockType: "table",
			props: { hasHeaderRow: true },
			position: { after: "sem-callout" },
		},
		{ type: "grid", blockId: SEMANTICS_IDS.table, change: { kind: "insert-row", index: 2 } },
		{ type: "grid", blockId: SEMANTICS_IDS.table, change: { kind: "insert-column", index: 2 } },
	];
	for (let row = 0; row < 3; row += 1) {
		for (let col = 0; col < 3; col += 1) {
			ops.push({
				type: "splice-text",
				blockId: SEMANTICS_IDS.table,
				cell: { row, col },
				from: 0,
				to: 0,
				insert: row === 0 ? `Heading ${col + 1}` : `r${row}c${col}`,
			});
		}
	}
	ops.push({
		type: "splice-text",
		blockId: SEMANTICS_IDS.mention,
		from: 6,
		to: 6,
		insert: { nodeType: "mention", props: { id: "user-ada", label: "Ada" } },
	});
	return ops;
}
