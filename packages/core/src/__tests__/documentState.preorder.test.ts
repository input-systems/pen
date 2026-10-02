import type { Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { documentPreorderBlockIdsFromDoc } from "../editor/documentPreorder";
import { createNestedEditor, mulberry32, randomOp } from "./fixtures/structuralEdits";

function expectPreorderCurrent(editor: Editor, step: string): void {
	const walked = [...editor.documentState.allBlocks()].map((block) => block.id);
	const preorder = editor.documentState.preorderBlockIds();
	expect(preorder, step).toEqual(walked);
	expect(preorder, step).toEqual(documentPreorderBlockIdsFromDoc(editor.internals.doc));
	walked.forEach((id, index) => {
		expect(editor.documentState.preorderIndexOf(id), `${step} ${id}`).toBe(index);
	});
	expect(editor.documentState.preorderIndexOf("missing")).toBe(-1);
	// The incrementally kept parent and child indexes equal a fresh rebuild.
	const snapshot = () =>
		walked.map((id) => [id, editor.documentState.parentOf(id), [...editor.documentState.childrenOf(id)]]);
	const incremental = snapshot();
	(editor.documentState as unknown as { rebuild(): void }).rebuild();
	expect(snapshot(), `${step} indexes`).toEqual(incremental);
}

describe("DocumentState preorder index", () => {
	it("SCALE2: preorder index matches allBlocks order after every structural edit", () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const editor = createNestedEditor();
			expectPreorderCurrent(editor, `seed ${seed} setup`);
			const random = mulberry32(seed);
			for (let step = 0; step < 60; step += 1) {
				const op = randomOp(editor, random, step);
				const before = editor.documentState.preorderBlockIds();
				editor.apply([op]);
				if (op.type === "splice-text" && editor.documentState.childrenOf(op.blockId).length === 0) {
					// Identity-stable across a leaf's text edit. A container's own
					// edit conservatively drops the cache.
					expect(editor.documentState.preorderBlockIds()).toBe(before);
				}
				expectPreorderCurrent(editor, `seed ${seed} step ${step} ${op.type}`);
			}
			editor.destroy();
		}
	});
});
