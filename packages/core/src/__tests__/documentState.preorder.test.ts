import type { DocumentOp, Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { documentPreorderBlockIdsFromDoc } from "../editor/documentPreorder";
import { createEditor as createCoreEditor } from "../index";
import { defineBlock } from "../schema/defineBlock";
import { createDefaultSchema } from "./fixtures/testSchema";

const columns = defineBlock("columns", {
	content: [],
	isContainer: true,
	layout: { modes: ["flex"], defaultMode: "flex", minChildren: 2 },
});

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

/** Small deterministic PRNG so a failure names its seed. */
function mulberry32(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

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

function randomOp(editor: Editor, random: () => number, step: number): DocumentOp {
	const ids = [...editor.documentState.preorderBlockIds()];
	const pick = () => ids[Math.floor(random() * ids.length)] as string;
	const roll = random();
	const blockId = `b${step}`;
	if (roll < 0.3) {
		return { type: "splice-text", blockId: pick(), from: 0, to: 0, insert: "x" };
	}
	if (roll < 0.5) {
		return {
			type: "insert-block",
			blockId,
			blockType: "paragraph",
			props: {},
			position: { after: pick() },
		};
	}
	if (roll < 0.65) {
		const parent = random() < 0.5 ? "cols" : "cols2";
		return {
			type: "insert-block",
			blockId,
			blockType: "paragraph",
			props: {},
			position: { parent, index: Math.floor(random() * 3) },
		};
	}
	if (roll < 0.85) {
		return { type: "move-block", blockId: pick(), position: { after: pick() } } as DocumentOp;
	}
	return { type: "delete-block", blockId: pick() };
}

describe("DocumentState preorder index", () => {
	it("SCALE2: preorder index matches allBlocks order after every structural edit", () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const editor = createCoreEditor({
				schema: createDefaultSchema().extend([columns]),
				preset: noDefaultExtensionsPreset,
			});
			const setup: DocumentOp[] = ["cols", "cols2"].flatMap((parent) => [
				{ type: "insert-block", blockId: parent, blockType: "columns", props: {}, position: "last" },
				{ type: "insert-block", blockId: `${parent}-a`, blockType: "paragraph", props: {}, position: { parent, index: 0 } },
				{ type: "insert-block", blockId: `${parent}-b`, blockType: "paragraph", props: {}, position: { parent, index: 1 } },
			]);
			editor.apply(setup);
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
