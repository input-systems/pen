import type { DocumentOp, Editor } from "@input/pen-types";

import { createEditor as createCoreEditor } from "../../index";
import { defineBlock } from "../../schema/defineBlock";
import { createDefaultSchema } from "./testSchema";

/** Seeded random structural and text edits over root and children-array blocks. */
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
export function mulberry32(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** An editor with two columns blocks, each holding two children-array paragraphs. */
export function createNestedEditor(): Editor {
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
	return editor;
}

export function randomOp(editor: Editor, random: () => number, step: number): DocumentOp {
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

