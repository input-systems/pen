// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { defaultSchema } from "@input/pen-schema";
import { selectInlineAtomRangeFromShiftClick } from "../inlineAtomDestructure";
import type { InlineAtomWrapperInteractionOptions } from "../inlineAtomWrapperInteractions";

/**
 * T5: an atom's own shift-click handler writes only when the selection's
 * anchor is in the atom's block. Anchored anywhere else — a text caret, a
 * block selection, a cell selection — it steps aside so the content
 * gestures extend from that anchor to the pointer, as vanilla and Vue do.
 */

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

type Fixture = { editor: Editor; atomBlockId: string; otherBlockId: string };

async function seed(): Promise<Fixture> {
	const editor = createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
	});
	await editor.whenReady();
	const atomBlockId = editor.firstBlock()!.id;
	editor.apply(
		[
			{
				type: "splice-text",
				blockId: atomBlockId,
				from: 0,
				to: 0,
				insert: "Hello  world",
			},
			{
				type: "splice-text",
				blockId: atomBlockId,
				from: 6,
				to: 6,
				insert: {
					nodeType: "mention",
					props: { id: "user-ada", label: "Ada" },
				},
			},
			{
				type: "insert-block",
				blockId: "other",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "other",
				from: 0,
				to: 0,
				insert: "ends",
			},
		],
		{ origin: "user" },
	);
	return { editor, atomBlockId, otherBlockId: "other" };
}

function shiftClick(editor: Editor, blockId: string): boolean {
	const options: InlineAtomWrapperInteractionOptions = {
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
	};
	return selectInlineAtomRangeFromShiftClick(options);
}

describe("selectInlineAtomRangeFromShiftClick (T5)", () => {
	it("T5: steps aside for a text anchor in another block", async () => {
		const { editor, atomBlockId, otherBlockId } = await seed();
		editor.selectText(otherBlockId, 2, 2);
		expect(shiftClick(editor, atomBlockId)).toBe(false);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: otherBlockId, offset: 2 },
		});
	});

	it("T5: steps aside for a block selection anchored in another block", async () => {
		const { editor, atomBlockId, otherBlockId } = await seed();
		editor.selectBlock(otherBlockId);
		expect(shiftClick(editor, atomBlockId)).toBe(false);
		expect(editor.selection).toMatchObject({
			type: "block",
			blockIds: [otherBlockId],
		});
	});

	it("T5: selects the atom for a text anchor in its own block", async () => {
		const { editor, atomBlockId } = await seed();
		editor.selectText(atomBlockId, 2, 2);
		expect(shiftClick(editor, atomBlockId)).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: atomBlockId, offset: 2 },
			focus: { blockId: atomBlockId, offset: 7 },
		});
	});

	it("T5: selects the atom with no selection to extend from", async () => {
		const { editor, atomBlockId } = await seed();
		editor.setSelection(null);
		expect(shiftClick(editor, atomBlockId)).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: atomBlockId, offset: 6 },
			focus: { blockId: atomBlockId, offset: 7 },
		});
	});
});
