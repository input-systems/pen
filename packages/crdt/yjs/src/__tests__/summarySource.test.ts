import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { yjsAdapter } from "../adapter";
import { initBlockMap } from "../document";
import type { YjsCRDTDocument } from "../document";
import {
	STRUCTURAL_ORIGIN_META_KEY,
	createSummarySource,
} from "../summarySource";
import type { RawCommitDelta } from "../summarySource";

function serializeDelta(delta: RawCommitDelta) {
	return {
		textDeltas: Object.fromEntries(delta.textDeltas),
		blockOrderDelta: delta.blockOrderDelta,
		childArrayDeltas: Object.fromEntries(delta.childArrayDeltas),
		blockMapChanges: Object.fromEntries(
			[...delta.blockMapChanges].map(([id, keys]) => [
				id,
				[...keys].sort(),
			]),
		),
		appChanges: [...delta.appChanges].sort(),
		metadataChanges: [...delta.metadataChanges].sort(),
	};
}

function seedDocument(doc: YjsCRDTDocument): void {
	doc.ydoc.transact(() => {
		initBlockMap(doc.penDocument.blocks, "b1", "paragraph", "inline");
		initBlockMap(doc.penDocument.blocks, "b2", "paragraph", "inline");
		initBlockMap(doc.penDocument.blocks, "parent", "column", "nested");
		doc.penDocument.blockOrder.push(["b1", "b2", "parent"]);
		const content = doc.penDocument.blocks
			.get("b1")!
			.get("content") as Y.Text;
		content.insert(0, "hello");
	});
}

