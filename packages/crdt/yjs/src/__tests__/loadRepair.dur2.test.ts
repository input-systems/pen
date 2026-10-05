import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { yjsAdapter } from "../adapter";
import type { CRDTDiagnostic } from "../adapter";
import { initBlockMap } from "../document";
import type { YjsCRDTDocument } from "../document";
import { getDocumentLoadReport } from "../loadDocument";
import type { RecoveredMethod } from "../loadDocument";

type Adapter = ReturnType<typeof yjsAdapter>;

function addBlock(
	doc: YjsCRDTDocument,
	blockId: string,
	{
		type = "paragraph",
		text = "",
		props = {},
	}: { type?: string; text?: string; props?: Record<string, unknown> } = {},
): Y.Map<unknown> {
	const blockMap = initBlockMap(
		doc.penDocument.blocks,
		blockId,
		type,
		"inline",
	);
	(blockMap.get("content") as Y.Text).insert(0, text);
	const propsMap = blockMap.get("props") as Y.Map<unknown>;
	for (const [key, value] of Object.entries(props)) {
		propsMap.set(key, value);
	}
	return blockMap;
}

/** A container with an inline title beside its children, `toggle`'s shape. */
function addContainer(
	doc: YjsCRDTDocument,
	blockId: string,
	title: string,
): Y.Array<string> {
	const children = new Y.Array<string>();
	addBlock(doc, blockId, { type: "toggle", text: title }).set(
		"children",
		children,
	);
	return children;
}

function seedParagraph(
	adapter: Adapter,
	blockId: string,
	text: string,
): YjsCRDTDocument {
	const doc = adapter.createDocument() as YjsCRDTDocument;
	adapter.transact(doc, () => {
		addBlock(doc, blockId, { text });
		doc.penDocument.blockOrder.push([blockId]);
	});
	return doc;
}

/**
 * root order: [top, routed, tail]
 *   top.children: [mid, leaf-a]
 *     mid.children: [leaf-b]        (depth 2 on the children-array route)
 *   routed: parentId top             (parentId route, sits in blockOrder)
 *   tail.children: none; tail is a plain paragraph
 */
function seedNested(adapter: Adapter): YjsCRDTDocument {
	const doc = adapter.createDocument() as YjsCRDTDocument;
	adapter.transact(doc, () => {
		const topChildren = addContainer(doc, "top", "Top");
		const midChildren = addContainer(doc, "mid", "Mid");
		addBlock(doc, "leaf-a");
		addBlock(doc, "leaf-b");
		addBlock(doc, "routed", { props: { parentId: "top" } });
		addBlock(doc, "tail");
		midChildren.push(["leaf-b"]);
		topChildren.push(["mid", "leaf-a"]);
		doc.penDocument.blockOrder.push(["top", "routed", "tail"]);
	});
	return doc;
}

function load(
	bytes: Uint8Array,
	clientId?: number,
): {
	doc: YjsCRDTDocument;
	diagnostics: CRDTDiagnostic[];
	recovered: RecoveredMethod[];
} {
	const diagnostics: CRDTDiagnostic[] = [];
	const recovered: RecoveredMethod[] = [];
	const loader = yjsAdapter({
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		onRecovered: (method) => recovered.push(method),
	});
	const doc = loader.loadDocument(bytes) as YjsCRDTDocument;
	if (clientId !== undefined) doc.ydoc.clientID = clientId;
	return { doc, diagnostics, recovered };
}

function block(doc: YjsCRDTDocument, blockId: string) {
	const blockMap = doc.penDocument.blocks.get(blockId);
	return {
		get text() {
			return (blockMap?.get("content") as Y.Text).toString();
		},
		get children() {
			return (blockMap?.get("children") as Y.Array<string>).toArray();
		},
		prop: (key: string) =>
			(blockMap?.get("props") as Y.Map<unknown>).get(key),
	};
}

function orderOf(doc: YjsCRDTDocument): string[] {
	return doc.penDocument.blockOrder.toArray();
}

function expectRepaired(
	{ doc, diagnostics, recovered }: ReturnType<typeof load>,
	orphanId: string,
): void {
	expect(getDocumentLoadReport(doc)?.state).toBe("repaired");
	expect(recovered).toEqual(["repair"]);
	expect(diagnostics).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: "ORPHAN_BLOCK",
				message: expect.stringContaining(orphanId),
			}),
		]),
	);
}

describe("load-path repairs (DUR2)", () => {
	it("DUR2: dangling blockOrder entry loads repaired, is removed, and emits recovery", () => {
		const adapter = yjsAdapter();
		const source = seedParagraph(adapter, "b1", "keep-me");
		source.ydoc.transact(() => {
			addBlock(source, "ghost");
			source.penDocument.blockOrder.push(["ghost"]);
		});
		// A concurrent move re-inserted the entry a delete removed: the block
		// map is gone, the entry is not (COL4).
		source.ydoc.transact(() => source.penDocument.blocks.delete("ghost"));

		const loaded = load(adapter.encodeState(source));

		expectRepaired(loaded, "ghost");
		expect(orderOf(loaded.doc)).toEqual(["b1"]);
		expect(loaded.doc.penDocument.blocks.has("ghost")).toBe(false);
		expect(block(loaded.doc, "b1").text).toBe("keep-me");
	});

	it("DUR2: orphan block loads repaired, is reattached, and emits recovery", () => {
		const adapter = yjsAdapter();
		const source = seedParagraph(adapter, "b1", "visible");
		source.ydoc.transact(() => {
			addBlock(source, "orphan", {
				type: "hostWidget",
				text: "orphan-body",
				props: { payload: "kept" },
			});
		});

		const loaded = load(adapter.encodeState(source));

		expectRepaired(loaded, "orphan");
		expect(orderOf(loaded.doc)).toEqual(["b1", "orphan"]);
		const orphan = block(loaded.doc, "orphan");
		expect(loaded.doc.penDocument.blocks.get("orphan")?.get("type")).toBe(
			"hostWidget",
		);
		expect(orphan.prop("payload")).toBe("kept");
		expect(orphan.text).toBe("orphan-body");
		expect(block(loaded.doc, "b1").text).toBe("visible");
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
			addBlock(a, "x", { text: "Fresh" });
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
		expect(orderOf(c)).toEqual(["x", "b1"]);
		expect(c.penDocument.blocks.has("x")).toBe(false);

		const loaded = load(Y.encodeStateAsUpdate(c.ydoc));

		// The entry is kept, not repaired away as dangling.
		expect(getDocumentLoadReport(loaded.doc)?.state).toBe("ok");
		expect(loaded.diagnostics).toEqual([]);
		expect(orderOf(loaded.doc)).toEqual(["x", "b1"]);

		// a's insert lands: the block is where b moved it, in no other array.
		Y.applyUpdate(loaded.doc.ydoc, Y.encodeStateAsUpdate(a.ydoc));
		expect(orderOf(loaded.doc)).toEqual(["x", "b1"]);
		expect(block(loaded.doc, "x").text).toBe("Fresh");
	});
});

