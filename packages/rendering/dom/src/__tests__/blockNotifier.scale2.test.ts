import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { createBlockNotifier } from "../field-editor/blockNotifier";
import type { BlockNotifier } from "../field-editor/blockNotifierTypes";

function createDocument(blockCount: number, typeAt: (index: number) => string = () => "paragraph"): Editor {
	const editor = createEditor({ schema: defaultSchema });
	const first = editor.firstBlock()!.id;
	const ops: DocumentOp[] = [
		{ type: "set-props", blockId: first, props: { type: typeAt(0) } },
		{ type: "splice-text", blockId: first, from: 0, to: 0, insert: "block 0" },
	];
	for (let index = 1; index < blockCount; index += 1) {
		ops.push(
			{ type: "insert-block", blockId: `b${index}`, blockType: typeAt(index), props: {}, position: "last" },
			{ type: "splice-text", blockId: `b${index}`, from: 0, to: 0, insert: `block ${index}` },
		);
	}
	editor.apply(ops, { origin: "system" });
	return editor;
}

/** Subscribes every block and records which were notified. */
function subscribeAll(editor: Editor, notifier: BlockNotifier) {
	const notified: string[] = [];
	const unsubscribes = editor.documentState.blockOrder.map((id) =>
		notifier.subscribeBlock(id, () => notified.push(id)),
	);
	return {
		notified,
		reset: () => notified.splice(0),
		unsubscribeAll: () => unsubscribes.forEach((unsubscribe) => unsubscribe()),
	};
}

