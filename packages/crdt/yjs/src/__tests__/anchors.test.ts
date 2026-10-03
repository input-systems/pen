import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { yjsAdapter } from "../adapter";
import { createYjsDocument, initBlockMap } from "../document";
import type { YjsCRDTDocument } from "../document";
import { createYjsUndoManager } from "../undo";
import { createPeerDoc, forkPeerDoc } from "./createPeerDoc";

function seedParagraph(
	doc: YjsCRDTDocument,
	blockId: string,
	text: string,
): Y.Text {
	doc.ydoc.transact(() => {
		initBlockMap(doc.penDocument.blocks, blockId, "paragraph", "inline");
		doc.penDocument.blockOrder.push([blockId]);
		const content = doc.penDocument.blocks
			.get(blockId)!
			.get("content") as Y.Text;
		if (text.length > 0) {
			content.insert(0, text);
		}
	});
	return doc.penDocument.blocks.get(blockId)!.get("content") as Y.Text;
}

describe("anchors AN1 adapter totality", () => {
	it("AN1: truncated bytes throw in raw Yjs decode and the adapter catches them to null", () => {
		const adapter = yjsAdapter();
		const doc = adapter.createDocument();
		expect(() =>
			Y.decodeRelativePosition(new Uint8Array([255, 255])),
		).toThrow(/Unexpected end of array/);
		expect(
			adapter.resolveRelativePosition(doc, new Uint8Array([255, 255])),
		).toBeNull();
		expect(
			adapter.resolveRelativePosition(doc, new Uint8Array([0, 1, 2, 3])),
		).toBeNull();
	});

	it("AN1: a removed block resolves null via the blocks-map scan, not index 0 on a deleted type", () => {
		const adapter = yjsAdapter();
		const doc = createYjsDocument(adapter);
		const ytext = seedParagraph(doc, "b1", "0123456789");
		const encoded = adapter.createRelativePosition(
			doc,
			{ blockId: "b1", offset: 5 },
			1,
		);
		expect(encoded).not.toBeNull();

		const raw = Y.createAbsolutePositionFromRelativePosition(
			Y.decodeRelativePosition(encoded!),
			doc.ydoc,
		);
		doc.ydoc.transact(() => {
			doc.penDocument.blocks.delete("b1");
			doc.penDocument.blockOrder.delete(0, 1);
		});
		const afterDelete = Y.createAbsolutePositionFromRelativePosition(
			Y.decodeRelativePosition(encoded!),
			doc.ydoc,
		);
		expect(raw?.index).toBe(5);
		expect(afterDelete).not.toBeNull();
		expect(afterDelete?.index).toBe(0);
		expect(
			(ytext as unknown as { _item?: { deleted?: boolean } })._item
				?.deleted,
		).toBe(true);
		expect(adapter.resolveRelativePosition(doc, encoded!)).toBeNull();
	});

	it("AN1: a stale-peer anchor is null before catch-up and resolves after", () => {
		const adapter = yjsAdapter();
		const a = createPeerDoc(adapter, 1);
		seedParagraph(a, "b1", "0123456789");
		const encoded = adapter.createRelativePosition(
			a,
			{ blockId: "b1", offset: 5 },
			1,
		)!;
		const b = createPeerDoc(adapter, 2);
		expect(adapter.resolveRelativePosition(b, encoded)).toBeNull();
		adapter.applyUpdate(b, adapter.encodeState(a));
		expect(adapter.resolveRelativePosition(b, encoded)).toEqual({
			blockId: "b1",
			offset: 5,
		});
	});
});

