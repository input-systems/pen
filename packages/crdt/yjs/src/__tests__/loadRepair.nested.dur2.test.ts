import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { yjsAdapter } from "../adapter";
import type { CRDTDiagnostic } from "../adapter";
import { initBlockMap } from "../document";
import type { YjsCRDTDocument } from "../document";
import { getDocumentLoadReport } from "../loadDocument";
import type { RecoveredMethod } from "../loadDocument";

type Adapter = ReturnType<typeof yjsAdapter>;

/** A container with an inline title beside its children, `toggle`'s shape. */
function addContainer(
	doc: YjsCRDTDocument,
	blockId: string,
	title: string,
): Y.Array<string> {
	const blockMap = initBlockMap(
		doc.penDocument.blocks,
		blockId,
		"toggle",
		"inline",
	);
	(blockMap.get("content") as Y.Text).insert(0, title);
	const children = new Y.Array<string>();
	blockMap.set("children", children);
	return children;
}

function addParagraph(
	doc: YjsCRDTDocument,
	blockId: string,
	props: Record<string, unknown> = {},
): void {
	const blockMap = initBlockMap(
		doc.penDocument.blocks,
		blockId,
		"paragraph",
		"inline",
	);
	const propsMap = blockMap.get("props") as Y.Map<unknown>;
	for (const [key, value] of Object.entries(props)) {
		propsMap.set(key, value);
	}
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
		addParagraph(doc, "leaf-a");
		addParagraph(doc, "leaf-b");
		addParagraph(doc, "routed", { parentId: "top" });
		addParagraph(doc, "tail");
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

function childrenOf(doc: YjsCRDTDocument, blockId: string): unknown[] {
	return (
		doc.penDocument.blocks.get(blockId)?.get("children") as Y.Array<string>
	).toArray();
}

describe("load repair on nested documents (DUR2, RI6)", () => {
	it("DUR2 RI6: children-array and parentId children at depth 2 load ok and unchanged", () => {
		const adapter = yjsAdapter();
		const source = seedNested(adapter);
		const bytes = adapter.encodeState(source);

		const { doc, diagnostics, recovered } = load(bytes);

		expect(getDocumentLoadReport(doc)).toEqual({
			state: "ok",
			diagnostics: [],
		});
		expect(diagnostics).toEqual([]);
		expect(recovered).toEqual([]);
		expect(doc.penDocument.blockOrder.toArray()).toEqual([
			"top",
			"routed",
			"tail",
		]);
		expect(childrenOf(doc, "top")).toEqual(["mid", "leaf-a"]);
		expect(childrenOf(doc, "mid")).toEqual(["leaf-b"]);
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
			const lostChildren = addContainer(source, "lost", "Lost");
			addParagraph(source, "lost-child");
			lostChildren.push(["lost-child"]);
			// a parentId child whose order entry is gone: re-homed with its
			// parentId kept, which restores its route under `top`
			addParagraph(source, "dropped", { parentId: "top" });
		});

		const first = load(adapter.encodeState(source));

		expect(getDocumentLoadReport(first.doc)?.state).toBe("repaired");
		expect(first.recovered).toEqual(["repair"]);
		expect(
			first.diagnostics.map(({ code, message }) => [code, message]),
		).toEqual([
			[
				"ORPHAN_BLOCK",
				"Block 'dropped' is in blocks map but in no blockOrder or children array",
			],
			[
				"ORPHAN_BLOCK",
				"Block 'lost' is in blocks map but in no blockOrder or children array",
			],
		]);
		expect(first.doc.penDocument.blockOrder.toArray()).toEqual([
			"top",
			"routed",
			"tail",
			"dropped",
			"lost",
		]);
		expect(childrenOf(first.doc, "lost")).toEqual(["lost-child"]);
		expect(
			(
				first.doc.penDocument.blocks
					.get("dropped")
					?.get("props") as Y.Map<unknown>
			).get("parentId"),
		).toBe("top");

		// idempotent: the repaired state loads ok with nothing to repair
		const second = load(Y.encodeStateAsUpdate(first.doc.ydoc));
		expect(getDocumentLoadReport(second.doc)).toEqual({
			state: "ok",
			diagnostics: [],
		});
		expect(second.recovered).toEqual([]);
		expect(second.doc.penDocument.blockOrder.toArray()).toEqual(
			first.doc.penDocument.blockOrder.toArray(),
		);
	});

	it("DUR2 COL4: two peers loading the same orphaned state converge", () => {
		const adapter = yjsAdapter();
		const source = seedNested(adapter);
		adapter.transact(source, () => {
			addParagraph(source, "zeta");
			addParagraph(source, "alpha");
		});
		const bytes = adapter.encodeState(source);

		const a = load(bytes, 101);
		const b = load(bytes, 202);
		// each peer writes the same repair, in the same id order
		expect(a.doc.penDocument.blockOrder.toArray()).toEqual(
			b.doc.penDocument.blockOrder.toArray(),
		);
		expect(a.doc.penDocument.blockOrder.toArray().slice(-2)).toEqual([
			"alpha",
			"zeta",
		]);

		Y.applyUpdate(a.doc.ydoc, Y.encodeStateAsUpdate(b.doc.ydoc));
		Y.applyUpdate(b.doc.ydoc, Y.encodeStateAsUpdate(a.doc.ydoc));

		expect(a.doc.ydoc.getArray("blockOrder").toJSON()).toEqual(
			b.doc.ydoc.getArray("blockOrder").toJSON(),
		);
		expect(a.doc.ydoc.getMap("blocks").toJSON()).toEqual(
			b.doc.ydoc.getMap("blocks").toJSON(),
		);
		// nested children never joined the root order on either peer
		const merged = a.doc.penDocument.blockOrder.toArray();
		for (const nested of ["mid", "leaf-a", "leaf-b"]) {
			expect(merged).not.toContain(nested);
		}

		// the concurrent re-homes meet as duplicate entries, which the next
		// load removes, leaving each re-homed block once
		const reloaded = load(Y.encodeStateAsUpdate(a.doc.ydoc));
		expect(reloaded.doc.penDocument.blockOrder.toArray()).toEqual([
			"top",
			"routed",
			"tail",
			"alpha",
			"zeta",
		]);
	});
});
