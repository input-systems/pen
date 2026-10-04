import { defineExtension } from "@input/pen-core";
import { describe, expect, it } from "vitest";

import { applySplitBlock } from "../index";
import { TestBlockMapLike, createEditor } from "./editorCore.testHelpers";

describe("@input/pen-core createEditor: block splits and commit batching", () => {
	it("splits at offset zero by inserting an empty block above", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "hello world",
			},
		]);

		applySplitBlock(editor, {
			blockId,
			offset: 0,
			newBlockId: "b2",
		});

		expect(editor.documentState.blockOrder).toEqual([blockId, "b2"]);
		expect(editor.getBlock(blockId)?.textContent()).toBe("");
		expect(editor.getBlock("b2")?.textContent()).toBe("hello world");

		editor.destroy();
	});

	it("preserves full text offsets for code blocks", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "set-props", blockId, props: { type: "codeBlock" } },
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "abcd" },
		]);

		editor.selectTextRange({ blockId, offset: 1 }, { blockId, offset: 3 });

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 3 },
		});
		expect(editor.getSelectedText()).toBe("bc");

		editor.destroy();
	});

	it("clears stale grid state when converting table blocks", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "table-block",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "set-props",
				blockId: "table-block",
				props: { type: "paragraph" },
			},
		]);

		const tableBlock = editor.getBlock("table-block")!;
		expect(tableBlock.type).toBe("paragraph");
		expect(tableBlock.as("table")).toBeNull();

		const tableBlockMap = editor.internals.doc.blocks.get(
			"table-block",
		) as TestBlockMapLike;
		expect(tableBlockMap.get("tableContent")).toBeUndefined();
		expect(tableBlockMap.get("tableColumns")).toBeUndefined();

		editor.destroy();
	});

	it("queues reentrant apply calls from observe hooks", () => {
		let appended = false;
		const ext = defineExtension({
			name: "append-exclamation",
			observe(events, editor) {
				if (appended) return;
				const hasUserEdit = events.some(
					(event) =>
						event.origin.type === "user" &&
						(event.summary.blockText.length > 0 ||
							event.summary.structural.length > 0),
				);
				if (!hasUserEdit) return;

				appended = true;
				editor.apply(
					[
						{
							type: "splice-text",
							blockId: "b1",
							from: 5,
							to: 5,
							insert: "!",
						},
					],
					{ origin: "extension" },
				);
			},
		});

		const editor = createEditor({
			extensions: [ext],
		});

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

		expect(editor.getBlock("b1")?.textContent()).toBe("hello!");

		editor.destroy();
	});

	it("emits one commit for a local apply batch", () => {
		const observed: unknown[][] = [];
		const ext = defineExtension({
			name: "capture-local-dispatch",
			observe(events) {
				observed.push([...events]);
			},
		});
		const editor = createEditor({
			extensions: [ext],
		});
		const commits: unknown[] = [];
		const blockId = editor.firstBlock()!.id;

		editor.on("commit", (event) => {
			commits.push(event);
		});
		observed.length = 0;
		commits.length = 0;

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "hello",
			},
		]);

		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({
			commitId: 1,
			origin: { type: "user" },
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
});
