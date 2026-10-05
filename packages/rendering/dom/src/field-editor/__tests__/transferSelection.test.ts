import { describe, expect, it } from "vitest";
import type { Editor } from "@input/pen-types";
import {
	selectionSnapshotMatches,
	snapshotTransferSelection,
	type TransferSelectionSnapshot,
} from "../transferSelection";

function editorWithSelection(selection: unknown): Editor {
	return { selection } as Editor;
}

const TEXT_SELECTION = {
	type: "text",
	anchor: { blockId: "block-1", offset: 1 },
	focus: { blockId: "block-1", offset: 4 },
};

describe("transfer selection snapshot equality", () => {
	it("SCALE2: matches a text snapshot even when key order differs", () => {
		const editor = editorWithSelection(TEXT_SELECTION);
		const snapshot: TransferSelectionSnapshot = {
			focus: { offset: 4, blockId: "block-1" },
			type: "text",
			anchor: { offset: 1, blockId: "block-1" },
		};

		expect(
			JSON.stringify(snapshotTransferSelection(editor)) === JSON.stringify(snapshot),
		).toBe(false);
		expect(selectionSnapshotMatches(editor, snapshot)).toBe(true);
	});

	it.each<[string, unknown, TransferSelectionSnapshot | null, boolean]>([
		[
			"still rejects a moved caret",
			TEXT_SELECTION,
			{ ...TEXT_SELECTION, focus: { blockId: "block-1", offset: 5 } } as TransferSelectionSnapshot,
			false,
		],
		["matches block ids in order", { type: "block", blockIds: ["a", "b"] }, { type: "block", blockIds: ["a", "b"] }, true],
		["rejects a block id permutation", { type: "block", blockIds: ["a", "b"] }, { type: "block", blockIds: ["b", "a"] }, false],
		["treats a cleared selection as a mismatch", null, { type: "app", appId: "app-1" }, false],
		["matches a cleared selection to a null snapshot", null, null, true],
	])("SCALE2: %s", (_name, selection, snapshot, matches) => {
		expect(selectionSnapshotMatches(editorWithSelection(selection), snapshot)).toBe(matches);
	});
});
