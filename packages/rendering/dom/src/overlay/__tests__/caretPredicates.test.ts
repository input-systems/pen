import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp } from "@input/pen-types";
import { isAtomAdjacentCaret, isEmptyTextBlock } from "../caretPredicates";

const MENTION = { nodeType: "mention", props: { id: "user-ada", label: "Ada" } };

type Content = readonly (readonly [at: number, value: string | typeof MENTION])[];

/** Runs `check` against the first block after inserting `content` in order. */
function withBlock(
	content: Content,
	check: (editor: ReturnType<typeof createEditor>, blockId: string) => void,
	extra: (blockId: string) => DocumentOp[] = () => [],
): void {
	const editor = createEditor({ schema: defaultSchema });
	const blockId = editor.firstBlock()!.id;
	const ops = content.map(
		([at, insert]) => ({ type: "splice-text", blockId, from: at, to: at, insert }) as DocumentOp,
	);
	editor.apply([...ops, ...extra(blockId)], { origin: "system" });
	check(editor, blockId);
	editor.destroy();
}

describe("caret predicates", () => {
	it.each<[string, Content, number[], number[]]>([
		["block start", [[0, " starts"], [0, MENTION]], [0, 1], [3]],
		["block end", [[0, "ends "], [5, MENTION]], [6, 5], [2]],
		["between two atoms", [[0, "x  y"], [2, MENTION], [3, MENTION]], [3], [0]],
		["after an atom in an RTL run", [[0, "مرحبا  عالم"], [6, MENTION]], [7], [1]],
	])("N1: atom adjacency holds at %s", (_name, content, adjacent, apart) => {
		withBlock(content, (editor, blockId) => {
			const block = editor.getBlock(blockId)!;
			for (const offset of adjacent) {
				expect(isAtomAdjacentCaret(block, offset)).toBe(true);
			}
			for (const offset of apart) {
				expect(isAtomAdjacentCaret(block, offset)).toBe(false);
			}
		});
	});

	it("O2: an empty text block is empty; an atom-only block and a divider are not", () => {
		withBlock(
			[],
			(editor, blockId) => {
				expect(isEmptyTextBlock(editor, editor.getBlock(blockId)!)).toBe(true);
				expect(isEmptyTextBlock(editor, editor.getBlock("d1")!)).toBe(false);
			},
			(id) => [
				{ type: "insert-block", blockId: "d1", blockType: "divider", props: {}, position: { after: id } },
			],
		);
		withBlock([[0, MENTION]], (editor, blockId) => {
			expect(isEmptyTextBlock(editor, editor.getBlock(blockId)!)).toBe(false);
		});
	});
});