describe("load repair on nested documents (DUR2, RI6)", () => {
	it("DUR2 RI6: children-array and parentId children at depth 2 load ok and unchanged", () => {
		const adapter = yjsAdapter();
		const source = seedNested(adapter);

		const { doc, diagnostics, recovered } = load(
			adapter.encodeState(source),
		);

		// also covers a container's inline title beside its children array
		// loading with no INVALID_BLOCK_STRUCTURE diagnostic
		expect(getDocumentLoadReport(doc)).toEqual({
			state: "ok",
			diagnostics: [],
		});
		expect(diagnostics).toEqual([]);
		expect(recovered).toEqual([]);
		expect(orderOf(doc)).toEqual(["top", "routed", "tail"]);
		expect(block(doc, "top").children).toEqual(["mid", "leaf-a"]);
		expect(block(doc, "mid").children).toEqual(["leaf-b"]);
		expect(doc.ydoc.getMap("blocks").toJSON()).toEqual(
			source.ydoc.getMap("blocks").toJSON(),
		);
	});

	it("DUR2: a genuinely orphaned block is re-homed once, with its children staying put", () => {
		const adapter = yjsAdapter();
		const source = seedNested(adapter);
		adapter.transact(source, () => {
			// a container in no array, holding a child: only the container is
			// unreachable; its child is placed through the container
			addContainer(source, "lost", "Lost").push(["lost-child"]);
			addBlock(source, "lost-child");
			// a parentId child whose order entry is gone: re-homed with its
			// parentId kept, which restores its route under `top`
			addBlock(source, "dropped", { props: { parentId: "top" } });
		});

		const first = load(adapter.encodeState(source));

		expect(getDocumentLoadReport(first.doc)?.state).toBe("repaired");
		expect(first.recovered).toEqual(["repair"]);
		expect(
			first.diagnostics.map(({ code, message }) => [code, message]),
		).toEqual(
			["dropped", "lost"].map((id) => [
				"ORPHAN_BLOCK",
				`Block '${id}' is in blocks map but in no blockOrder or children array`,
			]),
		);
		expect(orderOf(first.doc)).toEqual([
			"top",
			"routed",
			"tail",
			"dropped",
			"lost",
		]);
		expect(block(first.doc, "lost").children).toEqual(["lost-child"]);
		expect(block(first.doc, "dropped").prop("parentId")).toBe("top");

		// idempotent: the repaired state loads ok with nothing to repair
		const second = load(Y.encodeStateAsUpdate(first.doc.ydoc));
		expect(getDocumentLoadReport(second.doc)).toEqual({
			state: "ok",
			diagnostics: [],
		});
		expect(second.recovered).toEqual([]);
		expect(orderOf(second.doc)).toEqual(orderOf(first.doc));
	});

	it("DUR2 COL4: two peers loading the same orphaned state converge", () => {
		const adapter = yjsAdapter();
		const source = seedNested(adapter);
		adapter.transact(source, () => {
			addBlock(source, "zeta");
			addBlock(source, "alpha");
		});
		const bytes = adapter.encodeState(source);

		const a = load(bytes, 101);
		const b = load(bytes, 202);
		// each peer writes the same repair, in the same id order
		expect(orderOf(a.doc)).toEqual(orderOf(b.doc));
		expect(orderOf(a.doc).slice(-2)).toEqual(["alpha", "zeta"]);

		Y.applyUpdate(a.doc.ydoc, Y.encodeStateAsUpdate(b.doc.ydoc));
		Y.applyUpdate(b.doc.ydoc, Y.encodeStateAsUpdate(a.doc.ydoc));

		expect(a.doc.ydoc.getArray("blockOrder").toJSON()).toEqual(
			b.doc.ydoc.getArray("blockOrder").toJSON(),
		);
		expect(a.doc.ydoc.getMap("blocks").toJSON()).toEqual(
			b.doc.ydoc.getMap("blocks").toJSON(),
		);
		// nested children never joined the root order on either peer
		const merged = orderOf(a.doc);
		for (const nested of ["mid", "leaf-a", "leaf-b"]) {
			expect(merged).not.toContain(nested);
		}

		// the concurrent re-homes meet as duplicate entries, which the next
		// load removes, leaving each re-homed block once
		const reloaded = load(Y.encodeStateAsUpdate(a.doc.ydoc));
		expect(orderOf(reloaded.doc)).toEqual([
			"top",
			"routed",
			"tail",
			"alpha",
			"zeta",
		]);
	});
});
