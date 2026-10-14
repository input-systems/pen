import { applyMergeBlocks, applySplitBlock } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
	BODY_ID,
	BODY_TEXT,
	TITLE_ID,
	TITLE_TEXT,
	createUndoEditor,
	snapshot,
} from "./undoEditorFixture";

const BODY_TAIL_ID = "fixture-body-tail";

function undoUntilEmpty(editor: Editor): number {
	let steps = 0;
	while (editor.undoManager.canUndo()) {
		expect(editor.undoManager.undo()).toBe(true);
		steps += 1;
		if (steps > 20) {
			throw new Error("undo stack did not empty");
		}
	}
	return steps;
}

describe("@input/pen-undo editor document restore", () => {
	it("undo restores fixture text after insert-text and redo reapplies it", () => {
		const { editor } = createUndoEditor();
		const prior = snapshot(editor);
		expect(prior).toEqual([
			{ id: TITLE_ID, text: TITLE_TEXT },
			{ id: BODY_ID, text: BODY_TEXT },
		]);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: BODY_TEXT.length,
				to: BODY_TEXT.length,
				insert: " extra",
				},
			],
			{ origin: "user" },
		);
		expect(editor.getBlock(BODY_ID)?.textContent()).toBe(`${BODY_TEXT} extra`);

		expect(editor.undoManager.undo()).toBe(true);
		expect(snapshot(editor)).toEqual(prior);

		expect(editor.undoManager.redo()).toBe(true);
		expect(editor.getBlock(BODY_ID)?.textContent()).toBe(`${BODY_TEXT} extra`);
		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(TITLE_TEXT);

		editor.destroy();
	});

	it("undo restores a split-block, a merge-blocks, and a delete-block as three steps", () => {
		const { editor } = createUndoEditor();
		const prior = snapshot(editor);

		applySplitBlock(editor, {
			blockId: BODY_ID,
			offset: 7,
			newBlockId: BODY_TAIL_ID,
			applyOptions: { origin: "user" },
		});
		expect(snapshot(editor)).toEqual([
			{ id: TITLE_ID, text: TITLE_TEXT },
			{ id: BODY_ID, text: "Stable " },
			{ id: BODY_TAIL_ID, text: "body text" },
		]);

		applyMergeBlocks(editor, {
			targetBlockId: BODY_ID,
			sourceBlockId: BODY_TAIL_ID,
			applyOptions: { origin: "user" },
		});
		expect(snapshot(editor)).toEqual(prior);

		editor.apply([{ type: "delete-block", blockId: TITLE_ID }], {
			origin: "user",
		});
		expect(snapshot(editor)).toEqual([{ id: BODY_ID, text: BODY_TEXT }]);
		expect(editor.getBlock(TITLE_ID)).toBeNull();

		expect(editor.undoManager.undo()).toBe(true);
		expect(snapshot(editor)).toEqual(prior);
		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(TITLE_TEXT);

		expect(editor.undoManager.undo()).toBe(true);
		expect(snapshot(editor)).toEqual([
			{ id: TITLE_ID, text: TITLE_TEXT },
			{ id: BODY_ID, text: "Stable " },
			{ id: BODY_TAIL_ID, text: "body text" },
		]);

		expect(editor.undoManager.undo()).toBe(true);
		expect(snapshot(editor)).toEqual(prior);
		expect(editor.undoManager.canUndo()).toBe(false);
		expect(undoUntilEmpty(editor)).toBe(0);

		editor.destroy();
	});

	it("ops that share one undoGroupId collapse to one undo step", () => {
		const { editor } = createUndoEditor();
		const prior = snapshot(editor);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: BODY_TEXT.length,
				to: BODY_TEXT.length,
				insert: " one",
				},
			],
			{ origin: "user", undoGroupId: "turn-1" },
		);
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: BODY_TEXT.length + 4,
				to: BODY_TEXT.length + 4,
				insert: " two",
				},
			],
			{ origin: "user", undoGroupId: "turn-1" },
		);
		expect(editor.getBlock(BODY_ID)?.textContent()).toBe(
			`${BODY_TEXT} one two`,
		);

		expect(undoUntilEmpty(editor)).toBe(1);
		expect(snapshot(editor)).toEqual(prior);

		editor.destroy();
	});

	it("two undoGroupId values undo as two steps", () => {
		const { editor } = createUndoEditor();
		const prior = snapshot(editor);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: BODY_TEXT.length,
				to: BODY_TEXT.length,
				insert: " one",
				},
			],
			{ origin: "user", undoGroupId: "turn-1" },
		);
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: BODY_TEXT.length + 4,
				to: BODY_TEXT.length + 4,
				insert: " two",
				},
			],
			{ origin: "user", undoGroupId: "turn-2" },
		);
		expect(editor.getBlock(BODY_ID)?.textContent()).toBe(
			`${BODY_TEXT} one two`,
		);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(BODY_ID)?.textContent()).toBe(`${BODY_TEXT} one`);
		expect(editor.undoManager.canUndo()).toBe(true);

		expect(editor.undoManager.undo()).toBe(true);
		expect(snapshot(editor)).toEqual(prior);
		expect(editor.undoManager.canUndo()).toBe(false);

		editor.destroy();
	});

	it("a collaborator-origin apply is not captured on the local undo stack", () => {
		const { editor } = createUndoEditor();
		const prior = snapshot(editor);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: TITLE_ID,
					from: TITLE_TEXT.length,
				to: TITLE_TEXT.length,
				insert: " remote",
				},
			],
			{ origin: "collaborator" },
		);
		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(
			`${TITLE_TEXT} remote`,
		);
		expect(editor.undoManager.canUndo()).toBe(false);
		expect(editor.undoManager.undo()).toBe(false);
		expect(snapshot(editor)).toEqual([
			{ id: TITLE_ID, text: `${TITLE_TEXT} remote` },
			{ id: BODY_ID, text: BODY_TEXT },
		]);
		expect(snapshot(editor)).not.toEqual(prior);

		editor.destroy();
	});

	it("a collaborator-origin remote update is not swallowed by a local undo", () => {
		const { adapter, editor } = createUndoEditor();
		const prior = snapshot(editor);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: BODY_TEXT.length,
				to: BODY_TEXT.length,
				insert: " local",
				},
			],
			{ origin: "user" },
		);

		const editorDoc = editor.internals.crdtDoc;
		const remoteDoc = adapter.loadDocument(adapter.encodeState(editorDoc));
		const remoteTitle = adapter
			.raw<{
				getMap(name: "blocks"): {
					get(key: string): { get(key: string): unknown } | undefined;
				};
			}>(remoteDoc)
			.getMap("blocks")
			.get(TITLE_ID)
			?.get("content");
		if (!(remoteTitle instanceof Y.Text)) {
			throw new Error("fixture-title has no text");
		}

		const since = Y.encodeStateVector(
			(editorDoc as unknown as { ydoc: Y.Doc }).ydoc,
		);
		adapter.transact(
			remoteDoc,
			() => {
				remoteTitle.insert(remoteTitle.length, " remote");
			},
			"collaborator",
		);
		adapter.applyUpdate(editorDoc, adapter.encodeUpdate(remoteDoc, since));

		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(
			`${TITLE_TEXT} remote`,
		);
		expect(editor.getBlock(BODY_ID)?.textContent()).toBe(`${BODY_TEXT} local`);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(BODY_ID)?.textContent()).toBe(BODY_TEXT);
		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(
			`${TITLE_TEXT} remote`,
		);
		expect(editor.undoManager.canUndo()).toBe(false);
		expect(snapshot(editor)).not.toEqual(prior);

		editor.destroy();
	});

	it("an ai-origin apply is captured and undo restores the document", () => {
		const { editor } = createUndoEditor();
		const prior = snapshot(editor);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: BODY_TEXT.length,
				to: BODY_TEXT.length,
				insert: " drafted",
				},
			],
			{ origin: "ai" },
		);
		expect(editor.getBlock(BODY_ID)?.textContent()).toBe(
			`${BODY_TEXT} drafted`,
		);

		expect(editor.undoManager.undo()).toBe(true);
		expect(snapshot(editor)).toEqual(prior);

		editor.destroy();
	});

	it("ops that share a structured origin groupId collapse to one undo step", () => {
		const { editor } = createUndoEditor();
		const prior = snapshot(editor);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: BODY_TEXT.length,
				to: BODY_TEXT.length,
				insert: " one",
				},
			],
			{ origin: { type: "ai", groupId: "turn-1" } },
		);
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: BODY_ID,
					from: BODY_TEXT.length + 4,
				to: BODY_TEXT.length + 4,
				insert: " two",
				},
			],
			{ origin: { type: "ai", groupId: "turn-1" } },
		);
		expect(editor.getBlock(BODY_ID)?.textContent()).toBe(
			`${BODY_TEXT} one two`,
		);

		expect(undoUntilEmpty(editor)).toBe(1);
		expect(snapshot(editor)).toEqual(prior);

		editor.destroy();
	});

	it("an input-rule origin apply is captured, so undo reverts the rewrite", () => {
		const { editor } = createUndoEditor();

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: TITLE_ID,
					from: TITLE_TEXT.length,
					to: TITLE_TEXT.length,
					insert: " expanded",
				},
			],
			{ origin: "input-rule" },
		);
		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(
			`${TITLE_TEXT} expanded`,
		);
		expect(editor.undoManager.canUndo()).toBe(true);
		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(TITLE_TEXT);

		editor.destroy();
	});

	it("a system origin apply is not captured on the local undo stack", () => {
		const { editor } = createUndoEditor();

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: TITLE_ID,
					from: TITLE_TEXT.length,
				to: TITLE_TEXT.length,
				insert: " seeded",
				},
			],
			{ origin: "system" },
		);
		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(
			`${TITLE_TEXT} seeded`,
		);
		expect(editor.undoManager.canUndo()).toBe(false);
		expect(editor.undoManager.undo()).toBe(false);
		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(
			`${TITLE_TEXT} seeded`,
		);

		editor.destroy();
	});

	it("a structured collaborator origin apply is not captured", () => {
		const { editor } = createUndoEditor();

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: TITLE_ID,
					from: TITLE_TEXT.length,
				to: TITLE_TEXT.length,
				insert: " remote",
				},
			],
			{ origin: { type: "collaborator" } },
		);
		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(
			`${TITLE_TEXT} remote`,
		);
		expect(editor.undoManager.canUndo()).toBe(false);
		expect(editor.undoManager.undo()).toBe(false);
		expect(editor.getBlock(TITLE_ID)?.textContent()).toBe(
			`${TITLE_TEXT} remote`,
		);

		editor.destroy();
	});

	it("undo with nothing to undo is a safe no-op", () => {
		const { editor } = createUndoEditor();
		const prior = snapshot(editor);

		expect(editor.undoManager.canUndo()).toBe(false);
		expect(editor.undoManager.canRedo()).toBe(false);
		expect(() => editor.undoManager.undo()).not.toThrow();
		expect(editor.undoManager.undo()).toBe(false);
		expect(() => editor.undoManager.redo()).not.toThrow();
		expect(editor.undoManager.redo()).toBe(false);
		expect(snapshot(editor)).toEqual(prior);

		editor.destroy();
	});
});
