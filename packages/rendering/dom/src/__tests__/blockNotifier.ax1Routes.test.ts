import {
	applyMergeBlocks,
	createEditor,
	getListItemSemantics,
	getListSegments,
	getNumberedListItemValue,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { createBlockNotifier } from "../field-editor/blockNotifier";
import type { BlockNotifier } from "../field-editor/blockNotifierTypes";
import { getRootBlockIds } from "../utils/parentIdTree";

const PARENT_ID_CONTAINERS = ["bq", "bq2"] as const;
const ARRAY_CONTAINER = "tg";
const PARENTS = [null, ...PARENT_ID_CONTAINERS, ARRAY_CONTAINER] as const;
const ITEM_TYPES = ["bulletListItem", "numberedListItem", "paragraph"] as const;

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

/**
 * A root bullet list, two blockquotes holding bullets through `parentId`, and
 * a toggle holding bullets in its `children` array.
 */
function createRoutedEditor(): Editor {
	const editor = createEditor({ schema: defaultSchema });
	const ops: DocumentOp[] = [
		{ type: "set-props", blockId: editor.firstBlock()!.id, props: { type: "bulletListItem" } },
	];
	for (const parent of PARENT_ID_CONTAINERS) {
		ops.push({ type: "insert-block", blockId: parent, blockType: "blockquote", props: {}, position: "last" });
		let previous: string = parent;
		for (const name of ["a", "b", "c"]) {
			const blockId = `${parent}-${name}`;
			ops.push({
				type: "insert-block",
				blockId,
				blockType: "bulletListItem",
				props: { parentId: parent },
				position: { after: previous },
			});
			previous = blockId;
		}
	}
	ops.push({ type: "insert-block", blockId: ARRAY_CONTAINER, blockType: "toggle", props: { open: true }, position: "last" });
	["a", "b", "c"].forEach((name, index) => {
		ops.push({
			type: "insert-block",
			blockId: `${ARRAY_CONTAINER}-${name}`,
			blockType: "bulletListItem",
			props: {},
			position: { parent: ARRAY_CONTAINER, index },
		});
	});
	ops.push({ type: "insert-block", blockId: "root-b", blockType: "bulletListItem", props: {}, position: "last" });
	editor.apply(ops, { origin: "system" });
	return editor;
}

function blockIds(editor: Editor): string[] {
	return [...editor.internals.doc.blocks.keys()].sort();
}

function siblingsOf(editor: Editor, parentId: string | null): readonly string[] {
	return parentId === null ? getRootBlockIds(editor) : editor.documentState.childrenOf(parentId);
}

/** Subscribes every list channel and every block, as a mounted surface does. */
function attach(editor: Editor, notifier: BlockNotifier) {
	const subscribed = new Set<string>();
	const unsubscribes = PARENTS.map((parentId) => notifier.subscribeListSegments(parentId, () => {}));
	const subscribeNew = () => {
		for (const id of blockIds(editor)) {
			if (subscribed.has(id)) continue;
			subscribed.add(id);
			unsubscribes.push(notifier.subscribeBlock(id, () => {}));
		}
	};
	subscribeNew();
	return { subscribeNew, detach: () => unsubscribes.forEach((unsubscribe) => unsubscribe()) };
}

/** The notifier's incrementally kept segments and semantics equal a full recompute. */
function expectListStateCurrent(editor: Editor, notifier: BlockNotifier, step: string): void {
	for (const parentId of PARENTS) {
		// A deleted container unmounts with its sibling list.
		if (parentId !== null && editor.getBlock(parentId) === null) continue;
		const siblings = siblingsOf(editor, parentId);
		expect(notifier.getListSegments(parentId), `${step} segments ${parentId}`).toEqual(
			getListSegments(editor, siblings),
		);
	}
	// Only rendered blocks: a deleted toggle's array children stay stored but
	// sit in no sibling list.
	for (const id of editor.documentState.preorderBlockIds()) {
		const list = notifier.getBlockSnapshot(id).list;
		const siblings = siblingsOf(editor, editor.documentState.parentOf(id));
		const expected = getListItemSemantics(editor, siblings).get(id);
		if (expected === undefined) {
			if (list !== null) expect(list.posinset, `${step} ${id} posinset`).toBe(1);
			continue;
		}
		const { level, posinset, setsize, groupKey } = list ?? ({} as Record<string, unknown>);
		expect({ level, posinset, setsize, groupKey }, `${step} ${id} semantics`).toEqual(expected);
		expect(notifier.getBlockSnapshot(id).childIds, `${step} ${id} childIds`).toEqual([
			...editor.documentState.childrenOf(id),
		]);
	}
}

function randomOp(editor: Editor, random: () => number, step: number): DocumentOp {
	const ids = blockIds(editor);
	const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
	const blockId = `n${step}`;
	const blockType = pick(ITEM_TYPES);
	const roll = random();
	if (roll < 0.25) {
		const parent = pick(PARENT_ID_CONTAINERS);
		const siblings = editor.documentState.childrenOf(parent);
		return {
			type: "insert-block",
			blockId,
			blockType,
			props: { parentId: parent, indent: Math.floor(random() * 2) },
			position: { after: siblings.length > 0 && random() < 0.8 ? pick(siblings) : parent },
		};
	}
	if (roll < 0.35) {
		const children = editor.documentState.childrenOf(ARRAY_CONTAINER);
		return {
			type: "insert-block",
			blockId,
			blockType,
			props: {},
			position: { parent: ARRAY_CONTAINER, index: Math.floor(random() * (children.length + 1)) },
		};
	}
	if (roll < 0.42) {
		return { type: "insert-block", blockId, blockType, props: {}, position: { after: pick(ids) } };
	}
	if (roll < 0.62) {
		// Mostly deletes inside a container, the case root-only walks miss.
		const parent = pick(PARENT_ID_CONTAINERS);
		const siblings = editor.documentState.childrenOf(parent);
		return { type: "delete-block", blockId: siblings.length > 0 && random() < 0.8 ? pick(siblings) : pick(ids) };
	}
	if (roll < 0.75) {
		const parent = pick(PARENT_ID_CONTAINERS);
		const siblings = editor.documentState.childrenOf(parent);
		const moved = siblings.length > 0 && random() < 0.7 ? pick(siblings) : pick(ids);
		const anchor = pick(ids);
		return { type: "move-block", blockId: moved, position: random() < 0.5 ? { after: anchor } : { before: anchor } };
	}
	if (roll < 0.8) {
		const children = editor.documentState.childrenOf(ARRAY_CONTAINER);
		// A `parentId` child moved into an array would sit on both routes,
		// which RI6 leaves undefined; only blocks without one are adopted.
		const unparented = ids.filter((id) => editor.getBlock(id)?.props.parentId == null);
		const moved = children.length > 0 && random() < 0.8 ? pick(children) : pick(unparented);
		const index = Math.floor(random() * (children.length + 1));
		return { type: "move-block", blockId: moved, position: { parent: ARRAY_CONTAINER, index } };
	}
	if (roll < 0.87) {
		return { type: "set-props", blockId: pick(ids), props: { indent: Math.floor(random() * 3) } };
	}
	if (roll < 0.94) {
		return { type: "set-props", blockId: pick(ids), props: { type: pick(ITEM_TYPES) } };
	}
	// A children-array child keeps its array parent; giving it a `parentId`
	// too is a second route the index does not define.
	const nested = new Set(editor.documentState.childrenOf(ARRAY_CONTAINER));
	const adoptable = ids.filter((id) => !nested.has(id));
	return {
		type: "set-props",
		blockId: pick(adoptable),
		props: { parentId: random() < 0.7 ? pick(PARENT_ID_CONTAINERS) : null },
	};
}

describe("block notifier (AX1 list semantics on every child route)", () => {
	it("AX1: deleting a parentId child re-segments its container and renumbers its siblings", () => {
		const editor = createRoutedEditor();
		const notifier = createBlockNotifier(editor);
		const surface = attach(editor, notifier);
		expect(notifier.getListSegments("bq")).toEqual([expect.objectContaining({ kind: "list", blockIds: ["bq-a", "bq-b", "bq-c"] })]);
		expect(notifier.getBlockSnapshot("bq-b").list).toMatchObject({ posinset: 2, setsize: 3 });

		editor.apply([{ type: "delete-block", blockId: "bq-a" }], { origin: "user" });

		expect(notifier.getListSegments("bq")).toEqual([expect.objectContaining({ kind: "list", blockIds: ["bq-b", "bq-c"] })]);
		expect(notifier.getBlockSnapshot("bq-b").list).toMatchObject({ posinset: 1, setsize: 2 });
		expect(notifier.getBlockSnapshot("bq-c").list).toMatchObject({ posinset: 2, setsize: 2 });
		expectListStateCurrent(editor, notifier, "after delete");
		surface.detach();
		editor.destroy();
	});

	it("AX1: merging a parentId child into a root block re-segments the container it left", () => {
		const editor = createRoutedEditor();
		const notifier = createBlockNotifier(editor);
		const surface = attach(editor, notifier);
		const rootId = editor.firstBlock()!.id;

		applyMergeBlocks(editor, { targetBlockId: rootId, sourceBlockId: "bq-a", applyOptions: { origin: "user" } });

		expect(editor.getBlock("bq-a")).toBeNull();
		expect(notifier.getListSegments("bq")).toEqual([expect.objectContaining({ kind: "list", blockIds: ["bq-b", "bq-c"] })]);
		expectListStateCurrent(editor, notifier, "after merge");
		surface.detach();
		editor.destroy();
	});

	it("AX1: merging a parentId numbered item into a block outside the root order keeps the root run's ordinals", () => {
		const editor = createEditor({ schema: defaultSchema });
		editor.apply(
			[
				{ type: "insert-block", blockId: "tg", blockType: "toggle", props: { open: true }, position: "last" },
				{ type: "insert-block", blockId: "tg-a", blockType: "paragraph", props: {}, position: { parent: "tg", index: 0 } },
				{ type: "insert-block", blockId: "bq", blockType: "blockquote", props: {}, position: "last" },
				{ type: "insert-block", blockId: "n1", blockType: "numberedListItem", props: { parentId: "bq" }, position: "last" },
				{ type: "insert-block", blockId: "n2", blockType: "numberedListItem", props: {}, position: "last" },
				{ type: "insert-block", blockId: "n3", blockType: "numberedListItem", props: {}, position: "last" },
				{ type: "insert-block", blockId: "tail", blockType: "paragraph", props: {}, position: "last" },
			],
			{ origin: "system" },
		);
		const notifier = createBlockNotifier(editor);
		const surface = attach(editor, notifier);
		// Ordinals count over AX1 sibling lists: n1 renders inside bq, so the
		// root run starts at n2.
		expect(notifier.getBlockSnapshot("n1").list?.ordinal).toBe(1);
		expect(notifier.getBlockSnapshot("n2").list?.ordinal).toBe(1);

		applyMergeBlocks(editor, { targetBlockId: "tg-a", sourceBlockId: "n1", applyOptions: { origin: "user" } });

		expect(editor.getBlock("n1")).toBeNull();
		expect(notifier.getBlockSnapshot("n2").list?.ordinal).toBe(1);
		expect(notifier.getBlockSnapshot("n3").list?.ordinal).toBe(2);
		surface.detach();
		editor.destroy();
	});

	it("AX1: a container-only segment subscription follows parentId-route removals, re-parents and merges", () => {
		const cases: { name: string; ops: (editor: Editor) => void }[] = [
			{
				name: "delete a parentId child",
				ops: (editor) => editor.apply([{ type: "delete-block", blockId: "bq-b" }], { origin: "user" }),
			},
			{
				name: "re-parent a child to the root",
				ops: (editor) =>
					editor.apply([{ type: "set-props", blockId: "bq-b", props: { parentId: null } }], { origin: "user" }),
			},
			{
				name: "merge a child into the previous one",
				ops: (editor) =>
					applyMergeBlocks(editor, { targetBlockId: "bq-a", sourceBlockId: "bq-b", applyOptions: { origin: "user" } }),
			},
			{
				name: "merge a child into a block in another container",
				ops: (editor) =>
					applyMergeBlocks(editor, { targetBlockId: "bq2-c", sourceBlockId: "bq-b", applyOptions: { origin: "user" } }),
			},
		];
		for (const { name, ops } of cases) {
			const editor = createRoutedEditor();
			const notifier = createBlockNotifier(editor);
			// Only the container's segment channel: no block of it is subscribed.
			const unsubscribe = notifier.subscribeListSegments("bq", () => {});
			expect(notifier.getListSegments("bq"), `${name} before`).toEqual(getListSegments(editor, siblingsOf(editor, "bq")));
			ops(editor);
			expect(editor.documentState.childrenOf("bq"), name).not.toContain("bq-b");
			expect(notifier.getListSegments("bq"), name).toEqual(getListSegments(editor, siblingsOf(editor, "bq")));
			unsubscribe();
			editor.destroy();
		}
	});

	it("AX1: a sibling's slice follows a parentId-route child that left unread (virtualized siblings)", () => {
		for (const leave of ["delete", "re-parent"] as const) {
			const editor = createRoutedEditor();
			const notifier = createBlockNotifier(editor);
			// Only bq-a is mounted: neither the container nor bq-b is read.
			const unsubscribe = notifier.subscribeBlock("bq-a", () => {});
			expect(notifier.getBlockSnapshot("bq-a").list?.setsize, leave).toBe(3);
			editor.apply(
				leave === "delete"
					? [{ type: "delete-block", blockId: "bq-b" }]
					: [{ type: "set-props", blockId: "bq-b", props: { parentId: null } }],
				{ origin: "user" },
			);
			expect(editor.documentState.childrenOf("bq"), leave).toEqual(["bq-a", "bq-c"]);
			expect(notifier.getBlockSnapshot("bq-a").list?.setsize, leave).toBe(2);
			unsubscribe();
			editor.destroy();
		}
	});

	it("AX1: a numbered item's ordinal counts over the sibling list its posinset does", () => {
		const editor = createEditor({ schema: defaultSchema });
		const first = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "set-props", blockId: first, props: { type: "numberedListItem" } },
				{ type: "insert-block", blockId: "bq", blockType: "blockquote", props: {}, position: "last" },
				{ type: "insert-block", blockId: "c1", blockType: "numberedListItem", props: { parentId: "bq" }, position: "last" },
				{ type: "insert-block", blockId: "c2", blockType: "numberedListItem", props: { parentId: "bq" }, position: "last" },
				{ type: "insert-block", blockId: "n2", blockType: "numberedListItem", props: {}, position: "last" },
				{ type: "insert-block", blockId: "tg", blockType: "toggle", props: { open: true }, position: "last" },
				{ type: "insert-block", blockId: "t1", blockType: "numberedListItem", props: {}, position: { parent: "tg", index: 0 } },
				{ type: "insert-block", blockId: "t2", blockType: "numberedListItem", props: {}, position: { parent: "tg", index: 1 } },
			],
			{ origin: "system" },
		);
		expect(editor.documentState.blockOrder.slice(0, 5)).toEqual([first, "bq", "c1", "c2", "n2"]);
		const notifier = createBlockNotifier(editor);
		const surface = attach(editor, notifier);
		const view = (id: string) => {
			const list = notifier.getBlockSnapshot(id).list;
			return [list?.ordinal, list?.posinset, list?.setsize];
		};
		expect(view(first)).toEqual([1, 1, 1]);
		expect(view("c1")).toEqual([1, 1, 2]);
		expect(view("c2")).toEqual([2, 2, 2]);
		expect(view("n2"), "the blockquote ends the root run").toEqual([1, 1, 1]);
		expect(view("t1")).toEqual([1, 1, 2]);
		expect(view("t2")).toEqual([2, 2, 2]);
		expect(getNumberedListItemValue(editor.getBlock("n2"))).toBe(1);
		expect(getNumberedListItemValue(editor.getBlock("c2"))).toBe(2);
		surface.detach();
		editor.destroy();
	});

	it("AX1: segments and semantics equal a full recompute over random edits on the parentId route", () => {
		for (let seed = 1; seed <= 150; seed += 1) {
			const editor = createRoutedEditor();
			const notifier = createBlockNotifier(editor);
			const surface = attach(editor, notifier);
			expectListStateCurrent(editor, notifier, `seed ${seed} setup`);
			const random = mulberry32(seed);
			for (let step = 0; step < 25; step += 1) {
				const op = randomOp(editor, random, step);
				editor.apply([op], { origin: "user" });
				surface.subscribeNew();
				expectListStateCurrent(editor, notifier, `seed ${seed} step ${step} ${JSON.stringify(op)}`);
			}
			surface.detach();
			editor.destroy();
		}
	}, 60_000);
});
