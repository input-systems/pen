import {
	createEditor,
	getListItemSemantics,
	getListSegments,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { createBlockNotifier } from "../../field-editor/blockNotifier";
import type { BlockNotifier } from "../../field-editor/blockNotifierTypes";
import { getRootBlockIds } from "../../utils/parentIdTree";
import { createListSemanticsStore } from "../listSemantics";

type Spec = readonly [type: string, indent?: number];

/** Root blocks b0…bn-1 with the given types; b0 reuses the editor's first block. */
function createDocument(specs: readonly Spec[]): Editor {
	const editor = createEditor({ schema: defaultSchema });
	const first = editor.firstBlock()!.id;
	const ops: DocumentOp[] = [];
	specs.forEach(([type, indent], index) => {
		const props = indent === undefined ? {} : { indent };
		if (index === 0) {
			ops.push({ type: "set-props", blockId: first, props: { type, ...props } });
			return;
		}
		ops.push({ type: "insert-block", blockId: `b${index}`, blockType: type, props, position: "last" });
	});
	editor.apply(ops, { origin: "system" });
	return editor;
}

/** Subscribes every block and the root segments, recording what was notified. */
function observe(editor: Editor, notifier: BlockNotifier) {
	const blocks: string[] = [];
	let segments = 0;
	const unsubscribes = [
		...editor.documentState.blockOrder.map((id) => notifier.subscribeBlock(id, () => blocks.push(id))),
		notifier.subscribeListSegments(null, () => {
			segments += 1;
		}),
	];
	// Root segments are cached from here on, so the next commit patches them.
	notifier.getListSegments(null);
	return {
		get blocks() {
			return [...blocks].sort();
		},
		get segments() {
			return segments;
		},
		reset() {
			blocks.splice(0);
			segments = 0;
		},
		dispose: () => unsubscribes.forEach((unsubscribe) => unsubscribe()),
	};
}

/** The notifier's view equals core's whole-list computation over the live root list. */
function expectMatchesCore(editor: Editor, notifier: BlockNotifier): void {
	const rootIds = getRootBlockIds(editor);
	expect(notifier.getListSegments(null)).toEqual(getListSegments(editor, rootIds));
	const semantics = getListItemSemantics(editor, rootIds);
	for (const id of rootIds) {
		const slice = notifier.getBlockSnapshot(id).list;
		const expected = semantics.get(id) ?? null;
		expect(slice ? { level: slice.level, posinset: slice.posinset, setsize: slice.setsize, groupKey: slice.groupKey } : null).toEqual(expected);
	}
}

const BULLET = "bulletListItem";
const NUMBERED = "numberedListItem";

describe("list semantics store (AX1)", () => {
	it("AX1: typing in a list item produces zero list-semantics notifications", () => {
		const editor = createDocument([["paragraph"], [BULLET], [BULLET], [BULLET], ["paragraph"]]);
		const notifier = createBlockNotifier(editor);
		const store = createListSemanticsStore(notifier);
		const probe = observe(editor, notifier);
		const before = store.getItem("b2");
		editor.apply([{ type: "splice-text", blockId: "b2", from: 0, to: 0, insert: "x" }], { origin: "user" });
		// The typed block hears its own text change; its list slice keeps identity.
		expect(probe.blocks).toEqual(["b2"]);
		expect(probe.segments).toBe(0);
		expect(store.getItem("b2")).toBe(before);
		probe.dispose();
		editor.destroy();
	});

	it("AX1: inserting a list item notifies only items whose position or set size changed and the parent's segments", () => {
		const editor = createDocument([
			["paragraph"],
			[BULLET],
			[BULLET],
			[BULLET],
			["paragraph"],
			[BULLET],
			[BULLET],
		]);
		const notifier = createBlockNotifier(editor);
		const store = createListSemanticsStore(notifier);
		const probe = observe(editor, notifier);
		editor.apply(
			[{ type: "insert-block", blockId: "n", blockType: BULLET, props: {}, position: { after: "b1" } }],
			{ origin: "user" },
		);
		// b1 (set size), b2 and b3 (position and set size) sit outside affectedBlockIds;
		// the run after the paragraph is untouched.
		expect(probe.blocks).toEqual(["b1", "b2", "b3"]);
		expect(probe.segments).toBe(1);
		expect(store.getItem("b3")).toMatchObject({ level: 1, posinset: 4, setsize: 4, groupKey: "b1" });
		expect(store.getItem("b5")).toMatchObject({ posinset: 1, setsize: 2, groupKey: "b5" });
		expect(store.getSegments(null)).toEqual([
			{ kind: "block", blockId: editor.firstBlock()!.id },
			{ kind: "list", key: "b1", blockIds: ["b1", "n", "b2", "b3"] },
			{ kind: "block", blockId: "b4" },
			{ kind: "list", key: "b5", blockIds: ["b5", "b6"] },
		]);
		probe.dispose();
		editor.destroy();
	});

	it("AX1: converting the paragraph between two runs merges their groups", () => {
		const editor = createDocument([[BULLET], [BULLET], ["paragraph"], [BULLET]]);
		const notifier = createBlockNotifier(editor);
		const probe = observe(editor, notifier);
		editor.apply([{ type: "set-props", blockId: "b2", props: { type: BULLET } }], { origin: "user" });
		const first = editor.firstBlock()!.id;
		expect(notifier.getListSegments(null)).toEqual([
			{ kind: "list", key: first, blockIds: [first, "b1", "b2", "b3"] },
		]);
		expect(probe.blocks).toEqual([first, "b1", "b2", "b3"].sort());
		expectMatchesCore(editor, notifier);
		probe.dispose();
		editor.destroy();
	});

	it("AX1: patched segments and slices equal the core helpers across structural edits", () => {
		const types = [BULLET, NUMBERED, "paragraph", "checkListItem"] as const;
		const specs: Spec[] = Array.from({ length: 24 }, (_, index) => [
			types[(index * 7) % types.length] as string,
			(index * 5) % 3,
		]);
		for (const initialSeed of [7, 11, 23, 101]) {
			const editor = createDocument(specs);
			const notifier = createBlockNotifier(editor);
			const probe = observe(editor, notifier);
			let seed = initialSeed;
			const next = (bound: number) => {
				seed = (seed * 48271) % 2147483647;
				return seed % bound;
			};
			const randomOp = (step: number, part: number): DocumentOp => {
				const rootIds = getRootBlockIds(editor);
				const target = rootIds[next(rootIds.length)] as string;
				const other = rootIds[next(rootIds.length)] as string;
				switch (next(5)) {
					case 0:
						return { type: "insert-block", blockId: `x${step}-${part}`, blockType: types[next(types.length)] as string, props: { indent: next(3) }, position: { after: target } };
					case 1:
						return rootIds.length > 4 ? { type: "delete-block", blockId: target } : { type: "set-props", blockId: target, props: { indent: next(3) } };
					case 2:
						return { type: "set-props", blockId: target, props: { type: types[next(types.length)] as string } };
					case 3:
						return target === other ? { type: "set-props", blockId: target, props: { indent: 0 } } : { type: "move-block", blockId: target, position: { after: other } };
					default:
						return { type: "set-props", blockId: target, props: { indent: next(3) } };
				}
			};
			for (let step = 0; step < 60; step += 1) {
				// One op, or a batch of two that touches two places in one commit.
				const ops = Array.from({ length: 1 + next(2) }, (_, part) => randomOp(step, part));
				editor.apply(ops, { origin: "user" });
				expectMatchesCore(editor, notifier);
			}
			probe.dispose();
			editor.destroy();
		}
	});
});
