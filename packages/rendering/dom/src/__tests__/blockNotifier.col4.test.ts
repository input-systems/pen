import { createEditor } from "@input/pen-core";
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
});