describe("anchors AN2 insertion-side stability", () => {
	it("AN2: assoc -1 stays before an insert at the mark and assoc 1 moves after; Yjs 0 is never minted", () => {
		const adapter = yjsAdapter();
		const doc = createYjsDocument(adapter);
		seedParagraph(doc, "b1", "hello");
		const before = adapter.createRelativePosition(
			doc,
			{ blockId: "b1", offset: 2 },
			-1,
		)!;
		const after = adapter.createRelativePosition(
			doc,
			{ blockId: "b1", offset: 2 },
			1,
		)!;
		const ytext = doc.penDocument.blocks
			.get("b1")!
			.get("content") as Y.Text;
		const minted = Y.decodeRelativePosition(after);
		expect(minted.assoc).toBe(1);
		doc.ydoc.transact(() => {
			ytext.insert(2, "XX");
		});
		expect(adapter.resolveRelativePosition(doc, before)).toEqual({
			blockId: "b1",
			offset: 2,
		});
		expect(adapter.resolveRelativePosition(doc, after)).toEqual({
			blockId: "b1",
			offset: 4,
		});
	});

	it("AN2: an assoc 1 anchor whose character was deleted stays before an insert at its collapsed index", () => {
		const adapter = yjsAdapter();
		const doc = createYjsDocument(adapter);
		seedParagraph(doc, "b1", "hello");
		const onDeleted = adapter.createRelativePosition(
			doc,
			{ blockId: "b1", offset: 2 },
			1,
		)!;
		const onLive = adapter.createRelativePosition(
			doc,
			{ blockId: "b1", offset: 3 },
			1,
		)!;
		const ytext = doc.penDocument.blocks
			.get("b1")!
			.get("content") as Y.Text;
		doc.ydoc.transact(() => {
			ytext.delete(2, 1);
		});
		expect(adapter.resolveRelativePosition(doc, onDeleted)).toEqual({
			blockId: "b1",
			offset: 2,
		});
		expect(adapter.resolveRelativePosition(doc, onLive)).toEqual({
			blockId: "b1",
			offset: 2,
		});

		doc.ydoc.transact(() => {
			ytext.insert(2, "XX");
		});
		// the insert lands after the tombstone the first anchor is bound to
		// and before the live character the second one is bound to
		expect(ytext.toString()).toBe("heXXlo");
		expect(adapter.resolveRelativePosition(doc, onDeleted)).toEqual({
			blockId: "b1",
			offset: 2,
		});
		expect(adapter.resolveRelativePosition(doc, onLive)).toEqual({
			blockId: "b1",
			offset: 4,
		});
	});
});

describe("anchors AN3 ordinary convergence", () => {
	it("AN3: two peers resolve the same encoded position after an ordinary interleaving", () => {
		const adapter = yjsAdapter();
		const a = createPeerDoc(adapter, 1);
		seedParagraph(a, "b1", "meadow sage");
		const encoded = adapter.createRelativePosition(
			a,
			{ blockId: "b1", offset: 7 },
			1,
		)!;
		const b = forkPeerDoc(adapter, a, 2);
		const aText = a.penDocument.blocks.get("b1")!.get("content") as Y.Text;
		const bText = b.penDocument.blocks.get("b1")!.get("content") as Y.Text;
		a.ydoc.transact(() => {
			aText.insert(0, "wild ");
		});
		b.ydoc.transact(() => {
			bText.insert(bText.length, "!");
		});
		adapter.applyUpdate(b, adapter.encodeState(a));
		adapter.applyUpdate(a, adapter.encodeState(b));
		expect(aText.toString()).toBe("wild meadow sage!");
		expect(bText.toString()).toBe("wild meadow sage!");
		const resolvedA = adapter.resolveRelativePosition(a, encoded);
		const resolvedB = adapter.resolveRelativePosition(b, encoded);
		expect(resolvedA).toEqual({ blockId: "b1", offset: 12 });
		expect(resolvedB).toEqual({ blockId: "b1", offset: 12 });
	});
});

describe("anchors AN7 gc envelope", () => {
	it("AN7: delete-then-undo restores the same item identity under gc:false", () => {
		const adapter = yjsAdapter();
		const doc = createYjsDocument(adapter);
		seedParagraph(doc, "b1", "hello world");
		const encoded = adapter.createRelativePosition(
			doc,
			{ blockId: "b1", offset: 6 },
			1,
		)!;
		const undo = createYjsUndoManager(doc);
		const ytext = doc.penDocument.blocks
			.get("b1")!
			.get("content") as Y.Text;
		doc.ydoc.transact(() => {
			ytext.delete(6, 5);
		}, "user");
		expect(
			adapter.resolveRelativePosition(doc, encoded, {
				followUndoneDeletions: true,
			}),
		).toEqual({ blockId: "b1", offset: 6 });
		undo.undo();
		expect(ytext.toString()).toBe("hello world");
		expect(
			adapter.resolveRelativePosition(doc, encoded, {
				followUndoneDeletions: true,
			}),
		).toEqual({ blockId: "b1", offset: 6 });
	});
});

