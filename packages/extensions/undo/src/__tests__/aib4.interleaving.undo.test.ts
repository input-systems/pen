import { createTwoPeerHarness } from "@input/pen-test";
import type { Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { undoExtension } from "../undoExtension";
import { splice } from "./undoEditorFixture";

const AI = { type: "ai" as const, groupId: "g1" };

function text(editor: Editor, blockId: string): string {
	return editor.getBlock(blockId)?.textContent() ?? "";
}

function writeAtEnd(
	editor: Editor,
	blockId: string,
	insert: string,
	origin: "user" | typeof AI = "user",
) {
	const at = text(editor, blockId).length;
	editor.apply([splice(blockId, at, at, insert)], { origin });
}

function setup() {
	const harness = createTwoPeerHarness({
		blocks: [
			{ id: "b1", type: "paragraph", content: "" },
			{ id: "b2", type: "paragraph", content: "" },
		],
		extensions: [undoExtension({ groupTimeout: 10_000 })],
	});
	const editor = harness.peerA.editor;
	const texts = () => [text(editor, "b1"), text(editor, "b2")];
	/** Undoes until the stack is empty, returning [b1, b2] after each step. */
	const undoTrail = (): string[][] => {
		const seen: string[][] = [];
		while (editor.undoManager.undo()) seen.push(texts());
		return seen;
	};
	return { harness, editor, texts, undoTrail };
}

describe("@input/pen-undo AIB4 interleaving", () => {
	it("AIB4: an AI stream interleaved with user typing in another block undoes as one step and keeps the typing", () => {
		const { editor, texts, undoTrail } = setup();
		const stream = editor.openTextStream({ blockId: "b1" }, { origin: AI });
		stream.append("Hello");
		stream.flush();
		writeAtEnd(editor, "b2", "x");
		stream.append(" world");
		stream.flush();
		writeAtEnd(editor, "b2", "y");
		// The stream writes last, so its step is on top (last written wins).
		stream.append("!");
		stream.close();
		expect(texts()).toEqual(["Hello world!", "xy"]);

		// Typing on either side of an AI write stays in time order: two steps.
		expect(undoTrail()).toEqual([
			["", "xy"],
			["", "x"],
			["", ""],
		]);
	});

	it("AIB4: a collaborator or system apply between two writes of a group neither closes nor joins it", () => {
		const { harness, editor, texts, undoTrail } = setup();
		writeAtEnd(editor, "b1", "a", AI);
		writeAtEnd(harness.peerB.editor, "b2", "B");
		harness.exchange("b-then-a");
		editor.apply([splice("b2", 1, 1, "s")], { origin: "system" });
		writeAtEnd(editor, "b1", "b", AI);
		expect(texts()).toEqual(["ab", "Bs"]);

		expect(undoTrail()).toEqual([["", "Bs"]]);
	});

	it("AIB4: paste-style stopCapturing during an AI group does not split the group", () => {
		const { editor, undoTrail } = setup();
		writeAtEnd(editor, "b1", "a", AI);
		editor.undoManager.stopCapturing();
		writeAtEnd(editor, "b2", "x");
		writeAtEnd(editor, "b1", "b", AI);

		expect(undoTrail()[0]).toEqual(["", "x"]);
	});

	it("AIB4: reusing a group id while its step is on the stack joins that step", () => {
		const { editor, undoTrail } = setup();
		writeAtEnd(editor, "b1", "a", AI);
		writeAtEnd(editor, "b2", "x");
		writeAtEnd(editor, "b1", "b", AI);

		expect(undoTrail()).toEqual([
			["", "x"],
			["", ""],
		]);
	});

	it("AIB4: a user deleting AI text between two writes of its group never lets undo bring that text back", () => {
		const { editor, undoTrail } = setup();
		writeAtEnd(editor, "b1", "Base");
		editor.undoManager.stopCapturing();
		writeAtEnd(editor, "b1", " AI", AI);
		editor.apply([splice("b1", 4, 7, "")], { origin: "user" });
		writeAtEnd(editor, "b1", " more", AI);
		expect(text(editor, "b1")).toBe("Base more");

		expect(undoTrail().map(([b1]) => b1)).toEqual([
			"Base",
			"Base AI",
			"Base",
			"",
		]);
	});

	it("AIB4: an AI apply issued from a commit listener inside a user apply captures under its own group", () => {
		const { editor, texts, undoTrail } = setup();
		writeAtEnd(editor, "b1", "u");
		let fire = true;
		const off = editor.internals.onApplyBoundary((event) => {
			if (!fire || event.phase !== "after" || event.origin !== "user")
				return;
			fire = false;
			editor.apply([splice("b2", 0, 0, "A")], { origin: AI });
		});
		writeAtEnd(editor, "b1", "v");
		off();
		writeAtEnd(editor, "b2", "B", AI);
		expect(texts()).toEqual(["uv", "AB"]);

		expect(undoTrail()).toEqual([
			["uv", ""],
			["", ""],
		]);
	});
});
