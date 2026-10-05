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

describe("block notifier subscription lifetime", () => {
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