describe("anchors AN13 resolver flag", () => {
	it("AN13: followUndoneDeletions is a resolve parameter, never a constant", () => {
		const adapter = yjsAdapter();
		const local = createPeerDoc(adapter, 1);
		seedParagraph(local, "b1", "hello world");
		const encoded = adapter.createRelativePosition(
			local,
			{ blockId: "b1", offset: 6 },
			1,
		)!;
		const remote = forkPeerDoc(adapter, local, 2);
		const undo = createYjsUndoManager(local);
		const ytext = local.penDocument.blocks
			.get("b1")!
			.get("content") as Y.Text;
		local.ydoc.transact(() => {
			ytext.delete(6, 5);
		}, "user");
		undo.undo();
		adapter.applyUpdate(remote, adapter.encodeState(local));
		const localFollow = adapter.resolveRelativePosition(local, encoded, {
			followUndoneDeletions: true,
		});
		const localNoFollow = adapter.resolveRelativePosition(local, encoded, {
			followUndoneDeletions: false,
		});
		const remoteFollow = adapter.resolveRelativePosition(remote, encoded, {
			followUndoneDeletions: true,
		});
		const remoteNoFollow = adapter.resolveRelativePosition(
			remote,
			encoded,
			{
				followUndoneDeletions: false,
			},
		);
		expect(localFollow).toEqual({ blockId: "b1", offset: 6 });
		expect(localNoFollow).toEqual(remoteNoFollow);
		expect(remoteFollow).toEqual(remoteNoFollow);
		expect(localFollow).not.toEqual(remoteFollow);
		expect(adapter.resolveRelativePosition(local, encoded)).toEqual(
			localFollow,
		);
	});
});

describe("anchors AN1 deleted characters and AN10 cells", () => {
	it("AN1: deleted characters collapse to a live index, not null", () => {
		const adapter = yjsAdapter();
		const doc = createYjsDocument(adapter);
		seedParagraph(doc, "b1", "0123456789");
		const encoded = adapter.createRelativePosition(
			doc,
			{ blockId: "b1", offset: 5 },
			1,
		)!;
		const ytext = doc.penDocument.blocks
			.get("b1")!
			.get("content") as Y.Text;
		doc.ydoc.transact(() => {
			ytext.delete(3, 4);
		});
		expect(ytext.toString()).toBe("012789");
		expect(adapter.resolveRelativePosition(doc, encoded)).toEqual({
			blockId: "b1",
			offset: 3,
		});
	});

	it("AN10: cell targets mint and resolve against tableContent[row].cells[col]", () => {
		const adapter = yjsAdapter();
		const doc = createYjsDocument(adapter);
		doc.ydoc.transact(() => {
			initBlockMap(doc.penDocument.blocks, "t1", "table", "table");
			doc.penDocument.blockOrder.push(["t1"]);
		});
		const table = doc.penDocument.blocks
			.get("t1")!
			.get("tableContent") as Y.Array<Y.Map<unknown>>;
		const cell = (table.get(1).get("cells") as Y.Array<Y.Map<unknown>>)
			.get(1)
			.get("content") as Y.Text;
		doc.ydoc.transact(() => {
			cell.insert(0, "cell text");
		});
		const encoded = adapter.createRelativePosition(
			doc,
			{ blockId: "t1", offset: 5, cell: { row: 1, col: 1 } },
			1,
		);
		expect(encoded).not.toBeNull();
		expect(
			adapter.resolveRelativePosition(doc, encoded!, {
				followUndoneDeletions: true,
			}),
		).toEqual({
			blockId: "t1",
			offset: 5,
			cell: { row: 1, col: 1 },
		});
	});

	it("AN1: createRelativePosition is null for an existing block with no Y.Text", () => {
		const adapter = yjsAdapter();
		const doc = createYjsDocument(adapter);
		doc.ydoc.transact(() => {
			initBlockMap(doc.penDocument.blocks, "s1", "section", "nested");
			doc.penDocument.blockOrder.push(["s1"]);
		});
		expect(doc.penDocument.blocks.has("s1")).toBe(true);
		expect(
			adapter.createRelativePosition(
				doc,
				{ blockId: "s1", offset: 0 },
				1,
			),
		).toBeNull();
	});
});

describe("anchors encode size is client-id dependent", () => {
	it("AN11: clientID 0 encodes in 4–6 bytes; a live clientID encodes larger", () => {
		const adapter = yjsAdapter();
		const zero = createPeerDoc(adapter, 0);
		seedParagraph(zero, "b1", "meadow ".repeat(100));
		const zeroEncoded = adapter.createRelativePosition(
			zero,
			{ blockId: "b1", offset: 50 },
			1,
		)!;
		expect(zeroEncoded.byteLength).toBeGreaterThanOrEqual(4);
		expect(zeroEncoded.byteLength).toBeLessThanOrEqual(6);

		const live = createPeerDoc(adapter, 0x24d3a198);
		seedParagraph(live, "b1", "meadow ".repeat(100));
		const liveEncoded = adapter.createRelativePosition(
			live,
			{ blockId: "b1", offset: 50 },
			1,
		)!;
		expect(liveEncoded.byteLength).toBeGreaterThan(6);
		expect(liveEncoded.byteLength).toBeLessThanOrEqual(256);
	});
});
