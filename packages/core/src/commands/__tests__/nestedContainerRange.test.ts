import { describe, expect, it } from "vitest";

import { defineBlock } from "../../schema/defineBlock";
import { prop } from "../../schema/prop";
import { mergeSchemas, SchemaRegistryImpl } from "../../schema/registry";
import { createHeadlessEditor } from "../../editor/editor";
import { selectionToRange, createTextSelection } from "../../selection/helpers";
import {
	caretDocEnd,
	caretDocStart,
	caretLeft,
	caretRight,
	deleteBackward,
	insertText,
	toggleMark,
} from "..";
import {
	caretOf,
	createCommandHarness,
	createCommandTestSchema,
} from "./fixture";

const emailQuote = defineBlock("emailQuote", {
	content: [],
	isContainer: true,
	fieldEditor: "none",
	props: {
		open: prop.boolean().default(true),
	},
});

function createNestedQuoteEditor() {
	const editor = createHeadlessEditor({
		schema: mergeSchemas(
			createCommandTestSchema(),
			new SchemaRegistryImpl({
				blocks: [emailQuote],
				inlines: [],
			}),
		),
	});
	const initial = editor.firstBlock();
	editor.apply(
		[
			...(initial
				? [{ type: "delete-block" as const, blockId: initial.id }]
				: []),
			{
				type: "insert-block",
				blockId: "reply",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "reply",
				from: 0,
				to: 0,
				insert: "Reply",
			},
			{
				type: "insert-block",
				blockId: "quote",
				blockType: "emailQuote",
				props: { open: true },
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "q1",
				blockType: "paragraph",
				props: {},
				position: { parent: "quote", index: 0 },
			},
			{
				type: "insert-block",
				blockId: "q2",
				blockType: "paragraph",
				props: {},
				position: { parent: "quote", index: 1 },
			},
			{
				type: "insert-block",
				blockId: "q3",
				blockType: "paragraph",
				props: {},
				position: { parent: "quote", index: 2 },
			},
			{
				type: "splice-text",
				blockId: "q1",
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "splice-text",
				blockId: "q2",
				from: 0,
				to: 0,
				insert: "World",
			},
			{
				type: "splice-text",
				blockId: "q3",
				from: 0,
				to: 0,
				insert: "Again",
			},
		],
		{ origin: "user" },
	);
	return editor;
}

