import { applyMergeBlocks, applySplitBlock, createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { createScanProbe } from "@input/pen-test";
import type { DocumentOp, Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { buildSearchDecorations } from "../decorations";
import { getSearchController, searchExtension } from "../index";
import { findDocumentMatches } from "../search";

const WORDS = ["alpha", "beta", "gamma", "delta"];

function createSearchEditor(blockCount: number, query: string): Editor {
	const editor = createEditor({ schema: defaultSchema, extensions: [searchExtension()] });
	const first = editor.firstBlock()!.id;
	const ops: DocumentOp[] = [
		{ type: "splice-text", blockId: first, from: 0, to: 0, insert: "alpha 0" },
	];
	for (let index = 1; index < blockCount; index += 1) {
		ops.push(
			{ type: "insert-block", blockId: `b${index}`, blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: `b${index}`, from: 0, to: 0, insert: `${WORDS[index % 4]} ${index}` },
		);
	}
	editor.apply(ops, { origin: "system" });
	const controller = getSearchController(editor)!;
	controller.open();
	controller.setQuery(query);
	return editor;
}

function type(editor: Editor, blockId: string, insert = "x"): void {
	editor.apply([{ type: "splice-text", blockId, from: 0, to: 0, insert }], { origin: "user" });
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

describe("SCALE2 scoped search", () => {
	it("SCALE2: an active query rescans only affected blocks", () => {
		const measure = (blockCount: number) => {
			const editor = createSearchEditor(blockCount, "for block 42");
			type(editor, "b7");
			const probe = createScanProbe(editor);
			try {
				probe.reset();
				type(editor, "b7");
				return probe.snapshot();
			} finally {
				probe.dispose();
				editor.destroy();
			}
		};
		const small = measure(100);
		expect(measure(1_000)).toEqual(small);
		expect(small.documentWalks).toBe(0);
	});

	it("SCALE2: matches stay in document order after a block moves", () => {
		const editor = createSearchEditor(20, "alpha");
		editor.apply([{ type: "move-block", blockId: "b16", position: "first" } as DocumentOp]);
		const controller = getSearchController(editor)!;
		expect(controller.getState().matches).toEqual(
			findDocumentMatches(editor, "alpha", controller.getState().options),
		);
		expect(controller.getState().matches[0]?.blockId).toBe("b16");
		editor.destroy();
	});

	// 200 seeded steps, each comparing every block's held decorations with a
	// full rebuild: ~0.5 s locally, past 10 s on the shared 4-vCPU CI runner.
	it("SCALE2: scoped search matches equal a full scan", { timeout: 30_000 }, () => {
		const editor = createSearchEditor(200, "a 1");
		const controller = getSearchController(editor)!;
		const random = mulberry32(11);
		const pick = () => {
			const ids = editor.documentState.preorderBlockIds();
			return ids[Math.floor(random() * ids.length)]!;
		};
		const steps: ((step: number) => void)[] = [
			() => type(editor, pick(), "a 1"),
			() => type(editor, pick(), "zz"),
			() => {
				const blockId = pick();
				if (editor.getBlock(blockId)!.textContent().length > 2) {
					editor.apply([{ type: "splice-text", blockId, from: 0, to: 2, insert: "" }], { origin: "user" });
				}
			},
			(step) => {
				const blockId = pick();
				const length = editor.getBlock(blockId)!.textContent().length;
				applySplitBlock(editor, { blockId, offset: Math.floor(length / 2), newBlockId: `s${step}` });
			},
			() => {
				const order = editor.documentState.preorderBlockIds();
				const source = pick();
				const index = order.indexOf(source);
				if (index > 0) applyMergeBlocks(editor, { targetBlockId: order[index - 1]!, sourceBlockId: source });
			},
			() => editor.apply([{ type: "move-block", blockId: pick(), position: { after: pick() } } as DocumentOp]),
			() => {
				const ids = editor.documentState.preorderBlockIds();
				if (ids.length > 1) editor.apply([{ type: "delete-block", blockId: pick() }]);
			},
			() => controller.next(),
		];
		for (let step = 0; step < 200; step += 1) {
			steps[Math.floor(random() * steps.length)]!(step);
			const state = controller.getState();
			expect(state.matches, `step ${step}`).toEqual(findDocumentMatches(editor, state.query, state.options));
			for (const blockId of editor.documentState.preorderBlockIds()) {
				const held = editor
					.getDecorations()
					.forBlock(blockId)
					.filter((decoration) => decoration.type !== "app" && "data-pen-search-match" in decoration.attributes);
				const full = buildSearchDecorations(state).filter((decoration) => decoration.blockId === blockId);
				expect(held, `step ${step} ${blockId}`).toEqual(full);
			}
		}
		expect(controller.getState().matches.length).toBeGreaterThan(0);
		editor.destroy();
	});

	it("SCALE2: deleting a parent block drops the matches inside its children", () => {
		const editor = createSearchEditor(2, "alpha");
		editor.apply(
			[
				{ type: "insert-block", blockId: "t", blockType: "toggle", props: {}, position: "last" },
				{
					type: "insert-block",
					blockId: "c",
					blockType: "paragraph",
					props: {},
					position: { parent: "t", index: 0 },
				},
				{ type: "splice-text", blockId: "c", from: 0, to: 0, insert: "alpha child" },
			],
			{ origin: "system" },
		);
		const controller = getSearchController(editor)!;
		expect(controller.getState().matches.map((match) => match.blockId)).toContain("c");

		editor.apply([{ type: "delete-block", blockId: "t" }], { origin: "user" });

		expect(controller.getState().matches).toEqual(
			findDocumentMatches(editor, "alpha", controller.getState().options),
		);
		expect(controller.getState().matches.map((match) => match.blockId)).not.toContain("c");
		editor.destroy();
	});

	it("SCALE2: a commit naming a stored block no array reaches does not bring its matches back", () => {
		const editor = createSearchEditor(2, "alpha");
		editor.apply(
			[
				{
					type: "insert-block",
					blockId: "t",
					blockType: "toggle",
					props: {},
					position: "last",
				},
				{
					type: "insert-block",
					blockId: "c",
					blockType: "paragraph",
					props: {},
					position: { parent: "t", index: 0 },
				},
				{
					type: "splice-text",
					blockId: "c",
					from: 0,
					to: 0,
					insert: "alpha child",
				},
			],
			{ origin: "system" },
		);
		// A peer's delete of `t` lands without `c`'s: `c` stays stored, and
		// no array reaches it (COL4) until a local pass re-homes it.
		const { adapter, crdtDoc, doc } = editor.internals;
		adapter.transact(crdtDoc, () => {
			(doc.blocks as unknown as { delete(key: string): void }).delete(
				"t",
			);
			const order = doc.blockOrder as unknown as {
				toArray(): string[];
				delete(index: number, length: number): void;
			};
			order.delete(order.toArray().indexOf("t"), 1);
		});
		expect(editor.documentState.preorderIndexOf("c")).toBe(-1);
		const controller = getSearchController(editor)! as unknown as {
			recomputeForCommit(summary: unknown): void;
			getState(): ReturnType<
				NonNullable<ReturnType<typeof getSearchController>>["getState"]
			>;
		};

		// An undo or redo restoring `c`'s map names it again.
		controller.recomputeForCommit({
			commitId: 99,
			blockText: [],
			structural: [],
			affectedBlockIds: ["c"],
		});

		expect(controller.getState().matches).toEqual(
			findDocumentMatches(editor, "alpha", controller.getState().options),
		);
		expect(
			controller.getState().matches.map((match) => match.blockId),
		).not.toContain("c");
		editor.destroy();
	});
});
