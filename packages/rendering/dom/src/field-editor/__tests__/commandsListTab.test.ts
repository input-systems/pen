import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { applyListTabBehavior } from "../commandsListTab";
import type { FieldEditorTextLike } from "../crdt";

type BlocksMapLike = {
	get(key: string): { get(field: string): unknown } | undefined;
};

type RawDocLike = {
	getMap(name: string): BlocksMapLike;
};

function getYText(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
): FieldEditorTextLike {
	const adapter = editor.internals.adapter;
	const doc = editor.internals.crdtDoc;
	const ydoc = adapter.raw<RawDocLike>(doc);
	const ytext = ydoc
		.getMap("blocks")
		.get(blockId)
		?.get("content") as FieldEditorTextLike | null;
	if (!ytext) {
		throw new Error(`Missing test Y.Text for block ${blockId}`);
	}
	return ytext;
}

/**
 * Every case runs on two bullet items, "root" then "child". `target` picks
 * which one receives the key; `childIndent` sets the second item's nesting.
 */
const LIST_TAB_CASES: Array<{
	name: string;
	target: "root" | "child";
	childIndent: number;
	range: { start: number; end: number };
	shiftKey: boolean;
	handled: boolean;
	expectedIndent: number;
}> = [
	{
		name: "Tab indents a list item when the previous sibling can own the nesting",
		target: "child",
		childIndent: 0,
		range: { start: 2, end: 2 },
		shiftKey: false,
		handled: true,
		expectedIndent: 1,
	},
	{
		name: "Tab returns null for a top-level list item without a parent candidate",
		target: "root",
		childIndent: 0,
		range: { start: 4, end: 4 },
		shiftKey: false,
		handled: false,
		expectedIndent: 0,
	},
	{
		name: "Shift-Tab returns null for an already top-level list item",
		target: "root",
		childIndent: 0,
		range: { start: 1, end: 3 },
		shiftKey: true,
		handled: false,
		expectedIndent: 0,
	},
	{
		name: "Shift-Tab outdents a nested list item",
		target: "child",
		childIndent: 1,
		range: { start: 1, end: 3 },
		shiftKey: true,
		handled: true,
		expectedIndent: 0,
	},
];

describe("applyListTabBehavior", () => {
	it.each(LIST_TAB_CASES)(
		"$name",
		({ target, childIndent, range, shiftKey, handled, expectedIndent }) => {
			const editor = createEditor({ schema: defaultSchema });
			const rootId = editor.firstBlock()!.id;
			const childId = crypto.randomUUID();

			editor.apply([
				{
					type: "set-props",
					blockId: rootId,
					props: { type: "bulletListItem" },
				},
				{
					type: "splice-text",
					blockId: rootId,
					from: 0,
					to: 0,
					insert: "root",
				},
				{
					type: "insert-block",
					blockId: childId,
					blockType: "bulletListItem",
					props: { indent: childIndent },
					position: { after: rootId },
				},
				{
					type: "splice-text",
					blockId: childId,
					from: 0,
					to: 0,
					insert: "child",
				},
			]);
			const blockId = target === "root" ? rootId : childId;

			const result = applyListTabBehavior(editor, {
				blockId,
				ytext: getYText(editor, blockId),
				range,
				shiftKey,
			});

			expect(result).toEqual(
				handled
					? {
							blockId,
							anchorOffset: range.start,
							focusOffset: range.end,
						}
					: null,
			);
			expect(editor.getBlock(blockId)?.props.indent).toBe(expectedIndent);
			editor.destroy();
		},
	);
});
