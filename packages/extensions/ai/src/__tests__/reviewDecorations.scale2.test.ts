import { applyMergeBlocks, applySplitBlock, createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { createScanProbe } from "@input/pen-test";
import { toolsExtension } from "@input/pen-tools";
import type { Decoration, Editor } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { describe, expect, it } from "vitest";

import {
	acceptSuggestion,
	aiExtension,
	getAIController,
	rejectSuggestion,
} from "../index";
import { collectSuggestionDecorations } from "../review/suggestionDecorations";
import { deltaStreamExtension } from "../stream";
import { readAllSuggestions } from "../suggestions/persistent";

function createReviewEditor(blockCount: number): Editor {
	const editor = createEditor({
		schema: defaultSchema,
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({ suggestMode: false }),
		],
	});
	const first = editor.firstBlock()!.id;
	editor.apply(
		[
			{ type: "splice-text", blockId: first, from: 0, to: 0, insert: "Block 0 text." },
			...Array.from({ length: blockCount - 1 }, (_, index) => [
				{
					type: "insert-block" as const,
					blockId: `b${index + 1}`,
					blockType: "paragraph",
					props: {},
					position: "last" as const,
				},
				{
					type: "splice-text" as const,
					blockId: `b${index + 1}`,
					from: 0,
					to: 0,
					insert: `Block ${index + 1} text.`,
				},
			]).flat(),
		],
		{ origin: "system" },
	);
	return editor;
}

function setSuggestMode(editor: Editor, on: boolean): void {
	getAIController(editor)?.setSuggestMode(on);
}

function stageSuggestion(editor: Editor, blockId: string): void {
	setSuggestMode(editor, true);
	const at = editor.getBlock(blockId)!.textContent().length;
	editor.apply([{ type: "splice-text", blockId, from: at, to: at, insert: " suggested" }], {
		origin: { type: "ai" },
	});
	setSuggestMode(editor, false);
}

function type(editor: Editor, blockId: string): void {
	editor.apply([{ type: "splice-text", blockId, from: 0, to: 0, insert: "x" }], { origin: "user" });
}

/** Suggestion decorations per block, as the editor holds them. */
function reviewDecorationsByBlock(editor: Editor): Map<string, Decoration[]> {
	const byBlock = new Map<string, Decoration[]>();
	for (const id of editor.documentState.preorderBlockIds()) {
		const list = editor
			.getDecorations()
			.forBlock(id)
			.filter(
				(decoration) =>
					decoration.type !== "app" && "data-suggestion-id" in decoration.attributes,
			);
		if (list.length > 0) byBlock.set(id, [...list]);
	}
	return byBlock;
}

/** The same, from a fresh walk of every block. */
function fullRecomputeByBlock(editor: Editor): Map<string, Decoration[]> {
	const byBlock = new Map<string, Decoration[]>();
	for (const decoration of collectSuggestionDecorations(editor, "track-changes").decorations) {
		const list = byBlock.get(decoration.blockId) ?? [];
		list.push(decoration);
		byBlock.set(decoration.blockId, list);
	}
	return byBlock;
}

