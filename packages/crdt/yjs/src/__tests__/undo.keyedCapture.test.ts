import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { CRDTUndoCaptureKey } from "@input/pen-types";
import { yjsAdapter } from "../adapter";
import { createYjsDocument, initBlockMap } from "../document";
import { createYjsUndoManager } from "../undo";

const G: CRDTUndoCaptureKey = { key: "group:g1", explicit: true };
const U: CRDTUndoCaptureKey = { key: "origin:user", explicit: false };

function setup(options?: { captureTimeout?: number; maxDepth?: number }) {
	const doc = createYjsDocument(yjsAdapter());
	doc.ydoc.transact(() => {
		initBlockMap(doc.penDocument.blocks, "b1", "paragraph", "inline");
		doc.penDocument.blockOrder.push(["b1"]);
	});
	const undo = createYjsUndoManager(doc, {
		trackedOriginTypes: ["user", "ai"],
		...options,
	});
	const ytext = doc.penDocument.blocks.get("b1")!.get("content") as Y.Text;
	const write = (key: CRDTUndoCaptureKey, text: string) => {
		undo.setCaptureKey?.(key);
		doc.ydoc.transact(() => {
			ytext.insert(ytext.length, text);
		}, "user");
		undo.setCaptureKey?.(null);
	};
	return { undo, ytext, write };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("keyed undo capture (AIB4)", () => {
	it("AIB4: transactions under one explicit key form one stack item across other keys' writes", () => {
		const { undo, ytext, write } = setup();
		write(G, "a");
		write(U, "b");
		write(G, "c");
		expect(ytext.toString()).toBe("abc");

		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("b");
		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("");
		expect(undo.canUndo()).toBe(false);
	});

	it("AIB4: a non-explicit key merges only inside its capture window", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const { undo, ytext, write } = setup({ captureTimeout: 400 });
		write(U, "a");
		vi.setSystemTime(1_000_100);
		write(U, "b");
		vi.setSystemTime(1_000_600);
		write(U, "c");

		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("ab");
		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("");
	});

	it("AIB4: a non-explicit key never merges across another key's item", () => {
		const { undo, ytext, write } = setup({ captureTimeout: 10_000 });
		write(U, "a");
		write(G, "b");
		write(U, "c");

		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("ab");
		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("a");
		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("");
	});

	it("AIB4: stopCapturing closes non-explicit keys and leaves explicit keys open", () => {
		const { undo, ytext, write } = setup({ captureTimeout: 10_000 });
		write(G, "a");
		write(U, "b");
		undo.stopCapturing();
		write(U, "c");
		write(G, "d");

		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("bc");
		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("b");
		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("");
	});

	it("AIB4: undo and redo close every open key", () => {
		const { undo, ytext, write } = setup();
		write(G, "a");
		write(G, "b");
		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("");
		write(G, "c");
		write(G, "d");
		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("");
		expect(undo.canUndo()).toBe(false);
	});

	it("CH7: maxDepth trims after a keyed merge and drops trimmed open items", () => {
		const { undo, ytext, write } = setup({ maxDepth: 2 });
		const other = (n: number): CRDTUndoCaptureKey => ({
			key: `group:other-${n}`,
			explicit: true,
		});
		write(G, "a");
		write(other(1), "b");
		write(other(2), "c");
		// G's item was trimmed; a new G write starts a fresh item.
		write(G, "d");

		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("abc");
		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("ab");
		expect(undo.canUndo()).toBe(false);
	});

	it("AIB4: a structured origin with a groupId captures by group when no key is declared", () => {
		const doc = createYjsDocument(yjsAdapter());
		doc.ydoc.transact(() => {
			initBlockMap(doc.penDocument.blocks, "b1", "paragraph", "inline");
			doc.penDocument.blockOrder.push(["b1"]);
		});
		const undo = createYjsUndoManager(doc, { trackedOriginTypes: ["user", "ai"] });
		const ytext = doc.penDocument.blocks.get("b1")!.get("content") as Y.Text;
		const origin = { type: "ai", groupId: "g9" };
		doc.ydoc.transact(() => ytext.insert(0, "a"), origin);
		doc.ydoc.transact(() => ytext.insert(1, "b"), "user");
		doc.ydoc.transact(() => ytext.insert(2, "c"), origin);

		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("b");
	});
});
