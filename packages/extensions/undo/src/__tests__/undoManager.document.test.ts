import { yjsAdapter, type YjsCRDTDocument } from "@input/pen-yjs";
import type { CRDTAdapter, OpOrigin } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { getOpOriginType } from "../origin";
import { UndoManagerImpl } from "../undoManager";

const DEFAULT_TRACKED_ORIGINS: OpOrigin[] = ["user", "ai", "import"];

function createSession(options?: {
	maxDepth?: number;
	trackedOrigins?: OpOrigin[];
}) {
	const adapter = yjsAdapter();
	const doc = adapter.createDocument() as YjsCRDTDocument;
	doc.ydoc.clientID = 1;

	adapter.transact(
		doc,
		() => {
			adapter.initBlockMap(doc, "user-block", "paragraph", "inline");
			adapter.initBlockMap(doc, "other-block", "paragraph", "inline");
			doc.penDocument.blockOrder.push(["user-block", "other-block"]);
		},
		"system",
	);

	const trackedOrigins = options?.trackedOrigins ?? DEFAULT_TRACKED_ORIGINS;
	const crdtUndo = adapter.createUndoManager(doc, {
		trackedOriginTypes: trackedOrigins.map(getOpOriginType),
		captureTimeout: 0,
		maxDepth: options?.maxDepth,
	});
	const manager = new UndoManagerImpl(crdtUndo, trackedOrigins);
	manager.setGroupTimeout(0);

	return { adapter, doc, manager };
}

function blockText(doc: YjsCRDTDocument, blockId: string): string {
	const content = doc.penDocument.blocks.get(blockId)?.get("content");
	if (!(content instanceof Y.Text)) {
		throw new Error(`block ${blockId} has no text`);
	}
	return content.toString();
}

function insertText(
	adapter: CRDTAdapter,
	doc: YjsCRDTDocument,
	blockId: string,
	text: string,
	origin: unknown = { type: "user" },
): void {
	adapter.transact(
		doc,
		() => {
			const content = doc.penDocument.blocks.get(blockId)?.get("content");
			if (!(content instanceof Y.Text)) {
				throw new Error(`block ${blockId} has no text`);
			}
			content.insert(content.length, text);
		},
		origin,
	);
}

describe("@input/pen-undo document state", () => {
	it("undo restores prior document text and redo restores the edit", () => {
		const { adapter, doc, manager } = createSession();

		insertText(adapter, doc, "user-block", "Hello");
		expect(blockText(doc, "user-block")).toBe("Hello");

		expect(manager.undo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("");

		expect(manager.redo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("Hello");
	});

	it("ops that share a groupId collapse to one undo step", () => {
		const { adapter, doc, manager } = createSession();

		const write = (text: string) =>
			manager.withCapture("user", "turn-1", () =>
				insertText(adapter, doc, "user-block", text),
			);
		write("Hello");
		write(" world");
		expect(blockText(doc, "user-block")).toBe("Hello world");

		expect(manager.undo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("");
		expect(manager.canUndo()).toBe(false);
	});

	it("ops without a groupId stay separate undo steps", () => {
		const { adapter, doc, manager } = createSession();

		insertText(adapter, doc, "user-block", "Hello");
		insertText(adapter, doc, "user-block", " world");
		expect(blockText(doc, "user-block")).toBe("Hello world");

		expect(manager.undo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("Hello");

		expect(manager.undo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("");
	});

	it("a new groupId starts a new undo step after a shared group", () => {
		const { adapter, doc, manager } = createSession();

		const write = (groupId: string, text: string) =>
			manager.withCapture("user", groupId, () =>
				insertText(adapter, doc, "user-block", text),
			);
		write("turn-1", "Hello");
		write("turn-1", " world");
		write("turn-2", "!");
		expect(blockText(doc, "user-block")).toBe("Hello world!");

		expect(manager.undo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("Hello world");

		expect(manager.undo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("");
		expect(manager.canUndo()).toBe(false);
	});

	it("undo reverts a tracked user edit and leaves a migration-origin edit in place", () => {
		const { adapter, doc, manager } = createSession();

		insertText(adapter, doc, "user-block", "local");
		insertText(adapter, doc, "other-block", "upgraded", "migration");
		expect(blockText(doc, "user-block")).toBe("local");
		expect(blockText(doc, "other-block")).toBe("upgraded");

		expect(manager.undo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("");
		expect(blockText(doc, "other-block")).toBe("upgraded");
		expect(manager.canUndo()).toBe(false);

		expect(manager.redo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("local");
		expect(blockText(doc, "other-block")).toBe("upgraded");
	});

	it("maxDepth drops the oldest stack item so it cannot be undone", () => {
		const { adapter, doc, manager } = createSession({ maxDepth: 2 });

		insertText(adapter, doc, "user-block", "a");
		insertText(adapter, doc, "user-block", "b");
		insertText(adapter, doc, "user-block", "c");
		expect(blockText(doc, "user-block")).toBe("abc");

		expect(manager.undo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("ab");
		expect(manager.undo()).toBe(true);
		expect(blockText(doc, "user-block")).toBe("a");
		expect(manager.canUndo()).toBe(false);
		expect(manager.undo()).toBe(false);
		expect(blockText(doc, "user-block")).toBe("a");
	});

	it("destroy leaves the document unchanged and undo does not throw", () => {
		const { adapter, doc, manager } = createSession();

		insertText(adapter, doc, "user-block", "keep");
		expect(blockText(doc, "user-block")).toBe("keep");

		manager.destroy();

		expect(manager.canUndo()).toBe(false);
		expect(manager.canRedo()).toBe(false);
		expect(() => manager.undo()).not.toThrow();
		expect(manager.undo()).toBe(false);
		expect(blockText(doc, "user-block")).toBe("keep");
		expect(() => manager.redo()).not.toThrow();
		expect(manager.redo()).toBe(false);
		expect(blockText(doc, "user-block")).toBe("keep");
		expect(() => manager.stopCapturing()).not.toThrow();
		expect(
			manager.withCapture("user", "after-destroy", () => "ran"),
		).toBe("ran");
		expect(() => manager.resetIdleTimer()).not.toThrow();
		expect(() => manager.registerTrackedOrigins(["user"])()).not.toThrow();

		insertText(adapter, doc, "user-block", " more");
		expect(blockText(doc, "user-block")).toBe("keep more");
		expect(manager.undo()).toBe(false);
		expect(blockText(doc, "user-block")).toBe("keep more");
		expect(() => manager.destroy()).not.toThrow();
	});
});
