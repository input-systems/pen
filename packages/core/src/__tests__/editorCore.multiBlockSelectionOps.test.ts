import { defineExtension } from "@input/pen-core";
import { describe, expect, it } from "vitest";

import {
	TestRawDocLike,
	TestYTextLike,
	createEditor,
} from "./editorCore.testHelpers";

describe("@input/pen-core createEditor: multi-block selection operations", () => {
	it("emits one commit for observed CRDT updates", () => {
		const observed: unknown[][] = [];
		const ext = defineExtension({
			name: "capture-observed-dispatch",
			observe(events) {
				observed.push([...events]);
			},
		});
		const editor = createEditor({
			extensions: [ext],
		});
		const commits: unknown[] = [];
		const adapter = editor.internals.adapter;
		const editorDoc = editor.internals.crdtDoc;
		const blockId = editor.firstBlock()!.id;
		const remoteDoc = adapter.loadDocument(adapter.encodeState(editorDoc));
		const remoteYDoc = adapter.raw<TestRawDocLike>(remoteDoc);
		const remoteYText = remoteYDoc
			.getMap("blocks")
			.get(blockId)
			?.get("content") as TestYTextLike | undefined;
		if (!remoteYText) {
			throw new Error(`Missing collaborator text for block ${blockId}`);
		}

		editor.on("commit", (event) => {
			commits.push(event);
		});
		observed.length = 0;
		commits.length = 0;

		adapter.transact(
			remoteDoc,
			() => {
				remoteYText.insert(0, "remote ");
			},
			"collaborator",
		);
		adapter.applyUpdate(editorDoc, adapter.encodeState(remoteDoc));

		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({
			commitId: 1,
			origin: { type: "collaborator" },
		});
		expect(
			(
				commits[0] as { summary: { blockText: { blockId: string }[] } }
			).summary.blockText.map((text) => text.blockId),
		).toContain(blockId);
		expect(observed).toHaveLength(1);
		expect(observed[0]).toHaveLength(1);

		editor.destroy();
	});

	it("clamps text selections and returns backwards selected text", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0,
				insert: "hello",
			},
		]);

		editor.selectText("b1", 10, 99);
		expect(editor.getSelection()).toMatchObject({
			type: "text",
			anchor: { blockId: "b1", offset: 5 },
			focus: { blockId: "b1", offset: 5 },
		});

		editor.setSelection({
			type: "text",
			anchor: { blockId: "b1", offset: 5 },
			focus: { blockId: "b1", offset: 2 },
		});

		expect(editor.getSelectedText()).toBe("llo");

		editor.destroy();
	});

	it("selects text ranges across blocks in document order", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "splice-text",
				blockId: "b2",
				from: 0,
				to: 0,
				insert: "World",
			},
			{
				type: "splice-text",
				blockId: "b3",
				from: 0,
				to: 0,
				insert: "Again",
			},
		]);

		editor.selectTextRange(
			{ blockId: "b1", offset: 2 },
			{ blockId: "b3", offset: 3 },
		);

		expect(editor.getSelection()).toMatchObject({
			type: "text",
			anchor: { blockId: "b1", offset: 2 },
			focus: { blockId: "b3", offset: 3 },
		});
		expect(editor.getSelectedText()).toBe("llo\nWorld\nAga");
		expect(editor.getSelectedBlocks().map((block) => block.id)).toEqual([
			"b1",
			"b2",
			"b3",
		]);

		editor.destroy();
	});

	it("deletes multi-block text selections and collapses at the start", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "splice-text",
				blockId: "b2",
				from: 0,
				to: 0,
				insert: "World",
			},
			{
				type: "splice-text",
				blockId: "b3",
				from: 0,
				to: 0,
				insert: "Again",
			},
		]);

		editor.selectTextRange(
			{ blockId: "b1", offset: 2 },
			{ blockId: "b3", offset: 2 },
		);
		editor.deleteSelection();

		expect(editor.getBlock("b1")?.textContent()).toBe("Heain");
		expect(editor.getBlock("b2")).toBeNull();
		expect(editor.getBlock("b3")).toBeNull();
		expect(editor.getSelection()).toMatchObject({
			type: "text",
			anchor: { blockId: "b1", offset: 2 },
			focus: { blockId: "b1", offset: 2 },
		});

		editor.destroy();
	});

	it("deletes a fully selected structural block", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "d1",
				blockType: "divider",
				props: {},
				position: "last",
			},
		]);

		editor.selectTextRange(
			{ blockId: "d1", offset: 0 },
			{ blockId: "d1", offset: 1 },
		);
		expect(editor.getSelection()).toMatchObject({
			type: "block",
			blockIds: ["d1"],
			head: "d1",
		});
		editor.deleteSelection();

		expect(editor.getBlock("d1")).toBeNull();
		expect(editor.getSelection()).toBeNull();

		editor.destroy();
	});

	it("deletes a fully selected delegated block", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.selectTextRange(
			{ blockId: "t1", offset: 0 },
			{ blockId: "t1", offset: 1 },
		);
		expect(editor.getSelection()).toMatchObject({
			type: "block",
			blockIds: ["t1"],
			head: "t1",
		});
		editor.deleteSelection();

		expect(editor.getBlock("t1")).toBeNull();
		expect(editor.getSelection()).toBeNull();

		editor.destroy();
	});

	it("deletes structural blocks at multi-block selection boundaries", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "p1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "d1",
				blockType: "divider",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "p2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "p1",
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "splice-text",
				blockId: "p2",
				from: 0,
				to: 0,
				insert: "World",
			},
		]);

		editor.selectTextRange(
			{ blockId: "p1", offset: 2 },
			{ blockId: "d1", offset: 1 },
		);
		expect(editor.getSelection()?.type).toBe("text");
		editor.deleteSelection();

		expect(editor.getBlock("p1")?.textContent()).toBe("He");
		expect(editor.getBlock("d1")).toBeNull();
		expect(editor.getBlock("p2")?.textContent()).toBe("World");
		expect(editor.getSelection()).toMatchObject({
			type: "text",
			anchor: { blockId: "p1", offset: 2 },
			focus: { blockId: "p1", offset: 2 },
		});

		editor.destroy();
	});

	it("replaces multi-block text selections at a single insertion point", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "splice-text",
				blockId: "b2",
				from: 0,
				to: 0,
				insert: "World",
			},
			{
				type: "splice-text",
				blockId: "b3",
				from: 0,
				to: 0,
				insert: "Again",
			},
		]);

		editor.selectTextRange(
			{ blockId: "b1", offset: 2 },
			{ blockId: "b3", offset: 2 },
		);
		editor.replaceSelection("X");

		expect(editor.getBlock("b1")?.textContent()).toBe("HeXain");
		expect(editor.getBlock("b2")).toBeNull();
		expect(editor.getBlock("b3")).toBeNull();
		expect(editor.getSelection()).toMatchObject({
			type: "text",
			anchor: { blockId: "b1", offset: 3 },
			focus: { blockId: "b1", offset: 3 },
		});

		editor.destroy();
	});
});
