import { createTwoPeerHarness } from "@input/pen-test";
import type { Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { undoExtension } from "../undoExtension";

const AI = { type: "ai" as const, groupId: "g1" };

function text(editor: Editor, blockId: string): string {
	return editor.getBlock(blockId)?.textContent() ?? "";
}

function typeAtEnd(editor: Editor, blockId: string, insert: string) {
	const at = text(editor, blockId).length;
	editor.apply(
		[{ type: "splice-text", blockId, from: at, to: at, insert }],
		{ origin: "user" },
	);
}

function aiAtEnd(editor: Editor, blockId: string, insert: string) {
	const at = text(editor, blockId).length;
	editor.apply(
		[{ type: "splice-text", blockId, from: at, to: at, insert }],
		{ origin: AI },
	);
}

function setup() {
	const harness = createTwoPeerHarness({
		blocks: [
			{ id: "b1", type: "paragraph", content: "" },
			{ id: "b2", type: "paragraph", content: "" },
		],
		extensions: [undoExtension({ groupTimeout: 10_000 })],
	});
	return { harness, editor: harness.peerA.editor };
}

describe("@input/pen-undo AIB4 interleaving", () => {
	it("AIB4: an AI stream interleaved with user typing in another block undoes as one step and keeps the typing", () => {
		const { editor } = setup();
		const stream = editor.openTextStream({ blockId: "b1" }, { origin: AI });
		stream.append("Hello");
		stream.flush();
		typeAtEnd(editor, "b2", "x");
		stream.append(" world");
		stream.flush();
		typeAtEnd(editor, "b2", "y");
		// The stream writes last, so its step is on top (last written wins).
		stream.append("!");
		stream.close();
		expect(text(editor, "b1")).toBe("Hello world!");
		expect(text(editor, "b2")).toBe("xy");

		expect(editor.undoManager.undo()).toBe(true);
		expect(text(editor, "b1")).toBe("");
		expect(text(editor, "b2")).toBe("xy");

		// Typing on either side of an AI write stays in time order: two steps.
		expect(editor.undoManager.undo()).toBe(true);
		expect(text(editor, "b2")).toBe("x");
		expect(editor.undoManager.undo()).toBe(true);
		expect(text(editor, "b2")).toBe("");
		expect(editor.undoManager.canUndo()).toBe(false);
	});

	it("AIB4: a collaborator or system apply between two writes of a group neither closes nor joins it", () => {
		const { harness, editor } = setup();
		aiAtEnd(editor, "b1", "a");
		harness.peerB.editor.apply(
			[{ type: "splice-text", blockId: "b2", from: 0, to: 0, insert: "B" }],
			{ origin: "user" },
		);
		harness.exchange("b-then-a");
		editor.apply(
			[{ type: "splice-text", blockId: "b2", from: 1, to: 1, insert: "s" }],
			{ origin: "system" },
		);
		aiAtEnd(editor, "b1", "b");
		expect(text(editor, "b1")).toBe("ab");

		expect(editor.undoManager.undo()).toBe(true);
		expect(text(editor, "b1")).toBe("");
		expect(text(editor, "b2")).toBe("Bs");
		expect(editor.undoManager.canUndo()).toBe(false);
	});

	it("AIB4: paste-style stopCapturing during an AI group does not split the group", () => {
		const { editor } = setup();
		aiAtEnd(editor, "b1", "a");
		editor.undoManager.stopCapturing();
		typeAtEnd(editor, "b2", "x");
		aiAtEnd(editor, "b1", "b");

		expect(editor.undoManager.undo()).toBe(true);
		expect(text(editor, "b1")).toBe("");
		expect(text(editor, "b2")).toBe("x");
	});

	it("AIB4: reusing a group id while its step is on the stack joins that step", () => {
		const { editor } = setup();
		aiAtEnd(editor, "b1", "a");
		typeAtEnd(editor, "b2", "x");
		aiAtEnd(editor, "b1", "b");

		expect(editor.undoManager.undo()).toBe(true);
		expect(text(editor, "b1")).toBe("");
		expect(editor.undoManager.undo()).toBe(true);
		expect(text(editor, "b2")).toBe("");
		expect(editor.undoManager.canUndo()).toBe(false);
	});
});
