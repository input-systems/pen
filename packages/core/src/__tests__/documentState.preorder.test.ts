import type { DocumentOp, Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { documentPreorderBlockIdsFromDoc } from "../editor/documentPreorder";
import { DocumentStateImpl } from "../editor/documentState";
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
				if (op.type === "splice-text") {
					// Identity-stable across a text edit, a container's own
					// included: only a `children` array edit moves it.
					expect(editor.documentState.preorderBlockIds()).toBe(before);
				}
				expectPreorderCurrent(editor, `seed ${seed} step ${step} ${op.type}`);
			}
			editor.destroy();
		}
	});
});

describe("DocumentState children-array edits", () => {
	it("SCALE2: a children-array edit advances the indexes and patches the preorder without a rebuild", () => {
		for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
			const editor = createNestedEditor();
			const state = editor.documentState as unknown as DocumentStateImpl;
			let rebuilds = 0;
			const rebuild = state.rebuild.bind(state);
			state.rebuild = () => {
				rebuilds += 1;
				rebuild();
			};
			const random = mulberry32(seed);
			for (let step = 0; step < 80; step += 1) {
				const ids = [...state.preorderBlockIds()];
				const parent = random() < 0.5 ? "cols" : "cols2";
				const index = Math.floor(random() * 3);
				// Half the steps edit inside an array: an insert, or a move of a
				// child between or within the two arrays.
				const nested = ids.filter((id) => state.parentOf(id) === "cols" || state.parentOf(id) === "cols2");
				const op: DocumentOp =
					random() < 0.5
						? randomOp(editor, random, step)
						: nested.length > 0 && random() < 0.5
							? { type: "move-block", blockId: nested[Math.floor(random() * nested.length)]!, position: { parent, index } }
							: { type: "insert-block", blockId: `n${step}`, blockType: "paragraph", props: {}, position: { parent, index } };
				const before = rebuilds;
				editor.apply([op]);
				if (op.type === "insert-block" && typeof op.position === "object" && "parent" in op.position) {
					expect(rebuilds, `seed ${seed} step ${step} array insert rebuilt`).toBe(before);
				}
				const fresh = new DocumentStateImpl(
					editor.internals.doc,
					editor.internals.crdtDoc,
					editor.schema,
					state.documentProfile,
				);
				const read = (source: DocumentStateImpl) => {
					const order = [...source.preorderBlockIds()];
					return {
						order,
						positions: order.map((id) => source.preorderIndexOf(id)),
						roots: [...source.rootBlockIds()],
						perBlock: order.map((id) => [id, source.parentOf(id), [...source.childrenOf(id)]]),
					};
				};
				expect(read(state), `seed ${seed} step ${step} ${JSON.stringify(op)}`).toEqual(read(fresh));
			}
			editor.destroy();
		}
	});
});
