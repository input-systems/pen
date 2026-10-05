import { describe, expect, it } from "vitest";
import { applyListTabBehavior } from "../commandsListTab";
import { getYText, seedParagraphs } from "./fieldEditorFixtures.testHelpers";

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
			const {
				editor,
				blockIds: [rootId, childId],
			} = seedParagraphs(["root", "child"]);
			editor.apply([
				{ type: "set-props", blockId: rootId!, props: { type: "bulletListItem" } },
				{
					type: "set-props",
					blockId: childId!,
					props: { type: "bulletListItem", indent: childIndent },
				},
			]);
			const blockId = (target === "root" ? rootId : childId)!;

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
