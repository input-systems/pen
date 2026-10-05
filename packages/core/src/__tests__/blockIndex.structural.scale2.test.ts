import type { Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import type { BlockIndex } from "../changes/blockIndex";
import { createBlockIndexSnapshotFromDocument } from "../changes/fromDocument";
import { createNestedEditor, mulberry32, randomOp } from "./fixtures/structuralEdits";

function heldIndex(editor: Editor): ReturnType<BlockIndex["snapshot"]> {
	return (editor as unknown as { _blockIndex: BlockIndex })._blockIndex.snapshot();
}

describe("change-summary block index on structural commits", () => {
	it("SCALE2: the block index after a structural commit equals a fresh read of the document", () => {
		for (const seed of [21, 22, 23]) {
			const editor = createNestedEditor();
			const random = mulberry32(seed);
			for (let step = 0; step < 80; step += 1) {
				const roll = random();
				if (roll < 0.1) editor.undoManager.undo();
				else if (roll < 0.15) editor.undoManager.redo();
				else editor.apply([randomOp(editor, random, step)]);
				const fresh = createBlockIndexSnapshotFromDocument(editor.internals.doc);
				const held = heldIndex(editor);
				const label = `seed ${seed} step ${step}`;
				expect([...held.lengthById].sort(), label).toEqual([...fresh.lengthById].sort());
				expect(held.roots, label).toEqual(fresh.roots);
				expect([...held.typeById].sort(), label).toEqual([...fresh.typeById].sort());
				expect([...held.childrenByParentId].sort(), label).toEqual([...fresh.childrenByParentId].sort());
				expect([...held.parentById].sort(), label).toEqual([...fresh.parentById].sort());
			}
			editor.destroy();
		}
	});
});
