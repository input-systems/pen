import { createEditor, getListSegments } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";

import { createBlockNotifier } from "../field-editor/blockNotifier";
import { getRootBlockIds } from "../utils/parentIdTree";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

/** Root `[p, b1, b2, b3]`: a paragraph, then three bullets, `b3` holding a paragraph. */
function createListEditor(): Editor {
	const editor = createEditor({ schema: defaultSchema });
	const ops: DocumentOp[] = [{ type: "set-props", blockId: editor.firstBlock()!.id, props: { type: "paragraph" } }];
	for (const id of ["b1", "b2", "b3"]) {
		ops.push({ type: "insert-block", blockId: id, blockType: "bulletListItem", props: {}, position: "last" });
	}
	editor.apply(ops, { origin: "system" });
	editors.push(editor);
	return editor;
}

const insertAfterB2: DocumentOp = {
	type: "insert-block",
	blockId: "nb",
	blockType: "bulletListItem",
	props: {},
	position: { after: "b2" },
};

describe("block notifier subscription lifetime", () => {
	it("AX1: segments read before subscribing are current once subscribed", () => {
		const editor = createListEditor();
		const notifier = createBlockNotifier(editor);
		// React reads in render and subscribes in a passive effect; a commit
		// can land between the two.
		notifier.getListSegments(null);
		editor.apply([insertAfterB2], { origin: "user" });
		const unsubscribe = notifier.subscribeListSegments(null, () => {});
		expect(notifier.getListSegments(null)).toEqual(getListSegments(editor, getRootBlockIds(editor)));

		// Later commits patch from a current list.
		editor.apply([{ type: "set-props", blockId: "b1", props: { type: "paragraph" } }], { origin: "user" });
		expect(notifier.getListSegments(null)).toEqual(getListSegments(editor, getRootBlockIds(editor)));
		unsubscribe();
	});

	it("AX1: segments read before subscribing are current when another channel kept the notifier attached", () => {
		const editor = createListEditor();
		const notifier = createBlockNotifier(editor);
		const block = notifier.subscribeBlock("b1", () => {});
		notifier.getListSegments(null);
		editor.apply([insertAfterB2], { origin: "user" });
		const unsubscribe = notifier.subscribeListSegments(null, () => {});
		expect(notifier.getListSegments(null)).toEqual(getListSegments(editor, getRootBlockIds(editor)));
		unsubscribe();
		block();
	});

	it("AX1: segments read without subscribing keep their identity while nothing changes them", () => {
		const editor = createListEditor();
		const notifier = createBlockNotifier(editor);
		const block = notifier.subscribeBlock("b1", () => {});
		const read = notifier.getListSegments(null);
		editor.apply([{ type: "splice-text", blockId: "b1", from: 0, to: 0, insert: "x" }], { origin: "user" });
		const unsubscribe = notifier.subscribeListSegments(null, () => {});
		expect(notifier.getListSegments(null)).toBe(read);
		unsubscribe();
		block();
	});

	it("SCALE4: a stale segment unsubscribe leaves a newer subscriber on the same parent", () => {
		const editor = createListEditor();
		const notifier = createBlockNotifier(editor);
		const first = notifier.subscribeListSegments(null, () => {});
		first();
		let fired = 0;
		const second = notifier.subscribeListSegments(null, () => {
			fired += 1;
		});
		notifier.getListSegments(null);
		// Unsubscribes are idempotent; calling the released one again must not
		// drop the channel the second subscriber holds.
		first();
		editor.apply(
			[{ type: "insert-block", blockId: "nb", blockType: "bulletListItem", props: {}, position: { after: "b2" } }],
			{ origin: "user" },
		);
		expect(fired).toBe(1);
		expect(notifier.getListSegments(null)).toEqual(getListSegments(editor, getRootBlockIds(editor)));
		second();
		// The last segment subscriber out releases the editor subscriptions.
		expect(notifier.diagnostics.sourceSubscriptions).toBe(0);
	});
});
