import { initBlockMap, yjsAdapter } from "@input/pen-yjs";
import type { Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import type { BlockIndex } from "../changes/blockIndex";
import { createBlockIndexSnapshotFromDocument } from "../changes/fromDocument";
import { createEditor } from "./editorCore.testHelpers";
import { createNestedEditor, mulberry32, randomOp } from "./fixtures/structuralEdits";

function heldIndex(editor: Editor): ReturnType<BlockIndex["snapshot"]> {
	return (editor as unknown as { _blockIndex: BlockIndex })._blockIndex.snapshot();
}

describe("change-summary block index on structural commits", () => {
	it("SCALE2: the block index after a structural commit equals a fresh read of the document", () => {
		for (const seed of [21, 22, 23]) {
			const editor = createNestedEditor();
			const random = mulberry32(seed);
			for (let step = 0; step < 80; step += 1) {
				const roll = random();
				if (roll < 0.1) editor.undoManager.undo();
				else if (roll < 0.15) editor.undoManager.redo();
				else editor.apply([randomOp(editor, random, step)]);
				const fresh = createBlockIndexSnapshotFromDocument(editor.internals.doc);
				const held = heldIndex(editor);
				const label = `seed ${seed} step ${step}`;
				expect([...held.lengthById].sort(), label).toEqual([...fresh.lengthById].sort());
				expect(held.roots, label).toEqual(fresh.roots);
				expect([...held.typeById].sort(), label).toEqual([...fresh.typeById].sort());
				expect([...held.childrenByParentId].sort(), label).toEqual([...fresh.childrenByParentId].sort());
				expect([...held.parentById].sort(), label).toEqual([...fresh.parentById].sort());
			}
			editor.destroy();
		}
	});

	it("SCALE2: a delete a commit listener makes beside a remote delete leaves the block index equal to the document", () => {
		// Yjs merges the listener's nested delete into the remote
		// transaction's delete set, so the nested commit reports an empty
		// root delta; the index must still match the document. One push gives
		// the order entries adjacent clocks, as a loaded document's are.
		const seedDoc = new Y.Doc({ gc: false });
		seedDoc.transact(() => {
			const blocks = seedDoc.getMap<Y.Map<unknown>>("blocks");
			for (const blockId of ["p0", "p1", "p2", "p3", "p4"]) {
				initBlockMap(blocks, blockId, "paragraph", "inline");
			}
			seedDoc.getArray<string>("blockOrder").push(["p0", "p1", "p2", "p3", "p4"]);
		});
		const seed = Y.encodeStateAsUpdate(seedDoc);
		seedDoc.destroy();
		const peers = [1, 2].map((clientID) => {
			const adapter = yjsAdapter({ gc: false });
			const document = adapter.loadDocument(seed);
			(adapter.raw<Y.Doc>(document) as unknown as { clientID: number }).clientID = clientID;
			return createEditor({ crdt: adapter, document });
		});
		const [local, remote] = peers as [Editor, Editor];
		const rawDoc = (editor: Editor) => editor.internals.adapter.raw<Y.Doc>(editor.internals.crdtDoc);
		let armed = true;
		local.on("commit", () => {
			if (!armed) return;
			armed = false;
			local.apply([{ type: "delete-block", blockId: "p2" }], { origin: "user" });
		});

		remote.apply([{ type: "delete-block", blockId: "p1" }], { origin: "user" });
		local.internals.adapter.applyUpdate(
			local.internals.crdtDoc,
			Y.encodeStateAsUpdate(rawDoc(remote), Y.encodeStateVector(rawDoc(local))),
		);

		expect(armed).toBe(false);
		expect(local.documentState.blockOrder).toEqual(["p0", "p3", "p4"]);
		expect(heldIndex(local).roots).toEqual(createBlockIndexSnapshotFromDocument(local.internals.doc).roots);
		for (const editor of peers) editor.destroy();
	});
});
