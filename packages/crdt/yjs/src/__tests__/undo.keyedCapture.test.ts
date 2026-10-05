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
	const step = (key: CRDTUndoCaptureKey, run: () => void) => {
		undo.setCaptureKey?.(key);
		doc.ydoc.transact(run, "user");
		undo.setCaptureKey?.(null);
	};
	const write = (key: CRDTUndoCaptureKey, text: string) =>
		step(key, () => ytext.insert(ytext.length, text));
	/** Undoes until the stack is empty, returning the text after each step. */
	const undoTrail = (): string[] => {
		const seen: string[] = [];
		while (undo.undo()) seen.push(ytext.toString());
		return seen;
	};
	return { doc, undo, ytext, step, write, undoTrail };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("keyed undo capture (AIB4)", () => {
	it("AIB4: transactions under one explicit key form one stack item across other keys' writes", () => {
		const { ytext, write, undoTrail } = setup();
		write(G, "a");
		write(U, "b");
		write(G, "c");
		expect(ytext.toString()).toBe("abc");
		expect(undoTrail()).toEqual(["b", ""]);
	});

	it("AIB4: a non-explicit key merges only inside its capture window", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const { write, undoTrail } = setup({ captureTimeout: 400 });
		write(U, "a");
		vi.setSystemTime(1_000_100);
		write(U, "b");
		vi.setSystemTime(1_000_600);
		write(U, "c");
		expect(undoTrail()).toEqual(["ab", ""]);
	});

	it("AIB4: a non-explicit key never merges across another key's item", () => {
		const { write, undoTrail } = setup({ captureTimeout: 10_000 });
		write(U, "a");
		write(G, "b");
		write(U, "c");
		expect(undoTrail()).toEqual(["ab", "a", ""]);
	});

	it("AIB4: stopCapturing closes non-explicit keys and leaves explicit keys open", () => {
		const { undo, write, undoTrail } = setup({ captureTimeout: 10_000 });
		write(G, "a");
		write(U, "b");
		undo.stopCapturing();
		write(U, "c");
		write(G, "d");
		expect(undoTrail()).toEqual(["bc", "b", ""]);
	});

	it("AIB4: undo and redo close every open key", () => {
		const { write, undoTrail } = setup();
		write(G, "a");
		write(G, "b");
		expect(undoTrail()).toEqual([""]);
		write(G, "c");
		write(G, "d");
		expect(undoTrail()).toEqual([""]);
	});

	it("CH7: maxDepth trims after a keyed merge and drops trimmed open items", () => {
		const { write, undoTrail } = setup({ maxDepth: 2 });
		const other = (n: number): CRDTUndoCaptureKey => ({
			key: `group:other-${n}`,
			explicit: true,
		});
		write(G, "a");
		write(other(1), "b");
		write(other(2), "c");
		// G's item was trimmed; a new G write starts a fresh item.
		write(G, "d");
		expect(undoTrail()).toEqual(["abc", "ab"]);
	});

	it("AIB4: a structured origin with a groupId captures by group when no key is declared", () => {
		const { doc, undo, ytext } = setup();
		const origin = { type: "ai", groupId: "g9" };
		doc.ydoc.transact(() => ytext.insert(0, "a"), origin);
		doc.ydoc.transact(() => ytext.insert(1, "b"), "user");
		doc.ydoc.transact(() => ytext.insert(2, "c"), origin);

		expect(undo.undo()).toBe(true);
		expect(ytext.toString()).toBe("b");
	});

	it("AIB4: a group write after a user edit that deletes the group's text starts a new step instead of resurrecting it", () => {
		const { undo, ytext, step, write, undoTrail } = setup();
		step(U, () => ytext.insert(0, "Base"));
		undo.stopCapturing();
		write(G, " AI");
		step(U, () => ytext.delete(4, 3));
		write(G, " more");
		expect(ytext.toString()).toBe("Base more");
		expect(undoTrail()).toEqual(["Base", "Base AI", "Base", ""]);
	});

	it("AIB4: a group write after user typing elsewhere in the text still joins the group's one step", () => {
		const { undo, ytext, step, undoTrail } = setup();
		step(U, () => ytext.insert(0, "Base"));
		undo.stopCapturing();
		step(G, () => ytext.insert(4, " AI"));
		step(U, () => ytext.insert(0, "x"));
		step(G, () => ytext.insert(ytext.length, " more"));
		expect(ytext.toString()).toBe("xBase AI more");
		expect(undoTrail()).toEqual(["xBase", "Base", ""]);
	});
});