describe("summarySource", () => {
	const adapter = yjsAdapter();

	it("converts a scripted transaction into RawCommitDelta", () => {
		const local = adapter.createDocument() as YjsCRDTDocument;
		seedDocument(local);

		const deltas: RawCommitDelta[] = [];
		const unsubscribe = createSummarySource(local, (delta) => {
			deltas.push(delta);
		});

		const origin = { type: "user", label: "scripted" };
		adapter.transact(
			local,
			() => {
				const b1 = local.penDocument.blocks.get("b1")!;
				(b1.get("content") as Y.Text).insert(5, " world");
				(b1.get("props") as Y.Map<unknown>).set("align", "left");

				initBlockMap(
					local.penDocument.blocks,
					"b3",
					"paragraph",
					"inline",
				);
				local.penDocument.blockOrder.delete(1, 1);
				local.penDocument.blockOrder.insert(0, ["b2"]);
				local.penDocument.blockOrder.push(["b3"]);

				const children = local.penDocument.blocks
					.get("parent")!
					.get("children") as Y.Array<string>;
				children.push(["b3"]);

				const app = new Y.Map<unknown>();
				app.set("type", "chart");
				local.penDocument.apps.set("app-1", app);
				local.penDocument.metadata.set("title", "Doc");
			},
			origin,
		);

		expect(deltas).toHaveLength(1);
		const delta = deltas[0];
		expect(delta.originTag).toBe(origin);
		expect(delta.textDeltas.get("b1")).toEqual([
			[{ retain: 5 }, { insert: " world" }],
		]);
		expect(
			delta.blockOrderDelta.some((op) => op.insert?.includes("b3")),
		).toBe(true);
		expect(delta.blockOrderDelta.some((op) => (op.delete ?? 0) > 0)).toBe(
			true,
		);
		expect(delta.childArrayDeltas.get("parent")).toEqual([
			{ insert: ["b3"] },
		]);
		expect(delta.blockMapChanges.has("b3")).toBe(true);
		expect(delta.blockMapChanges.get("b1")?.has("align")).toBe(true);
		expect(delta.appChanges.has("app-1")).toBe(true);
		expect(delta.metadataChanges.has("title")).toBe(true);

		unsubscribe();
	});

	it("reports the text of a block that arrived carrying content", () => {
		const doc = adapter.createDocument() as YjsCRDTDocument;
		seedDocument(doc);
		const deltas: RawCommitDelta[] = [];
		createSummarySource(doc, (delta) => {
			deltas.push(delta);
		});

		adapter.transact(doc, () => {
			initBlockMap(doc.penDocument.blocks, "b3", "paragraph", "inline");
			(doc.penDocument.blocks.get("b3")!.get("content") as Y.Text).insert(
				0,
				"meadow",
			);
			doc.penDocument.blockOrder.push(["b3"]);
		});

		expect(deltas).toHaveLength(1);
		expect(deltas[0]!.textDeltas.get("b3")).toEqual([
			[{ insert: "meadow" }],
		]);
	});

	it("reports the children array of a block that arrived carrying one", () => {
		const doc = adapter.createDocument() as YjsCRDTDocument;
		seedDocument(doc);
		const deltas: RawCommitDelta[] = [];
		createSummarySource(doc, (delta) => {
			deltas.push(delta);
		});

		adapter.transact(doc, () => {
			initBlockMap(doc.penDocument.blocks, "box", "column", "nested");
			initBlockMap(doc.penDocument.blocks, "c1", "paragraph", "inline");
			(
				doc.penDocument.blocks
					.get("box")!
					.get("children") as Y.Array<string>
			).push(["c1"]);
			doc.penDocument.blockOrder.push(["box"]);
		});

		expect(deltas).toHaveLength(1);
		// Yjs reports no delta for an array created inside the transaction.
		expect(deltas[0]!.childArrayDeltas.has("box")).toBe(false);
		expect(Object.fromEntries(deltas[0]!.arrivedChildArrays ?? [])).toEqual(
			{ box: ["c1"] },
		);
	});

	it("does not report a reordered block's existing text as an insert", () => {
		const doc = adapter.createDocument() as YjsCRDTDocument;
		seedDocument(doc);
		const deltas: RawCommitDelta[] = [];
		createSummarySource(doc, (delta) => {
			deltas.push(delta);
		});

		adapter.transact(doc, () => {
			doc.penDocument.blockOrder.delete(0, 1);
			doc.penDocument.blockOrder.push(["b1"]);
		});

		expect(deltas).toHaveLength(1);
		expect(deltas[0]!.textDeltas.has("b1")).toBe(false);
	});

	it("produces identical change sets for local transact and remote applyUpdate", () => {
		const local = adapter.createDocument() as YjsCRDTDocument;
		seedDocument(local);
		const remote = adapter.loadDocument(
			adapter.encodeState(local),
		) as YjsCRDTDocument;

		const localDeltas: RawCommitDelta[] = [];
		const remoteDeltas: RawCommitDelta[] = [];
		createSummarySource(local, (delta) => {
			localDeltas.push(delta);
		});
		createSummarySource(remote, (delta) => {
			remoteDeltas.push(delta);
		});

		const localOrigin = { type: "user", label: "local" };
		adapter.transact(
			local,
			() => {
				const b1 = local.penDocument.blocks.get("b1")!;
				(b1.get("content") as Y.Text).insert(5, " world");
				(b1.get("props") as Y.Map<unknown>).set("align", "left");

				initBlockMap(
					local.penDocument.blocks,
					"b3",
					"paragraph",
					"inline",
				);
				local.penDocument.blockOrder.delete(1, 1);
				local.penDocument.blockOrder.insert(0, ["b2"]);
				local.penDocument.blockOrder.push(["b3"]);

				const children = local.penDocument.blocks
					.get("parent")!
					.get("children") as Y.Array<string>;
				children.push(["b3"]);

				const app = new Y.Map<unknown>();
				app.set("type", "chart");
				local.penDocument.apps.set("app-1", app);
				local.penDocument.metadata.set("title", "Doc");
			},
			localOrigin,
		);

		const update = adapter.encodeUpdate(
			local,
			Y.encodeStateVector(remote.ydoc),
		);
		adapter.applyUpdate(remote, update);

		expect(localDeltas).toHaveLength(1);
		expect(remoteDeltas).toHaveLength(1);
		expect(serializeDelta(localDeltas[0])).toEqual(
			serializeDelta(remoteDeltas[0]),
		);
		expect(localDeltas[0].originTag).toBe(localOrigin);
		expect(remoteDeltas[0].originTag).not.toEqual(localDeltas[0].originTag);
	});

	it("installs one afterTransaction observer per document", () => {
		const doc = adapter.createDocument() as YjsCRDTDocument;
		const first: RawCommitDelta[] = [];
		const second: RawCommitDelta[] = [];
		const unsubscribeFirst = createSummarySource(doc, (delta) => {
			first.push(delta);
		});
		const unsubscribeSecond = createSummarySource(doc, (delta) => {
			second.push(delta);
		});

		const afterTransactionCount = (
			doc.ydoc as unknown as {
				_observers?: Map<string, Set<unknown>>;
			}
		)._observers?.get("afterTransaction")?.size;

		adapter.transact(doc, () => {
			doc.penDocument.metadata.set("note", "once");
		});

		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
		expect(afterTransactionCount).toBe(1);

		unsubscribeFirst();
		unsubscribeSecond();
	});

	it("folds executor structural metadata into originTag", () => {
		const doc = adapter.createDocument() as YjsCRDTDocument;
		seedDocument(doc);
		const deltas: RawCommitDelta[] = [];
		createSummarySource(doc, (delta) => {
			deltas.push(delta);
		});

		const structural = {
			kind: "split" as const,
			blockId: "b1",
			newBlockId: "b2",
			offset: 3,
		};
		doc.ydoc.transact((txn) => {
			txn.meta.set(STRUCTURAL_ORIGIN_META_KEY, structural);
			(doc.penDocument.blocks.get("b1")!.get("content") as Y.Text).insert(
				5,
				"!",
			);
		}, "user");

		expect(deltas).toHaveLength(1);
		expect(deltas[0].originTag).toEqual({
			type: "user",
			structural,
		});
	});

	it("keeps both cell Y.Text deltas when they share a table block key", () => {
		const doc = adapter.createDocument() as YjsCRDTDocument;
		doc.ydoc.transact(() => {
			initBlockMap(doc.penDocument.blocks, "t1", "table", "table");
			doc.penDocument.blockOrder.push(["t1"]);
		});

		const deltas: RawCommitDelta[] = [];
		createSummarySource(doc, (delta) => {
			deltas.push(delta);
		});

		const north = cellText(doc, "t1", 0, 0);
		const south = cellText(doc, "t1", 1, 1);

		adapter.transact(doc, () => {
			north.insert(0, "meadow");
			south.insert(0, "sage-brush");
		});

		expect(deltas).toHaveLength(1);
		const tableDeltas = deltas[0]!.textDeltas.get("t1");
		expect(tableDeltas).toHaveLength(2);
		expect(tableDeltas).toEqual(
			expect.arrayContaining([
				[{ insert: "meadow" }],
				[{ insert: "sage-brush" }],
			]),
		);
	});
});

function cellText(
	doc: YjsCRDTDocument,
	blockId: string,
	row: number,
	col: number,
): Y.Text {
	const tableContent = doc.penDocument.blocks
		.get(blockId)!
		.get("tableContent") as Y.Array<Y.Map<unknown>>;
	const cells = tableContent.get(row).get("cells") as Y.Array<Y.Map<unknown>>;
	return cells.get(col).get("content") as Y.Text;
}
