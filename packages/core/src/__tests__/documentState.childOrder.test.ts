import type { CRDTMap, DocumentOp, Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { replaceRangeOps } from "../commands/rangeReplace";
import { createEditor as createCoreEditor } from "../index";
import { defineBlock } from "../schema/defineBlock";
import { prop } from "../schema/prop";
import { mergeSchemas } from "../schema/registry";
import { mulberry32 } from "./fixtures/structuralEdits";
import { createDefaultSchema } from "./fixtures/testSchema";

/** A children-array container (the `toggle` shape with nested children). */
const section = defineBlock("section", {
	content: [],
	isContainer: true,
});

/** A container whose children reach it through the `parentId` prop. */
const quote = defineBlock("quote", {
	content: "inline",
	isContainer: true,
	props: { parentId: prop.string().optional() },
});

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

const ARRAY_PARENTS = ["tg", "tg2"] as const;
const PARENT_ID_PARENTS = ["bq", "bq2"] as const;

function createEditor(): Editor {
	const schema = mergeSchemas(createDefaultSchema(), createDefaultSchema().extend([section, quote]));
	return createCoreEditor({ schema, preset: noDefaultExtensionsPreset });
}

/** Two children-array containers and two `parentId` containers, three children each. */
function createRoutedEditor(): Editor {
	const editor = createEditor();
	const setup: DocumentOp[] = [];
	for (const parent of ARRAY_PARENTS) {
		setup.push({ type: "insert-block", blockId: parent, blockType: "section", props: {}, position: "last" });
		for (let i = 0; i < 3; i += 1) {
			setup.push({
				type: "insert-block",
				blockId: `${parent}-c${i}`,
				blockType: "paragraph",
				props: {},
				position: { parent, index: i },
			});
		}
	}
	for (const parent of PARENT_ID_PARENTS) {
		setup.push({ type: "insert-block", blockId: parent, blockType: "quote", props: {}, position: "last" });
		let previous: string = parent;
		for (let i = 0; i < 3; i += 1) {
			const blockId = `${parent}-c${i}`;
			setup.push({
				type: "insert-block",
				blockId,
				blockType: "bulletListItem",
				props: { parentId: parent },
				position: { after: previous },
			});
			previous = blockId;
		}
	}
	editor.apply(setup);
	return editor;
}

function blockIds(editor: Editor): string[] {
	return [...editor.internals.doc.blocks.keys()].sort();
}

/** The nested preorder, then parentOf / childrenOf / indexOf for every stored block. */
function snapshot(editor: Editor): unknown[] {
	const state = editor.documentState;
	const perBlock = blockIds(editor).map((id) => [
		id,
		state.indexOf(id),
		state.preorderIndexOf(id),
		state.parentOf(id),
		[...state.childrenOf(id)],
	]);
	return [[...state.preorderBlockIds()], ...perBlock];
}

/** The incrementally kept indexes equal a full rebuild. */
function expectIndexMatchesRebuild(editor: Editor, step: string): void {
	const incremental = snapshot(editor);
	const order = [...editor.documentState.blockOrder];
	(editor.documentState as unknown as { rebuild(): void }).rebuild();
	expect(snapshot(editor), step).toEqual(incremental);
	expect([...editor.documentState.blockOrder], `${step} blockOrder`).toEqual(order);
}

function arrayChildren(editor: Editor, parent: string): string[] {
	const children = (editor.internals.doc.blocks.get(parent) as CRDTMap<unknown> | undefined)?.get("children") as
		| { toArray(): string[] }
		| undefined;
	return children?.toArray() ?? [];
}

function randomRoutedOp(editor: Editor, random: () => number, step: number): DocumentOp {
	const ids = blockIds(editor);
	const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
	const blockId = `b${step}`;
	const roll = random();
	if (roll < 0.1) {
		return { type: "splice-text", blockId: pick(ids), from: 0, to: 0, insert: "x" };
	}
	if (roll < 0.2) {
		return { type: "insert-block", blockId, blockType: "paragraph", props: {}, position: { after: pick(ids) } };
	}
	if (roll < 0.3) {
		const parent = pick(ARRAY_PARENTS);
		return {
			type: "insert-block",
			blockId,
			blockType: "paragraph",
			props: {},
			position: { parent, index: Math.floor(random() * (arrayChildren(editor, parent).length + 1)) },
		};
	}
	if (roll < 0.4) {
		const parent = pick(PARENT_ID_PARENTS);
		const siblings = editor.documentState.childrenOf(parent);
		return {
			type: "insert-block",
			blockId,
			blockType: "bulletListItem",
			props: { parentId: parent },
			position: { after: siblings.length > 0 && random() < 0.7 ? pick(siblings) : parent },
		};
	}
	if (roll < 0.55) {
		// Reorder within (or move into) a children array.
		const parent = pick(ARRAY_PARENTS);
		const children = arrayChildren(editor, parent);
		const moved = children.length > 0 && random() < 0.8 ? pick(children) : pick(ids);
		return {
			type: "move-block",
			blockId: moved,
			position: { parent, index: Math.floor(random() * (children.length + 1)) },
		};
	}
	if (roll < 0.7) {
		// Reorder `parentId` siblings, or any block, through blockOrder.
		const parent = pick(PARENT_ID_PARENTS);
		const siblings = editor.documentState.childrenOf(parent);
		const moved = siblings.length > 0 && random() < 0.7 ? pick(siblings) : pick(ids);
		const anchor = siblings.length > 0 && random() < 0.7 ? pick(siblings) : pick(ids);
		const position = random() < 0.5 ? { after: anchor } : { before: anchor };
		return { type: "move-block", blockId: moved, position };
	}
	if (roll < 0.8) {
		return { type: "set-props", blockId: pick(ids), props: { indent: Math.floor(random() * 3) } };
	}
	if (roll < 0.88) {
		// Adopt into, or release from, a `parentId` container.
		const target = random() < 0.7 ? pick(PARENT_ID_PARENTS) : null;
		return { type: "set-props", blockId: pick(ids), props: { parentId: target } };
	}
	return { type: "delete-block", blockId: pick(ids) };
}

describe("DocumentState child order", () => {
	it("SCALE2: childrenOf follows a reorder within the same children array", () => {
		const editor = createRoutedEditor();
		expect(editor.documentState.childrenOf("tg")).toEqual(["tg-c0", "tg-c1", "tg-c2"]);
		editor.apply([{ type: "move-block", blockId: "tg-c2", position: { parent: "tg", index: 0 } }]);
		expect(arrayChildren(editor, "tg")).toEqual(["tg-c2", "tg-c0", "tg-c1"]);
		expect(editor.documentState.childrenOf("tg")).toEqual(["tg-c2", "tg-c0", "tg-c1"]);
		expect(editor.documentState.parentOf("tg-c2")).toBe("tg");
		expectIndexMatchesRebuild(editor, "after reorder");
		editor.destroy();
	});

	it("SCALE2: a range over a reordered children array deletes only the selected blocks", () => {
		const editor = createEditor();
		editor.apply([
			{ type: "insert-block", blockId: "c1", blockType: "paragraph", props: {}, position: "last" },
			{ type: "insert-block", blockId: "tg", blockType: "section", props: {}, position: "last" },
			...["k1", "k2", "k3"].map(
				(blockId, index): DocumentOp => ({
					type: "insert-block",
					blockId,
					blockType: "paragraph",
					props: {},
					position: { parent: "tg", index },
				}),
			),
			...["c1", "k1", "k2", "k3"].map(
				(blockId): DocumentOp => ({ type: "splice-text", blockId, from: 0, to: 0, insert: `${blockId} text` }),
			),
		]);
		// Warm the preorder cache before the reorder.
		expect(editor.documentState.preorderBlockIds().slice(-5)).toEqual(["c1", "tg", "k1", "k2", "k3"]);
		editor.apply([{ type: "move-block", blockId: "k3", position: { parent: "tg", index: 0 } }]);
		expect(editor.documentState.preorderBlockIds().slice(-5)).toEqual(["c1", "tg", "k3", "k1", "k2"]);

		const selection = {
			type: "text",
			anchor: { blockId: "k3", offset: 0 },
			focus: { blockId: "k1", offset: 1 },
		} as const;
		editor.selectTextRange(selection.anchor, selection.focus);
		expect(editor.getSelectedBlocks().map((block) => block.id)).toEqual(["k3", "k1"]);
		const result = replaceRangeOps(editor, selection, "");
		const deleted = (result?.ops ?? []).flatMap((op) => (op.type === "delete-block" ? [op.blockId] : []));
		expect(deleted).not.toContain("k2");
		editor.destroy();
	});

	it("SCALE2: childrenOf and the preorder follow a remote reorder within a children array", () => {
		const local = createRoutedEditor();
		const remote = createEditor();
		const sync = () => {
			const { adapter, crdtDoc } = local.internals;
			remote.internals.adapter.applyUpdate(remote.internals.crdtDoc, adapter.encodeState(crdtDoc));
		};
		sync();
		expect(remote.documentState.childrenOf("tg")).toEqual(["tg-c0", "tg-c1", "tg-c2"]);
		remote.documentState.preorderBlockIds();
		local.apply([{ type: "move-block", blockId: "tg-c2", position: { parent: "tg", index: 0 } }]);
		sync();
		expect(remote.documentState.childrenOf("tg")).toEqual(["tg-c2", "tg-c0", "tg-c1"]);
		expectIndexMatchesRebuild(remote, "after remote reorder");
		local.destroy();
		remote.destroy();
	});

	it("SCALE2: childrenOf follows a reorder of parentId-route siblings", () => {
		const editor = createRoutedEditor();
		editor.apply([{ type: "move-block", blockId: "bq-c2", position: { after: "bq" } }]);
		expect(editor.documentState.childrenOf("bq")).toEqual(["bq-c2", "bq-c0", "bq-c1"]);
		expectIndexMatchesRebuild(editor, "after reorder");
		editor.destroy();
	});

	it("SCALE2: the incremental index equals a full rebuild over random edits on every route", () => {
		for (let seed = 1; seed <= 300; seed += 1) {
			const editor = createRoutedEditor();
			expectIndexMatchesRebuild(editor, `seed ${seed} setup`);
			const random = mulberry32(seed);
			for (let step = 0; step < 30; step += 1) {
				const op = randomRoutedOp(editor, random, step);
				editor.apply([op]);
				expectIndexMatchesRebuild(editor, `seed ${seed} step ${step} ${JSON.stringify(op)}`);
			}
			editor.destroy();
		}
	}, 60_000);
});
