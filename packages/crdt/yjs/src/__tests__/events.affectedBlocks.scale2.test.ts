import type { CRDTEvent } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { yjsAdapter } from "../adapter";
import { createYjsDocument, initBlockMap } from "../document";
import { createObserver } from "../events";

function setup(gc: boolean) {
	const local = createYjsDocument(yjsAdapter());
	local.ydoc.gc = gc;
	local.ydoc.transact(() => {
		for (const id of ["a", "b", "c", "d"]) {
			initBlockMap(local.penDocument.blocks, id, "paragraph", "inline");
			local.penDocument.blockOrder.push([id]);
		}
	});
	const remote = new Y.Doc({ gc });
	Y.applyUpdate(remote, Y.encodeStateAsUpdate(local.ydoc));
	const events: CRDTEvent[] = [];
	const unsubscribe = createObserver(local, (event) => events.push(event));
	const deliver = (change: (doc: Y.Doc) => void) => {
		const before = Y.encodeStateVector(local.ydoc);
		change(remote);
		Y.applyUpdate(local.ydoc, Y.encodeStateAsUpdate(remote, before), "remote");
	};
	return { events, deliver, unsubscribe };
}

describe("remote blockOrder changes report exact affected ids", () => {
	for (const gc of [true, false]) {
		it(`SCALE2: a remote blockOrder insert, delete and move report only the ids they touched (gc: ${gc})`, () => {
			const { events, deliver, unsubscribe } = setup(gc);
			deliver((doc) => {
				doc.transact(() => {
					const map = new Y.Map<unknown>();
					map.set("type", "paragraph");
					map.set("content", new Y.Text());
					doc.getMap("blocks").set("e", map);
					doc.getArray("blockOrder").insert(2, ["e"]);
				});
			});
			expect([...(events.at(-1)?.affectedBlocks ?? [])].sort()).toEqual(["e"]);

			deliver((doc) => {
				doc.transact(() => {
					doc.getArray("blockOrder").delete(0, 1);
					doc.getMap("blocks").delete("a");
				});
			});
			expect([...(events.at(-1)?.affectedBlocks ?? [])].sort()).toEqual(["a"]);

			deliver((doc) => {
				doc.transact(() => {
					const order = doc.getArray<string>("blockOrder");
					const index = order.toArray().indexOf("d");
					order.delete(index, 1);
					order.insert(0, ["d"]);
				});
			});
			expect([...(events.at(-1)?.affectedBlocks ?? [])].sort()).toEqual(["d"]);
			unsubscribe();
		});
	}
});
