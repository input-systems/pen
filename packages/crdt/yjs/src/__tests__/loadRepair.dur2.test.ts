import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { yjsAdapter } from "../adapter";
import type { CRDTDiagnostic } from "../adapter";
import { initBlockMap } from "../document";
import type { YjsCRDTDocument } from "../document";
import { getDocumentLoadReport } from "../loadDocument";
import type { RecoveredMethod } from "../loadDocument";

function seedParagraph(
	adapter: ReturnType<typeof yjsAdapter>,
	blockId: string,
	text: string,
): YjsCRDTDocument {
	const doc = adapter.createDocument() as YjsCRDTDocument;
	adapter.transact(doc, () => {
		initBlockMap(doc.penDocument.blocks, blockId, "paragraph", "inline");
		doc.penDocument.blockOrder.push([blockId]);
		(doc.penDocument.blocks.get(blockId)!.get("content") as Y.Text).insert(
			0,
			text,
		);
	});
	return doc;
}

describe("load-path repairs (DUR2)", () => {
	it("DUR2: dangling blockOrder entry loads repaired, is removed, and emits recovery", () => {
		const sourceAdapter = yjsAdapter();
		const source = seedParagraph(sourceAdapter, "b1", "keep-me");
		source.ydoc.transact(() => {
			initBlockMap(
				source.penDocument.blocks,
				"ghost",
				"paragraph",
				"inline",
			);
			source.penDocument.blockOrder.push(["ghost"]);
		});
		// A concurrent move re-inserted the entry a delete removed: the block
		// map is gone, the entry is not (COL4).
		source.ydoc.transact(() => {
			source.penDocument.blocks.delete("ghost");
		});

		const diagnostics: CRDTDiagnostic[] = [];
		const recovered: RecoveredMethod[] = [];
		const loader = yjsAdapter({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
			onRecovered: (method) => recovered.push(method),
		});
		const loaded = loader.loadDocument(
			sourceAdapter.encodeState(source),
		) as YjsCRDTDocument;

		expect(getDocumentLoadReport(loaded)?.state).toBe("repaired");
		expect(recovered).toEqual(["repair"]);
		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "ORPHAN_BLOCK",
					message: expect.stringContaining("ghost"),
				}),
			]),
		);
		expect(loaded.penDocument.blockOrder.toArray()).toEqual(["b1"]);
		expect(loaded.penDocument.blocks.has("ghost")).toBe(false);
		expect(
			(
				loaded.penDocument.blocks.get("b1")?.get("content") as Y.Text
			).toString(),
		).toBe("keep-me");
	});

	it("DUR2: orphan block loads repaired, is reattached, and emits recovery", () => {
		const sourceAdapter = yjsAdapter();
		const source = seedParagraph(sourceAdapter, "b1", "visible");
		source.ydoc.transact(() => {
			initBlockMap(
				source.penDocument.blocks,
				"orphan",
				"hostWidget",
				"inline",
			);
			(
				source.penDocument.blocks
					.get("orphan")!
					.get("props") as Y.Map<unknown>
			).set("payload", "kept");
			(
				source.penDocument.blocks
					.get("orphan")!
					.get("content") as Y.Text
			).insert(0, "orphan-body");
		});

		const diagnostics: CRDTDiagnostic[] = [];
		const recovered: RecoveredMethod[] = [];
		const loader = yjsAdapter({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
			onRecovered: (method) => recovered.push(method),
		});
		const loaded = loader.loadDocument(
			sourceAdapter.encodeState(source),
		) as YjsCRDTDocument;

		expect(getDocumentLoadReport(loaded)?.state).toBe("repaired");
		expect(recovered).toEqual(["repair"]);
		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "ORPHAN_BLOCK",
					message: expect.stringContaining("orphan"),
				}),
			]),
		);
		expect(loaded.penDocument.blockOrder.toArray()).toEqual([
			"b1",
			"orphan",
		]);
		expect(loaded.penDocument.blocks.get("orphan")?.get("type")).toBe(
			"hostWidget",
		);
		expect(
			(
				loaded.penDocument.blocks
					.get("orphan")
					?.get("props") as Y.Map<unknown>
			).get("payload"),
		).toBe("kept");
		expect(
			(
				loaded.penDocument.blocks
					.get("orphan")
					?.get("content") as Y.Text
			).toString(),
		).toBe("orphan-body");
		expect(
			(
				loaded.penDocument.blocks.get("b1")?.get("content") as Y.Text
			).toString(),
		).toBe("visible");
	});
	it("DUR2 COL4: an order entry whose block map is still in flight survives load repair", () => {
		const adapter = yjsAdapter();
		const base = seedParagraph(adapter, "b1", "One");
		const peer = (clientId: number): YjsCRDTDocument => {
			const doc = adapter.loadDocument(
				adapter.encodeState(base),
			) as YjsCRDTDocument;
			doc.ydoc.clientID = clientId;
			return doc;
		};
		const a = peer(2);
		const b = peer(3);
		const c = peer(4);

		// a inserts x; b receives it and moves x to the front.
		adapter.transact(a, () => {
			initBlockMap(a.penDocument.blocks, "x", "paragraph", "inline");
			(a.penDocument.blocks.get("x")!.get("content") as Y.Text).insert(
				0,
				"Fresh",
			);
			a.penDocument.blockOrder.push(["x"]);
		});
		Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
		adapter.transact(b, () => {
			b.penDocument.blockOrder.delete(1, 1);
			b.penDocument.blockOrder.insert(0, ["x"]);
		});

		// c hears b's move before a's insert, and persists that state.
		// Claim c has every struct but b's, so b's update omits a's insert.
		const claimed = Y.decodeStateVector(Y.encodeStateVector(b.ydoc));
		claimed.set(b.ydoc.clientID, 0);
		Y.applyUpdate(
			c.ydoc,
			Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(claimed)),
		);
		expect(c.penDocument.blockOrder.toArray()).toEqual(["x", "b1"]);
		expect(c.penDocument.blocks.has("x")).toBe(false);

		const diagnostics: CRDTDiagnostic[] = [];
		const loader = yjsAdapter({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const loaded = loader.loadDocument(
			Y.encodeStateAsUpdate(c.ydoc),
		) as YjsCRDTDocument;

		// The entry is kept, not repaired away as dangling.
		expect(getDocumentLoadReport(loaded)?.state).toBe("ok");
		expect(diagnostics).toEqual([]);
		expect(loaded.penDocument.blockOrder.toArray()).toEqual(["x", "b1"]);

		// a's insert lands: the block is where b moved it, in no other array.
		Y.applyUpdate(loaded.ydoc, Y.encodeStateAsUpdate(a.ydoc));
		expect(loaded.penDocument.blockOrder.toArray()).toEqual(["x", "b1"]);
		expect(
			(
				loaded.penDocument.blocks.get("x")?.get("content") as Y.Text
			).toString(),
		).toBe("Fresh");
	});
});