function mulberry32(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Step = (editor: Editor, pick: () => string, random: () => number, step: number) => void;

const STEPS: readonly Step[] = [
	(editor, pick) => type(editor, pick()),
	(editor, pick) => {
		const blockId = pick();
		const length = editor.getBlock(blockId)!.textContent().length;
		if (length > 2) editor.apply([{ type: "splice-text", blockId, from: 0, to: 2, insert: "" }], { origin: "user" });
	},
	(editor, pick) => {
		const blockId = pick();
		const length = editor.getBlock(blockId)!.textContent().length;
		if (length > 3) editor.apply([{ type: "format-text", blockId, from: 1, to: 3, marks: { bold: true } }], { origin: "user" });
	},
	(editor, pick, _random, step) => {
		const blockId = pick();
		const length = editor.getBlock(blockId)!.textContent().length;
		applySplitBlock(editor, { blockId, offset: Math.floor(length / 2), newBlockId: `split-${step}` });
	},
	(editor, pick) => {
		const order = editor.documentState.preorderBlockIds();
		const source = pick();
		const index = order.indexOf(source);
		if (index > 0) applyMergeBlocks(editor, { targetBlockId: order[index - 1]!, sourceBlockId: source });
	},
	(editor, pick) => stageSuggestion(editor, pick()),
	(editor, _pick, random) => {
		const suggestions = readAllSuggestions(editor);
		const target = suggestions[Math.floor(random() * suggestions.length)];
		if (target) acceptSuggestion(editor, target.id);
	},
	(editor, _pick, random) => {
		const suggestions = readAllSuggestions(editor);
		const target = suggestions[Math.floor(random() * suggestions.length)];
		if (target) rejectSuggestion(editor, target.id);
	},
];

describe("SCALE2 scoped AI review decorations", () => {
	it("SCALE2: a keystroke re-reads suggestions on the affected block only", () => {
		const measure = (blockCount: number) => {
			const editor = createReviewEditor(blockCount);
			const stride = Math.floor(blockCount / 9);
			for (let k = 1; k <= 8; k += 1) stageSuggestion(editor, `b${k * stride}`);
			const target = `b${Math.floor(blockCount / 2) + 1}`;
			type(editor, target);
			const probe = createScanProbe(editor);
			try {
				probe.reset();
				type(editor, target);
				return probe.snapshot();
			} finally {
				probe.dispose();
				editor.destroy();
			}
		};
		const small = measure(100);
		expect(measure(1_000)).toEqual(small);
		expect(small.documentWalks).toBe(0);
		// Core reads the block once; the review index and the suggestion list
		// each re-read that one block.
		expect(small.textFullReads).toBe(3);
	});

	it("SCALE2: scoped review decorations equal a full recompute", () => {
		const editor = createReviewEditor(200);
		const random = mulberry32(7);
		const pick = () => {
			const ids = editor.documentState.preorderBlockIds();
			return ids[Math.floor(random() * ids.length)]!;
		};
		let stepsWithSuggestions = 0;
		for (let step = 0; step < 200; step += 1) {
			const run = STEPS[Math.floor(random() * STEPS.length)]!;
			run(editor, pick, random, step);
			expect(reviewDecorationsByBlock(editor), `step ${step}`).toEqual(fullRecomputeByBlock(editor));
			expect(getAIController(editor)?.getSuggestions(), `step ${step} list`).toEqual(
				readAllSuggestions(editor),
			);
			if (readAllSuggestions(editor).length > 0) stepsWithSuggestions += 1;
		}
		// The sequence must actually exercise staged suggestions.
		expect(stepsWithSuggestions).toBeGreaterThan(50);
		editor.destroy();
	});

	it("SCALE2: deleting a parent block drops the staged suggestions and decorations of its descendants", () => {
		const editor = createReviewEditor(2);
		editor.apply(
			[
				{ type: "insert-block", blockId: "t", blockType: "toggle", props: {}, position: "last" },
				{ type: "splice-text", blockId: "t", from: 0, to: 0, insert: "Toggle" },
				{
					type: "insert-block",
					blockId: "c",
					blockType: "paragraph",
					props: {},
					position: { parent: "t", index: 0 },
				},
				{ type: "splice-text", blockId: "c", from: 0, to: 0, insert: "Child" },
			],
			{ origin: "system" },
		);
		stageSuggestion(editor, "c");
		expect(getAIController(editor)?.getSuggestions()).toHaveLength(1);
		expect(reviewDecorationsByBlock(editor).has("c")).toBe(true);

		editor.apply([{ type: "delete-block", blockId: "t" }], { origin: "user" });

		expect(editor.documentState.preorderIndexOf("c")).toBe(-1);
		expect(getAIController(editor)?.getSuggestions()).toEqual([]);
		expect(editor.getDecorations().forBlock("c")).toEqual([]);
		expect(readAllSuggestions(editor)).toEqual([]);
		editor.destroy();
	});
});
