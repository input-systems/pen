import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { yjsAdapter } from "../adapter";
import type { CRDTDiagnostic } from "../adapter";
import {
	BLOCK_ORDER,
	BLOCKS,
	createYjsDocument,
	initBlockMap,
	validateDocument,
} from "../document";
import type { YjsCRDTDocument } from "../document";

describe("CRDT integrity", () => {
	describe("validateDocument", () => {
		it("valid document passes all checks", () => {
			const adapter = yjsAdapter();
			const doc = createYjsDocument(adapter);
			doc.ydoc.transact(() => {
				initBlockMap(
					doc.penDocument.blocks,
					"b1",
					"paragraph",
					"inline",
				);
				doc.penDocument.blockOrder.push(["b1"]);
			});

			const result = validateDocument(doc.ydoc);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.repaired).toBe(false);
		});

		it("detects block missing type key", () => {
			const ydoc = new Y.Doc();
			const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
			const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);
			ydoc.getMap("apps");
			ydoc.getMap("metadata");

			ydoc.transact(() => {
				const malformed = new Y.Map<unknown>();
				malformed.set("props", new Y.Map<unknown>());
				malformed.set("meta", new Y.Map<unknown>());
				blocks.set("bad-block", malformed);
				blockOrder.push(["bad-block"]);
			});

			const result = validateDocument(ydoc);
			expect(result.valid).toBe(false);
			const typeErrors = result.errors.filter(
				(e) =>
					e.code === "MISSING_BLOCK_MAP_KEY" &&
					e.blockId === "bad-block",
			);
			expect(typeErrors.length).toBeGreaterThan(0);
		});

		it("detects block missing props key", () => {
			const ydoc = new Y.Doc();
			const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
			const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);
			ydoc.getMap("apps");
			ydoc.getMap("metadata");

			ydoc.transact(() => {
				const malformed = new Y.Map<unknown>();
				malformed.set("type", "paragraph");
				malformed.set("meta", new Y.Map<unknown>());
				malformed.set("content", new Y.Text());
				blocks.set("no-props", malformed);
				blockOrder.push(["no-props"]);
			});

			const result = validateDocument(ydoc);
			expect(result.valid).toBe(false);
			const propsErrors = result.errors.filter(
				(e) =>
					e.code === "MISSING_BLOCK_MAP_KEY" &&
					e.blockId === "no-props",
			);
			expect(propsErrors.length).toBeGreaterThan(0);
		});

		it("detects block missing meta key", () => {
			const ydoc = new Y.Doc();
			const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
			const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);
			ydoc.getMap("apps");
			ydoc.getMap("metadata");

			ydoc.transact(() => {
				const malformed = new Y.Map<unknown>();
				malformed.set("type", "paragraph");
				malformed.set("props", new Y.Map<unknown>());
				malformed.set("content", new Y.Text());
				blocks.set("no-meta", malformed);
				blockOrder.push(["no-meta"]);
			});

			const result = validateDocument(ydoc);
			expect(result.valid).toBe(false);
			const metaErrors = result.errors.filter(
				(e) =>
					e.code === "MISSING_BLOCK_MAP_KEY" &&
					e.blockId === "no-meta",
			);
			expect(metaErrors.length).toBeGreaterThan(0);
		});

		it("detects multiple content keys", () => {
			const ydoc = new Y.Doc();
			const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
			const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);
			ydoc.getMap("apps");
			ydoc.getMap("metadata");

			ydoc.transact(() => {
				const malformed = new Y.Map<unknown>();
				malformed.set("type", "paragraph");
				malformed.set("props", new Y.Map<unknown>());
				malformed.set("meta", new Y.Map<unknown>());
				malformed.set("content", new Y.Text());
				malformed.set("tableContent", new Y.Array<Y.Map<unknown>>());
				blocks.set("multi-content", malformed);
				blockOrder.push(["multi-content"]);
			});

			const result = validateDocument(ydoc);
			const structErrors = result.errors.filter(
				(e) =>
					e.code === "INVALID_BLOCK_STRUCTURE" &&
					e.blockId === "multi-content",
			);
			expect(structErrors.length).toBeGreaterThan(0);
		});

		it("DUR2 RI6: accepts an inline title beside a children array", () => {
			const ydoc = new Y.Doc();
			const blockOrder = ydoc.getArray<string>("blockOrder");
			const blocks = ydoc.getMap<Y.Map<unknown>>("blocks");
			ydoc.getMap("apps");
			ydoc.getMap("metadata");

			ydoc.transact(() => {
				const container = new Y.Map<unknown>();
				container.set("type", "toggle");
				container.set("props", new Y.Map<unknown>());
				container.set("meta", new Y.Map<unknown>());
				container.set("content", new Y.Text());
				container.set("children", new Y.Array<string>());
				blocks.set("titled-container", container);
				blockOrder.push(["titled-container"]);
			});

			expect(validateDocument(ydoc)).toEqual({
				valid: true,
				errors: [],
				repaired: false,
			});
		});

		it("detects orphan blocks (in blocks but not blockOrder)", () => {
			const adapter = yjsAdapter();
			const doc = createYjsDocument(adapter);
			doc.ydoc.transact(() => {
				initBlockMap(
					doc.penDocument.blocks,
					"b1",
					"paragraph",
					"inline",
				);
				initBlockMap(
					doc.penDocument.blocks,
					"orphan",
					"paragraph",
					"inline",
				);
				doc.penDocument.blockOrder.push(["b1"]);
			});

			const result = validateDocument(doc.ydoc);
			expect(result.valid).toBe(true);
			const orphanWarns = result.errors.filter(
				(e) => e.code === "ORPHAN_BLOCK" && e.blockId === "orphan",
			);
			expect(orphanWarns.length).toBeGreaterThan(0);
			expect(orphanWarns[0].severity).toBe("warning");
		});

		it("repairs orphan blocks when repair: true", () => {
			const adapter = yjsAdapter();
			const doc = createYjsDocument(adapter);
			doc.ydoc.transact(() => {
				initBlockMap(
					doc.penDocument.blocks,
					"b1",
					"paragraph",
					"inline",
				);
				initBlockMap(
					doc.penDocument.blocks,
					"orphan",
					"paragraph",
					"inline",
				);
				doc.penDocument.blockOrder.push(["b1"]);
			});

			const result = validateDocument(doc.ydoc, { repair: true });
			expect(result.repaired).toBe(true);
			expect(doc.penDocument.blockOrder.toArray()).toContain("orphan");
		});

		it("detects duplicate IDs in blockOrder", () => {
			const adapter = yjsAdapter();
			const doc = createYjsDocument(adapter);
			doc.ydoc.transact(() => {
				initBlockMap(
					doc.penDocument.blocks,
					"b1",
					"paragraph",
					"inline",
				);
				doc.penDocument.blockOrder.push(["b1", "b1"]);
			});

			const result = validateDocument(doc.ydoc);
			const dupWarns = result.errors.filter(
				(e) => e.code === "DUPLICATE_BLOCK_ORDER" && e.blockId === "b1",
			);
			expect(dupWarns.length).toBeGreaterThan(0);
		});

		it("repairs duplicate IDs when repair: true (keeps first occurrence)", () => {
			const adapter = yjsAdapter();
			const doc = createYjsDocument(adapter);
			doc.ydoc.transact(() => {
				initBlockMap(
					doc.penDocument.blocks,
					"b1",
					"paragraph",
					"inline",
				);
				initBlockMap(
					doc.penDocument.blocks,
					"b2",
					"paragraph",
					"inline",
				);
				doc.penDocument.blockOrder.push(["b1", "b2", "b1"]);
			});

			const result = validateDocument(doc.ydoc, { repair: true });
			expect(result.repaired).toBe(true);

			const order = doc.penDocument.blockOrder.toArray();
			const b1Count = order.filter((id) => id === "b1").length;
			expect(b1Count).toBe(1);
			expect(order.indexOf("b1")).toBeLessThan(order.indexOf("b2"));
		});

		it("detects dangling references in blockOrder", () => {
			const ydoc = new Y.Doc();
			ydoc.getMap("apps");
			ydoc.getMap("metadata");
			const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
			const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);

			ydoc.transact(() => {
				const b1 = new Y.Map<unknown>();
				b1.set("type", "paragraph");
				b1.set("props", new Y.Map<unknown>());
				b1.set("meta", new Y.Map<unknown>());
				b1.set("content", new Y.Text());
				blocks.set("b1", b1);
				blocks.set("ghost", new Y.Map<unknown>());
				blockOrder.push(["b1", "ghost"]);
			});
			// Only a deleted block map makes its entry dangling (COL4).
			blocks.delete("ghost");

			const result = validateDocument(ydoc);
			const danglingWarns = result.errors.filter(
				(e) => e.code === "ORPHAN_BLOCK" && e.blockId === "ghost",
			);
			expect(danglingWarns.length).toBeGreaterThan(0);
		});

		it("repairs dangling references when repair: true", () => {
			const ydoc = new Y.Doc();
			ydoc.getMap("apps");
			ydoc.getMap("metadata");
			const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
			const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);

			ydoc.transact(() => {
				const b1 = new Y.Map<unknown>();
				b1.set("type", "paragraph");
				b1.set("props", new Y.Map<unknown>());
				b1.set("meta", new Y.Map<unknown>());
				b1.set("content", new Y.Text());
				blocks.set("b1", b1);
				blocks.set("ghost", new Y.Map<unknown>());
				blockOrder.push(["b1", "ghost"]);
			});
			// Only a deleted block map makes its entry dangling (COL4).
			blocks.delete("ghost");

			const result = validateDocument(ydoc, { repair: true });
			expect(result.repaired).toBe(true);
			expect(blockOrder.toArray()).toEqual(["b1"]);
		});

		it("COL4: keeps an entry whose block map was never received", () => {
			const ydoc = new Y.Doc();
			ydoc.getMap("apps");
			ydoc.getMap("metadata");
			const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
			const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);

			ydoc.transact(() => {
				initBlockMap(blocks, "b1", "paragraph", "inline");
				blockOrder.push(["b1", "in-flight"]);
			});

			const result = validateDocument(ydoc, { repair: true });
			expect(result.repaired).toBe(false);
			expect(
				result.errors.filter((e) => e.blockId === "in-flight"),
			).toEqual([]);
			expect(blockOrder.toArray()).toEqual(["b1", "in-flight"]);
		});
	});

	describe("applyUpdate error handling", () => {
		it("does NOT throw on malformed binary", () => {
			const diagnostics: CRDTDiagnostic[] = [];
			const adapter = yjsAdapter({
				onDiagnostic: (d) => diagnostics.push(d),
			});

			const doc = adapter.createDocument();
			const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 255, 254, 253]);

			expect(() => adapter.applyUpdate(doc, garbage)).not.toThrow();
			expect(diagnostics.length).toBeGreaterThan(0);
			expect(diagnostics[0].code).toBe("MALFORMED_UPDATE");
			expect(diagnostics[0].severity).toBe("error");
		});

		it("document remains functional after dropped update", () => {
			const adapter = yjsAdapter({ onDiagnostic: () => {} });

			const doc = adapter.createDocument() as YjsCRDTDocument;
			doc.ydoc.transact(() => {
				initBlockMap(
					doc.penDocument.blocks,
					"b1",
					"paragraph",
					"inline",
				);
				doc.penDocument.blockOrder.push(["b1"]);
			});

			const garbage = new Uint8Array([255, 254, 253, 252]);
			adapter.applyUpdate(doc, garbage);

			doc.ydoc.transact(() => {
				const text = doc.penDocument.blocks
					.get("b1")!
					.get("content") as Y.Text;
				text.insert(0, "Still works");
			}, "user");

			const text = doc.penDocument.blocks
				.get("b1")!
				.get("content") as Y.Text;
			expect(text.toString()).toBe("Still works");
		});
	});

	describe("loadDocument validation", () => {
		it("valid binary passes and loads correctly", () => {
			const adapter = yjsAdapter();
			const doc = adapter.createDocument() as YjsCRDTDocument;
			doc.ydoc.transact(() => {
				initBlockMap(
					doc.penDocument.blocks,
					"b1",
					"paragraph",
					"inline",
				);
				doc.penDocument.blockOrder.push(["b1"]);
			});

			const binary = adapter.encodeState(doc);
			const loaded = adapter.loadDocument(binary) as YjsCRDTDocument;

			expect(loaded.penDocument.blockOrder.toArray()).toEqual(["b1"]);
			expect(loaded.penDocument.blocks.has("b1")).toBe(true);
		});

		it("emits a named diagnostic for invalid document on load", () => {
			const diagnostics: CRDTDiagnostic[] = [];
			const adapter = yjsAdapter({
				onDiagnostic: (d) => diagnostics.push(d),
			});

			// Create a doc with a malformed block (no type key)
			const ydoc = new Y.Doc();
			ydoc.transact(() => {
				const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
				const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);
				const bad = new Y.Map<unknown>();
				bad.set("props", new Y.Map<unknown>());
				bad.set("meta", new Y.Map<unknown>());
				blocks.set("bad", bad);
				blockOrder.push(["bad"]);
			});

			const binary = Y.encodeStateAsUpdate(ydoc);
			adapter.loadDocument(binary);

			expect(diagnostics.length).toBeGreaterThan(0);
			expect(diagnostics[0].code).toBe("MISSING_BLOCK_MAP_KEY");
		});

		it("empty document loads without validation errors", () => {
			const diagnostics: CRDTDiagnostic[] = [];
			const adapter = yjsAdapter({
				onDiagnostic: (d) => diagnostics.push(d),
			});

			const ydoc = new Y.Doc();
			const binary = Y.encodeStateAsUpdate(ydoc);
			adapter.loadDocument(binary);

			expect(diagnostics).toEqual([]);
		});
	});

	describe("shared type mismatch detection", () => {
		it("detects when blocks shared type is the wrong Yjs type", () => {
			const ydoc = new Y.Doc();
			// Force 'blocks' to be created as Y.Array instead of Y.Map
			ydoc.getArray(BLOCKS);
			ydoc.getMap("apps");
			ydoc.getMap("metadata");
			ydoc.getArray(BLOCK_ORDER);

			const result = validateDocument(ydoc);
			expect(result.valid).toBe(false);
			const missingType = result.errors.filter(
				(e) => e.code === "MISSING_SHARED_TYPE",
			);
			expect(missingType.length).toBeGreaterThan(0);
			expect(missingType[0].message).toContain("blocks");
		});
	});

	describe("recovery from snapshot", () => {
		it("given a corrupt doc and valid snapshot, produces clean doc", () => {
			const adapter = yjsAdapter({ gc: false });
			const doc = adapter.createDocument() as YjsCRDTDocument;
			doc.ydoc.transact(() => {
				initBlockMap(
					doc.penDocument.blocks,
					"b1",
					"paragraph",
					"inline",
				);
				doc.penDocument.blockOrder.push(["b1"]);
				const text = doc.penDocument.blocks
					.get("b1")!
					.get("content") as Y.Text;
				text.insert(0, "Good state");
			});

			const snapshot = adapter.createSnapshot(doc);

			// Corrupt the doc: add a malformed block with no type key
			doc.ydoc.transact(() => {
				const malformed = new Y.Map<unknown>();
				malformed.set("props", new Y.Map<unknown>());
				doc.penDocument.blocks.set("bad", malformed);
				doc.penDocument.blockOrder.push(["bad"]);
			});

			const corruptValidation = validateDocument(doc.ydoc);
			expect(corruptValidation.valid).toBe(false);

			// Recover via snapshot
			const restored = adapter.restoreSnapshot(
				doc,
				snapshot,
			) as YjsCRDTDocument;
			const restoredValidation = validateDocument(restored.ydoc);
			expect(restoredValidation.valid).toBe(true);
			expect(restored.penDocument.blockOrder.toArray()).toEqual(["b1"]);
			const text = restored.penDocument.blocks
				.get("b1")!
				.get("content") as Y.Text;
			expect(text.toString()).toBe("Good state");
		});
	});
});
