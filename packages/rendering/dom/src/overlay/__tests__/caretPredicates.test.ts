import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { isAtomAdjacentCaret, isEmptyTextBlock } from "../caretPredicates";

const MENTION = { nodeType: "mention", props: { id: "user-ada", label: "Ada" } };

function editorWith(ops: (blockId: string) => DocumentOp[]): {
	editor: Editor;
	blockId: string;
} {
	const editor = createEditor({ schema: defaultSchema });
	const blockId = editor.firstBlock()!.id;
	editor.apply(ops(blockId), { origin: "system" });
	return { editor, blockId };
}

function insert(blockId: string, at: number, value: string | typeof MENTION): DocumentOp {
	return { type: "splice-text", blockId, from: at, to: at, insert: value } as DocumentOp;
}

describe("caret predicates", () => {
	it("N1: atom adjacency holds at block start, block end, between two atoms, and after an atom in an RTL run", () => {
		const start = editorWith((id) => [insert(id, 0, " starts"), insert(id, 0, MENTION)]);
		const startBlock = start.editor.getBlock(start.blockId)!;
		expect(isAtomAdjacentCaret(startBlock, 0)).toBe(true);
		expect(isAtomAdjacentCaret(startBlock, 1)).toBe(true);
		expect(isAtomAdjacentCaret(startBlock, 3)).toBe(false);

		const end = editorWith((id) => [insert(id, 0, "ends "), insert(id, 5, MENTION)]);
		const endBlock = end.editor.getBlock(end.blockId)!;
		expect(isAtomAdjacentCaret(endBlock, 6)).toBe(true);
		expect(isAtomAdjacentCaret(endBlock, 5)).toBe(true);
		expect(isAtomAdjacentCaret(endBlock, 2)).toBe(false);

		const pair = editorWith((id) => [
			insert(id, 0, "x  y"),
			insert(id, 2, MENTION),
			insert(id, 3, MENTION),
		]);
		const pairBlock = pair.editor.getBlock(pair.blockId)!;
		expect(isAtomAdjacentCaret(pairBlock, 3)).toBe(true);
		expect(isAtomAdjacentCaret(pairBlock, 0)).toBe(false);

		const rtl = editorWith((id) => [insert(id, 0, "مرحبا  عالم"), insert(id, 6, MENTION)]);
		const rtlBlock = rtl.editor.getBlock(rtl.blockId)!;
		expect(isAtomAdjacentCaret(rtlBlock, 7)).toBe(true);
		expect(isAtomAdjacentCaret(rtlBlock, 1)).toBe(false);

		for (const fixture of [start, end, pair, rtl]) {
			fixture.editor.destroy();
		}
	});

	it("O2: an empty text block is empty; an atom-only block and a divider are not", () => {
		const empty = editorWith(() => []);
		expect(isEmptyTextBlock(empty.editor, empty.editor.getBlock(empty.blockId)!)).toBe(true);

		const atomOnly = editorWith((id) => [insert(id, 0, MENTION)]);
		expect(
			isEmptyTextBlock(atomOnly.editor, atomOnly.editor.getBlock(atomOnly.blockId)!),
		).toBe(false);

		const divider = editorWith((id) => [
			{ type: "insert-block", blockId: "d1", blockType: "divider", props: {}, position: { after: id } },
		]);
		expect(isEmptyTextBlock(divider.editor, divider.editor.getBlock("d1")!)).toBe(false);

		for (const fixture of [empty, atomOnly, divider]) {
			fixture.editor.destroy();
		}
	});
});
