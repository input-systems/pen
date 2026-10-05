// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { defaultSchema } from "@input/pen-schema";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { selectInlineAtomRangeFromShiftClick } from "../inlineAtomDestructure";
import { getInlineAtomPointerOffset } from "../inlineAtomDom";
import type { InlineAtomWrapperInteractionOptions } from "../inlineAtomWrapperInteractions";

/**
 * T5 / O1: the half of an atom a click lands on decides the side it takes,
 * read in the direction of the bidi run the atom sits in, not the block's.
 * Layout is stubbed: the atom box spans x 100..140, so x 110 is its visual
 * left half and x 130 its right half.
 */
const ATOM_RECT = { left: 100, right: 140, top: 0, bottom: 20 };
const LEFT_HALF_X = 110;
const RIGHT_HALF_X = 130;

function inlineWith(direction: "ltr" | "rtl", before: string, label: string, after: string): HTMLElement {
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.setAttribute("dir", direction);
	inline.style.direction = direction;
	inline.append(before);
	const host = document.createElement("span");
	host.setAttribute(DATA_ATTRS.inlineAtomHost, "");
	const chip = document.createElement("span");
	chip.setAttribute(DATA_ATTRS.inlineAtom, "");
	chip.textContent = label;
	chip.getBoundingClientRect = () =>
		({
			...ATOM_RECT,
			x: ATOM_RECT.left,
			y: ATOM_RECT.top,
			width: ATOM_RECT.right - ATOM_RECT.left,
			height: ATOM_RECT.bottom - ATOM_RECT.top,
			toJSON: () => ({}),
		}) as DOMRect;
	host.append(chip);
	inline.append(host, after);
	document.body.append(inline);
	return inline;
}

describe("getInlineAtomPointerOffset (T5, O1)", () => {
	it.each([
		["a left-to-right block", "ltr", "Hello ", "@Ada", " world", LEFT_HALF_X, 6],
		["a right-to-left run", "rtl", "مرحبا ", "@Ada", " عالم", RIGHT_HALF_X, 6],
		["a left-to-right run inside a right-to-left block", "rtl", "مرحبا abc ", "@Ada", " def عالم", LEFT_HALF_X, 10],
		["a right-to-left run inside a left-to-right block", "ltr", "hello שלום ", "@דנה", " עולם world", RIGHT_HALF_X, 11],
	] as const)(
		"T5: an atom in %s takes its start on the half the run reads first",
		(_name, direction, before, label, after, startX, start) => {
			const inline = inlineWith(direction, before, label, after);
			const endX = startX === LEFT_HALF_X ? RIGHT_HALF_X : LEFT_HALF_X;
			expect(getInlineAtomPointerOffset(inline, startX, 10)).toBe(start);
			expect(getInlineAtomPointerOffset(inline, endX, 10)).toBe(start + 1);
			inline.remove();
		},
	);
});

/**
 * T5: an atom's own shift-click handler writes only when the selection's
 * anchor is in the atom's block. Anchored anywhere else — a text caret, a
 * block selection, a cell selection — it steps aside so the content
 * gestures extend from that anchor to the pointer, as vanilla and Vue do.
 */
async function seedAtomAndOtherBlock(): Promise<{ editor: Editor; atomBlockId: string }> {
	const editor = createEditor({
		schema: defaultSchema,
		preset: { resolve: () => ({ extensions: [] }) },
	});
	await editor.whenReady();
	const atomBlockId = editor.firstBlock()!.id;
	editor.apply(
		[
			{ type: "splice-text", blockId: atomBlockId, from: 0, to: 0, insert: "Hello  world" },
			{
				type: "splice-text",
				blockId: atomBlockId,
				from: 6,
				to: 6,
				insert: { nodeType: "mention", props: { id: "user-ada", label: "Ada" } },
			},
			{ type: "insert-block", blockId: "other", blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: "other", from: 0, to: 0, insert: "ends" },
		],
		{ origin: "user" },
	);
	return { editor, atomBlockId };
}

function shiftClick(editor: Editor, blockId: string): boolean {
	return selectInlineAtomRangeFromShiftClick({
		element: document.createElement("span"),
		editor,
		blockId,
		offset: 6,
		type: "mention",
		text: "@Ada",
		props: { id: "user-ada", label: "Ada" },
		selected: false,
		interactions: {} as InlineAtomWrapperInteractionOptions["interactions"],
		readonly: false,
	});
}

describe("selectInlineAtomRangeFromShiftClick (T5)", () => {
	it.each<[string, (editor: Editor, atomBlockId: string) => void, boolean, (atomBlockId: string) => object]>([
		[
			"steps aside for a text anchor in another block",
			(editor) => editor.selectText("other", 2, 2),
			false,
			() => ({ type: "text", anchor: { blockId: "other", offset: 2 } }),
		],
		[
			"steps aside for a block selection anchored in another block",
			(editor) => editor.selectBlock("other"),
			false,
			() => ({ type: "block", blockIds: ["other"] }),
		],
		[
			"selects the atom for a text anchor in its own block",
			(editor, atomBlockId) => editor.selectText(atomBlockId, 2, 2),
			true,
			(blockId) => ({
				type: "text",
				anchor: { blockId, offset: 2 },
				focus: { blockId, offset: 7 },
			}),
		],
		[
			"selects the atom with no selection to extend from",
			(editor) => editor.setSelection(null),
			true,
			(blockId) => ({
				type: "text",
				anchor: { blockId, offset: 6 },
				focus: { blockId, offset: 7 },
			}),
		],
	])("T5: %s", async (_name, select, handled, expected) => {
		const { editor, atomBlockId } = await seedAtomAndOtherBlock();
		select(editor, atomBlockId);
		expect(shiftClick(editor, atomBlockId)).toBe(handled);
		expect(editor.selection).toMatchObject(expected(atomBlockId));
	});
});