describe("D6 nested container text ranges", () => {
	it("keeps children-array children out of blockOrder", () => {
		const editor = createNestedQuoteEditor();
		expect(editor.documentState.blockOrder).toEqual(["reply", "quote"]);
		expect(editor.documentState.childrenOf("quote")).toEqual([
			"q1",
			"q2",
			"q3",
		]);
		editor.destroy();
	});

	it("D6: insertText inserts at a collapsed caret inside a children-array child", () => {
		const editor = createNestedQuoteEditor();
		const registry = createCommandHarness(editor);
		editor.selectText("q2", 5, 5);

		expect(registry.dispatch(insertText, { text: "!" })).toBe(true);
		expect(editor.getBlock("q2")?.textContent()).toBe("World!");
		expect(caretOf(editor)).toEqual({ blockId: "q2", offset: 6 });
		editor.destroy();
	});

	it("D6: insertText replaces a same-block range inside a children-array child", () => {
		const editor = createNestedQuoteEditor();
		const registry = createCommandHarness(editor);
		editor.selectText("q1", 1, 4);

		expect(registry.dispatch(insertText, { text: "i" })).toBe(true);
		expect(editor.getBlock("q1")?.textContent()).toBe("Hio");
		expect(caretOf(editor)).toEqual({ blockId: "q1", offset: 2 });
		editor.destroy();
	});

	it("D6: insertText replaces a range across nested children", () => {
		const editor = createNestedQuoteEditor();
		const registry = createCommandHarness(editor);
		editor.selectTextRange(
			{ blockId: "q1", offset: 2 },
			{ blockId: "q3", offset: 2 },
		);

		expect(registry.dispatch(insertText, { text: "X" })).toBe(true);
		expect(editor.getBlock("q1")?.textContent()).toBe("HeXain");
		expect(editor.getBlock("q2")).toBeNull();
		expect(editor.getBlock("q3")).toBeNull();
		expect(caretOf(editor)).toEqual({ blockId: "q1", offset: 3 });
		editor.destroy();
	});

	it("D6: replaceSelection replaces a nested multi-block range", () => {
		const editor = createNestedQuoteEditor();
		editor.selectTextRange(
			{ blockId: "q1", offset: 2 },
			{ blockId: "q3", offset: 2 },
		);
		editor.replaceSelection("X");

		expect(editor.getBlock("q1")?.textContent()).toBe("HeXain");
		expect(editor.getBlock("q2")).toBeNull();
		expect(editor.getBlock("q3")).toBeNull();
		editor.destroy();
	});

	it("D6: deleteBackward over a nested range removes the covered text", () => {
		const editor = createNestedQuoteEditor();
		const registry = createCommandHarness(editor);
		editor.selectTextRange(
			{ blockId: "q1", offset: 2 },
			{ blockId: "q2", offset: 5 },
		);

		expect(
			registry.dispatch(deleteBackward, { granularity: "grapheme" }),
		).toBe(true);
		expect(editor.getBlock("q1")?.textContent()).toBe("He");
		expect(editor.getBlock("q2")).toBeNull();
		editor.destroy();
	});

	it("D6: deleteSelection removes a nested multi-block range", () => {
		const editor = createNestedQuoteEditor();
		editor.selectTextRange(
			{ blockId: "q1", offset: 2 },
			{ blockId: "q2", offset: 5 },
		);

		editor.deleteSelection({ origin: "user" });

		expect(editor.getBlock("q1")?.textContent()).toBe("He");
		expect(editor.getBlock("q2")).toBeNull();
		editor.destroy();
	});

	it("D6: toggleMark formats nested children in the selection", () => {
		const editor = createNestedQuoteEditor();
		const registry = createCommandHarness(editor);
		editor.selectTextRange(
			{ blockId: "q1", offset: 0 },
			{ blockId: "q2", offset: 5 },
		);

		expect(registry.dispatch(toggleMark, { mark: "bold" })).toBe(true);
		expect(editor.getBlock("q1")?.textDeltas()).toEqual([
			{ insert: "Hello", attributes: { bold: true } },
		]);
		expect(editor.getBlock("q2")?.textDeltas()).toEqual([
			{ insert: "World", attributes: { bold: true } },
		]);
		editor.destroy();
	});

	it("D6: caret motion steps inside a children-array child", () => {
		const editor = createNestedQuoteEditor();
		const registry = createCommandHarness(editor);
		editor.selectText("q2", 3, 3);

		expect(registry.dispatch(caretLeft, { extend: false })).toBe(true);
		expect(caretOf(editor)).toEqual({ blockId: "q2", offset: 2 });

		expect(registry.dispatch(caretRight, { extend: false })).toBe(true);
		expect(caretOf(editor)).toEqual({ blockId: "q2", offset: 3 });
		editor.destroy();
	});

	it("D6: caret motion crosses the seam between children-array children", () => {
		const editor = createNestedQuoteEditor();
		const registry = createCommandHarness(editor);
		editor.selectText("q1", 5, 5);

		expect(registry.dispatch(caretRight, { extend: false })).toBe(true);
		expect(caretOf(editor)).toEqual({ blockId: "q2", offset: 0 });
		editor.destroy();
	});

	it("D6: caretDocEnd lands in the last nested child, not the container", () => {
		const editor = createNestedQuoteEditor();
		const registry = createCommandHarness(editor);
		editor.selectText("reply", 0, 0);

		expect(registry.dispatch(caretDocEnd, { extend: false })).toBe(true);
		expect(caretOf(editor)).toEqual({ blockId: "q3", offset: 5 });
		editor.destroy();
	});

	it("D6: caretDocStart lands in the first visible text block", () => {
		const editor = createNestedQuoteEditor();
		const registry = createCommandHarness(editor);
		editor.selectText("q3", 5, 5);

		expect(registry.dispatch(caretDocStart, { extend: false })).toBe(true);
		expect(caretOf(editor)).toEqual({ blockId: "reply", offset: 0 });
		editor.destroy();
	});

	it("D6: a closed container keeps its children out of caret motion", () => {
		const editor = createNestedQuoteEditor();
		const registry = createCommandHarness(editor);
		editor.apply(
			[{ type: "set-props", blockId: "quote", props: { open: false } }],
			{ origin: "user" },
		);
		editor.selectText("reply", 5, 5);

		expect(registry.dispatch(caretRight, { extend: false })).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "block",
			blockIds: ["quote"],
		});
		editor.destroy();
	});

	it("D6: selectionToRange.blockRange includes children-array children", () => {
		const editor = createNestedQuoteEditor();
		const selection = createTextSelection({
			anchor: { blockId: "q1", offset: 0 },
			focus: { blockId: "q3", offset: 5 },
		});

		expect(
			selectionToRange(editor.internals.doc, selection).blockRange,
		).toEqual(["q1", "q2", "q3"]);
		editor.destroy();
	});
});