describe("block notifier (SCALE2 fan-out)", () => {
	it("SCALE2: a text commit notifies only the edited block", () => {
		const editor = createDocument(1_000);
		const notifier = createBlockNotifier(editor);
		const probe = subscribeAll(editor, notifier);
		editor.apply([{ type: "splice-text", blockId: "b500", from: 0, to: 0, insert: "x" }], { origin: "user" });
		expect(probe.notified).toEqual(["b500"]);
		expect(notifier.diagnostics.lastFanout.commit).toBe(1);
		expect(notifier.diagnostics.sourceSubscriptions).toBe(3);
		probe.unsubscribeAll();
		editor.destroy();
	});

	it("SCALE6: reading every block before subscribing walks the block order a bounded number of times", () => {
		// React renders every block, reading its snapshot, before any
		// subscription attaches; each detached read must not rebuild root ids.
		const orderReadsPerBlock = (blockCount: number) => {
			const editor = createDocument(blockCount);
			const notifier = createBlockNotifier(editor);
			const state = editor.documentState;
			const ids = [...state.blockOrder];
			const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(state), "blockOrder")!.get!;
			let reads = 0;
			Object.defineProperty(state, "blockOrder", {
				configurable: true,
				get: () =>
					new Proxy(getter.call(state) as readonly string[], {
						get(target, key, receiver) {
							if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
							return Reflect.get(target, key, receiver);
						},
					}),
			});
			for (const id of ids) notifier.getBlockSnapshot(id);
			delete (state as unknown as Record<string, unknown>).blockOrder;
			editor.destroy();
			return reads / blockCount;
		};
		expect(orderReadsPerBlock(1_000)).toBeLessThan(5);
		expect(orderReadsPerBlock(1_000)).toBeCloseTo(orderReadsPerBlock(100), 0);
	});

	it("SCALE6: a detached document snapshot still follows structural changes", () => {
		const editor = createDocument(4);
		const notifier = createBlockNotifier(editor);
		const first = editor.firstBlock()!.id;
		expect(notifier.getDocumentSnapshot().rootIds).toEqual([first, "b1", "b2", "b3"]);
		const unchanged = notifier.getDocumentSnapshot();
		editor.apply([{ type: "splice-text", blockId: "b1", from: 0, to: 0, insert: "x" }], { origin: "user" });
		expect(notifier.getDocumentSnapshot()).toBe(unchanged);
		editor.apply(
			[{ type: "insert-block", blockId: "b4", blockType: "paragraph", props: {}, position: "last" }],
			{ origin: "user" },
		);
		expect(notifier.getDocumentSnapshot().rootIds).toEqual([first, "b1", "b2", "b3", "b4"]);
		editor.apply([{ type: "set-props", blockId: "b2", props: { parentId: "b1" } }], { origin: "user" });
		expect(notifier.getDocumentSnapshot().rootIds).not.toContain("b2");
		editor.destroy();
	});

	it("SCALE2: a caret move across one boundary notifies the two blocks it touched", () => {
		const editor = createDocument(100);
		const notifier = createBlockNotifier(editor);
		const probe = subscribeAll(editor, notifier);
		editor.selectText("b10", 2, 2);
		probe.reset();
		editor.selectText("b11", 0, 0);
		expect(probe.notified.sort()).toEqual(["b10", "b11"]);

		// A range extension notifies only the blocks whose membership or range changed.
		editor.selectTextRange?.({ blockId: "b11", offset: 0 }, { blockId: "b13", offset: 2 });
		probe.reset();
		editor.selectTextRange?.({ blockId: "b11", offset: 0 }, { blockId: "b14", offset: 2 });
		expect(probe.notified.sort()).toEqual(["b13", "b14"]);
		probe.unsubscribeAll();
		editor.destroy();
	});

	it("SCALE6: a selection that changes kind re-slices the blocks inside both selections", () => {
		const editor = createDocument(10);
		const notifier = createBlockNotifier(editor);
		const probe = subscribeAll(editor, notifier);
		editor.selectTextRange?.(
			{ blockId: "b1", offset: 1 },
			{ blockId: "b5", offset: 2 },
		);
		expect(notifier.getBlockSnapshot("b3").selection.textRange).toEqual({
			from: 0,
			to: "end",
		});

		editor.selectBlocks(["b2", "b3", "b4"]);
		for (const id of ["b2", "b3", "b4"]) {
			expect(notifier.getBlockSnapshot(id).selection, id).toMatchObject({
				inSelection: true,
				textRange: null,
			});
		}

		editor.selectTextRange?.(
			{ blockId: "b1", offset: 1 },
			{ blockId: "b5", offset: 2 },
		);
		expect(notifier.getBlockSnapshot("b3").selection).toMatchObject({
			inSelection: true,
			textRange: { from: 0, to: "end" },
		});
		probe.unsubscribeAll();
		editor.destroy();
	});

	it("SCALE6: a structural commit that reverses a text range's endpoints re-slices both endpoints", () => {
		const editor = createDocument(10);
		const notifier = createBlockNotifier(editor);
		const probe = subscribeAll(editor, notifier);
		editor.selectTextRange?.(
			{ blockId: "b2", offset: 1 },
			{ blockId: "b5", offset: 2 },
		);
		expect(notifier.getBlockSnapshot("b2").selection.textRange).toEqual({
			from: 1,
			to: "end",
		});

		editor.apply(
			[{ type: "move-block", blockId: "b5", position: { before: "b1" } }],
			{ origin: "user" },
		);

		expect(editor.selection).toMatchObject({
			anchor: { blockId: "b2", offset: 1 },
			focus: { blockId: "b5", offset: 2 },
		});
		expect(notifier.getBlockSnapshot("b2").selection.textRange).toEqual({
			from: 0,
			to: 1,
		});
		expect(notifier.getBlockSnapshot("b5").selection.textRange).toEqual({
			from: 2,
			to: "end",
		});
		probe.unsubscribeAll();
		editor.destroy();
	});

	it("SCALE2: unchanged slices keep identity", () => {
		const editor = createDocument(10);
		const notifier = createBlockNotifier(editor);
		const probe = subscribeAll(editor, notifier);
		const before = notifier.getBlockSnapshot("b2");
		const ownBefore = notifier.getBlockSnapshot("b1");
		editor.apply([{ type: "splice-text", blockId: "b1", from: 0, to: 0, insert: "x" }], { origin: "user" });
		expect(notifier.getBlockSnapshot("b2")).toBe(before);
		const ownAfter = notifier.getBlockSnapshot("b1");
		expect(ownAfter).not.toBe(ownBefore);
		expect(ownAfter.selection).toBe(ownBefore.selection);
		expect(ownAfter.decorations).toBe(ownBefore.decorations);
		probe.unsubscribeAll();
		editor.destroy();
	});

	it("SCALE2: numbered list ordinals update only the touched run", () => {
		// b1–b4 and b7–b9 are two numbered runs separated by paragraphs.
		const numbered = new Set([1, 2, 3, 4, 7, 8, 9]);
		const editor = createDocument(12, (index) => (numbered.has(index) ? "numberedListItem" : "paragraph"));
		const notifier = createBlockNotifier(editor);
		const probe = subscribeAll(editor, notifier);
		expect(notifier.getBlockSnapshot("b4").list?.ordinal).toBe(4);
		editor.apply(
			[{ type: "insert-block", blockId: "n", blockType: "numberedListItem", props: {}, position: { after: "b1" } }],
			{ origin: "user" },
		);
		// b1 keeps its number but its set grew (AX1 aria-setsize); the b7 run is untouched.
		expect(probe.notified.sort()).toEqual(["b1", "b2", "b3", "b4"]);
		expect(notifier.getBlockSnapshot("b1").list?.setsize).toBe(5);
		expect(notifier.getBlockSnapshot("b4").list?.ordinal).toBe(5);
		expect(notifier.getBlockSnapshot("b7").list?.ordinal).toBe(1);
		probe.unsubscribeAll();
		editor.destroy();
	});

	it("SCALE6: a keystroke and a caret move in a numbered run read the same blocks at 1,000 and 5,000 items", () => {
		const blockReads = (itemCount: number) => {
			const editor = createDocument(itemCount, () => "numberedListItem");
			const notifier = createBlockNotifier(editor);
			const probe = subscribeAll(editor, notifier);
			const middle = `b${Math.floor(itemCount / 2)}`;
			editor.selectText(middle, 0, 0);
			const getBlock = editor.getBlock.bind(editor);
			let reads = 0;
			editor.getBlock = (blockId: string) => {
				reads += 1;
				return getBlock(blockId);
			};
			editor.apply([{ type: "splice-text", blockId: middle, from: 0, to: 0, insert: "x" }], { origin: "user" });
			editor.selectText(middle, 1, 1);
			const keystroke = reads;
			reads = 0;
			editor.selectText(middle, 0, 0);
			const caretMove = reads;
			expect(notifier.getBlockSnapshot(middle).list?.ordinal).toBe(Math.floor(itemCount / 2) + 1);
			probe.unsubscribeAll();
			editor.destroy();
			return { keystroke, caretMove };
		};
		const small = blockReads(1_000);
		expect(small.keystroke).toBeLessThan(20);
		expect(blockReads(5_000)).toEqual(small);
	});

	it("SCALE2: the root list-segment channel fires once on a structural commit and not on a text commit", () => {
		const editor = createDocument(10);
		const notifier = createBlockNotifier(editor);
		let fired = 0;
		const unsubscribe = notifier.subscribeListSegments(null, () => {
			fired += 1;
		});
		const before = notifier.getListSegments(null);
		editor.apply([{ type: "splice-text", blockId: "b3", from: 0, to: 0, insert: "x" }]);
		expect(fired).toBe(0);
		expect(notifier.getListSegments(null)).toBe(before);
		editor.apply([{ type: "insert-block", blockId: "new", blockType: "paragraph", props: {}, position: "last" }]);
		expect(fired).toBe(1);
		expect(notifier.getListSegments(null)).toHaveLength(11);
		unsubscribe();
		editor.destroy();
	});

	it("SCALE6: a text range ending in a children-array child slices its root endpoint from the anchor", () => {
		const editor = createEditor({ schema: defaultSchema });
		const first = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "splice-text", blockId: first, from: 0, to: 0, insert: "first" },
				{ type: "insert-block", blockId: "tg", blockType: "toggle", props: { open: true }, position: "last" },
				{ type: "insert-block", blockId: "child", blockType: "paragraph", props: {}, position: { parent: "tg", index: 0 } },
				{ type: "splice-text", blockId: "child", from: 0, to: 0, insert: "child" },
			],
			{ origin: "system" },
		);
		const notifier = createBlockNotifier(editor);
		const unsubscribes = [first, "child"].map((id) => notifier.subscribeBlock(id, () => {}));
		editor.setSelection({
			type: "text",
			anchor: { blockId: first, offset: 1 },
			focus: { blockId: "child", offset: 2 },
		});
		expect(editor.documentState.indexOf("child"), "outside the root order").toBe(-1);
		// The anchor comes first in document order: it is the range's start.
		expect(notifier.getBlockSnapshot(first).selection.textRange).toEqual({ from: 1, to: "end" });
		for (const unsubscribe of unsubscribes) unsubscribe();
		editor.destroy();
	});

	it("SCALE4: the block notifier releases subscribers and source subscriptions", () => {
		const editor = createDocument(10);
		const notifier = createBlockNotifier(editor);
		const unsubscribe = notifier.subscribeBlock("b1", () => {});
		expect(notifier.diagnostics.sourceSubscriptions).toBeGreaterThan(0);
		unsubscribe();
		expect(notifier.diagnostics).toMatchObject({ sourceSubscriptions: 0, cachedSnapshots: 0 });

		notifier.subscribeBlock("b2", () => {});
		notifier.destroy();
		expect(notifier.diagnostics).toMatchObject({ sourceSubscriptions: 0, cachedSnapshots: 0 });

		// A subscribe after destroy re-attaches.
		const again = notifier.subscribeBlock("b3", () => {});
		expect(notifier.diagnostics.sourceSubscriptions).toBeGreaterThan(0);
		// A read without a subscriber survives an event that does not name it
		// and is gone after a commit that does.
		notifier.getBlockSnapshot("b4");
		expect(notifier.diagnostics.cachedSnapshots).toBe(2);
		editor.apply([{ type: "splice-text", blockId: "b5", from: 0, to: 0, insert: "x" }]);
		expect(notifier.diagnostics.cachedSnapshots).toBe(2);
		editor.apply([{ type: "splice-text", blockId: "b4", from: 0, to: 0, insert: "x" }]);
		expect(notifier.diagnostics.cachedSnapshots).toBe(1);
		again();
		editor.destroy();
	});
});
