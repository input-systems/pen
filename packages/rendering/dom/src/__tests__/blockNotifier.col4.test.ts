import { createEditor, getListSegments } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";

import { createBlockNotifier } from "../field-editor/blockNotifier";

const editors: Editor[] = [];

function encode(editor: Editor): Uint8Array {
	return editor.internals.adapter.encodeUpdate(editor.internals.crdtDoc);
}

function deliver(from: Editor, to: Editor): void {
	to.internals.adapter.applyUpdate(to.internals.crdtDoc, encode(from));
}

/** Two peers sharing one state, each holding `victim` and `kept` after the seed block. */
function createPeers(): { a: Editor; b: Editor } {
	const a = createEditor({ schema: defaultSchema });
	a.apply(
		[
			{ type: "insert-block", blockId: "victim", blockType: "paragraph", props: {}, position: "last" },
			{ type: "insert-block", blockId: "kept", blockType: "paragraph", props: {}, position: "last" },
		],
		{ origin: "system" },
	);
	const b = createEditor({ schema: defaultSchema });
	deliver(a, b);
	deliver(b, a);
	editors.push(a, b);
	return { a, b };
}

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("block notifier (COL4 dangling entries)", () => {
	it("COL4: a remote delete against a local move drops the dead block from rootIds", () => {
		const { a, b } = createPeers();
		const notifier = createBlockNotifier(b);
		let documentChanges = 0;
		const unsubscribe = notifier.subscribeDocument(() => {
			documentChanges += 1;
		});
		a.apply([{ type: "delete-block", blockId: "victim" }], { origin: "user" });
		b.apply([{ type: "move-block", blockId: "victim", position: "first" }], { origin: "user" });
		expect(notifier.getDocumentSnapshot().rootIds[0]).toBe("victim");

		documentChanges = 0;
		deliver(a, b);

		expect(b.getBlock("victim"), "the deletion wins").toBeNull();
		expect(b.documentState.blockOrder, "remote commits do not normalize").toContain("victim");
		expect(notifier.getDocumentSnapshot().rootIds).not.toContain("victim");
		expect(notifier.getDocumentSnapshot().rootIds).toContain("kept");
		expect(documentChanges, "renderers hear the change").toBe(1);
		unsubscribe();
	});

	it("COL4: a block that died while the notifier was detached is skipped once it reads again", () => {
		const { a, b } = createPeers();
		const notifier = createBlockNotifier(b);
		a.apply([{ type: "delete-block", blockId: "victim" }], { origin: "user" });
		b.apply([{ type: "move-block", blockId: "victim", position: "first" }], { origin: "user" });
		deliver(a, b);
		expect(b.documentState.blockOrder, "remote commits do not normalize").toContain("victim");

		expect(notifier.getDocumentSnapshot().rootIds).not.toContain("victim");
		const unsubscribe = notifier.subscribeDocument(() => {});
		expect(notifier.getDocumentSnapshot().rootIds).not.toContain("victim");
		expect(notifier.getListSegments(null)).not.toContainEqual({ kind: "block", blockId: "victim" });
		unsubscribe();
	});

	it("COL4: a dead block re-inserted while the notifier was detached is back in rootIds", () => {
		const { a, b } = createPeers();
		const notifier = createBlockNotifier(b);
		const first = notifier.subscribeDocument(() => {});
		a.apply([{ type: "delete-block", blockId: "victim" }], { origin: "user" });
		b.apply([{ type: "move-block", blockId: "victim", position: "first" }], { origin: "user" });
		deliver(a, b);
		expect(notifier.getDocumentSnapshot().rootIds).not.toContain("victim");
		first();
		expect(notifier.diagnostics.sourceSubscriptions, "detached").toBe(0);

		a.apply(
			[{ type: "insert-block", blockId: "victim", blockType: "paragraph", props: {}, position: "last" }],
			{ origin: "user" },
		);
		deliver(a, b);
		expect(b.getBlock("victim"), "live again").not.toBeNull();

		const again = notifier.subscribeDocument(() => {});
		const fresh = createBlockNotifier(b);
		expect(notifier.getDocumentSnapshot().rootIds).toContain("victim");
		expect(notifier.getDocumentSnapshot().rootIds).toEqual(fresh.getDocumentSnapshot().rootIds);
		fresh.destroy();
		again();
	});

	it("COL4: a remote move into a children array re-segments the parentId container the block left", () => {
		const { a, b } = createPeers();
		a.apply(
			[
				// `item` is stored before `box`, so a rebuilt index resolves it to
				// the array route, not the `parentId` route it rendered under.
				{
					type: "insert-block",
					blockId: "item",
					blockType: "bulletListItem",
					props: {},
					position: "last",
				},
				{
					type: "insert-block",
					blockId: "box",
					blockType: "toggle",
					props: { open: true },
					position: "last",
				},
				{
					type: "insert-block",
					blockId: "bq",
					blockType: "blockquote",
					props: {},
					position: "last",
				},
				{
					type: "insert-block",
					blockId: "bq-a",
					blockType: "bulletListItem",
					props: { parentId: "bq" },
					position: "last",
				},
			],
			{ origin: "system" },
		);
		deliver(a, b);
		const notifier = createBlockNotifier(b);
		const unsubscribes = [
			notifier.subscribeListSegments("bq", () => {}),
			notifier.subscribeListSegments("box", () => {}),
			...["box", "bq", "bq-a", "item"].map((id) =>
				notifier.subscribeBlock(id, () => {}),
			),
		];

		// b adopts `item` into the blockquote through `parentId` while a moves
		// it into the toggle's array: b ends up with both routes (COL4).
		b.apply(
			[
				{
					type: "move-block",
					blockId: "item",
					position: { after: "bq-a" },
				},
				{
					type: "set-props",
					blockId: "item",
					props: { parentId: "bq" },
				},
			],
			{ origin: "user" },
		);
		expect(notifier.getListSegments("bq")).toEqual([
			expect.objectContaining({
				kind: "list",
				blockIds: ["bq-a", "item"],
			}),
		]);
		a.apply(
			[
				{
					type: "move-block",
					blockId: "item",
					position: { parent: "box", index: 0 },
				},
			],
			{ origin: "user" },
		);
		deliver(a, b);

		expect(b.documentState.childrenOf("bq")).toEqual(["bq-a"]);
		expect(notifier.getListSegments("bq")).toEqual(
			getListSegments(b, ["bq-a"]),
		);
		expect(notifier.getListSegments("box")).toEqual(
			getListSegments(b, b.documentState.childrenOf("box")),
		);
		for (const unsubscribe of unsubscribes) unsubscribe();
	});

	it("COL4: concurrent moves into two children arrays re-segment both arrays", () => {
		const { a, b } = createPeers();
		a.apply(
			[
				{
					type: "insert-block",
					blockId: "box1",
					blockType: "toggle",
					props: { open: true },
					position: "last",
				},
				{
					type: "insert-block",
					blockId: "box2",
					blockType: "toggle",
					props: { open: true },
					position: "last",
				},
				{
					type: "insert-block",
					blockId: "box1-a",
					blockType: "bulletListItem",
					props: {},
					position: { parent: "box1", index: 0 },
				},
				{
					type: "insert-block",
					blockId: "box2-a",
					blockType: "bulletListItem",
					props: {},
					position: { parent: "box2", index: 0 },
				},
				{
					type: "insert-block",
					blockId: "item",
					blockType: "bulletListItem",
					props: {},
					position: "last",
				},
			],
			{ origin: "system" },
		);
		deliver(a, b);
		const notifier = createBlockNotifier(b);
		const unsubscribes = [
			notifier.subscribeListSegments("box1", () => {}),
			notifier.subscribeListSegments("box2", () => {}),
			...["box1", "box2", "box1-a", "box2-a", "item"].map((id) =>
				notifier.subscribeBlock(id, () => {}),
			),
		];
		notifier.getListSegments("box1");
		notifier.getListSegments("box2");

		a.apply(
			[
				{
					type: "move-block",
					blockId: "item",
					position: { parent: "box1", index: 0 },
				},
			],
			{ origin: "user" },
		);
		b.apply(
			[
				{
					type: "move-block",
					blockId: "item",
					position: { parent: "box2", index: 0 },
				},
			],
			{ origin: "user" },
		);
		deliver(a, b);

		for (const parentId of ["box1", "box2"]) {
			const siblings = b.documentState.childrenOf(parentId);
			expect(
				siblings,
				`${parentId} lists the moved item until a local pass repairs it`,
			).toContain("item");
			expect(notifier.getListSegments(parentId), parentId).toEqual(
				getListSegments(b, siblings),
			);
		}
		for (const unsubscribe of unsubscribes) unsubscribe();
	});
});
