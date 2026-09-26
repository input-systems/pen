// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
	createEditor,
	deriveContentMoves,
	repairAnchor,
	type PendingBlock,
} from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { defaultSchema } from "@input/pen-schema";
import { handleCopy } from "../field-editor/clipboard";
import { pasteBlocksAtCaret } from "../field-editor/transferBlockPlacement";
import { executePasteTransfer } from "../field-editor/transferPaste";
import type { FieldEditorTransferController } from "../field-editor/controller";
import type { PasteImporters } from "../types/paste";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function createDocument(lines: string[]): { editor: Editor; ids: string[] } {
	const editor = createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
	});
	const firstId = editor.firstBlock()!.id;
	const ids = [firstId];
	editor.apply([
		{
			type: "splice-text",
			blockId: firstId,
			from: 0,
			to: 0,
			insert: lines[0],
		},
	]);
	for (const line of lines.slice(1)) {
		const blockId = `line-${ids.length}`;
		editor.apply([
			{
				type: "insert-block",
				blockId,
				blockType: "paragraph",
				props: {},
				position: { after: ids[ids.length - 1] },
			},
			{ type: "splice-text", blockId, from: 0, to: 0, insert: line },
		]);
		ids.push(blockId);
	}
	return { editor, ids };
}

function htmlImporterReturning(blocks: PendingBlock[]): PasteImporters {
	return {
		html: {
			name: "html",
			mimeType: "text/html",
			parse: () => blocks,
			import: vi.fn(),
		},
	};
}

async function paste(
	editor: Editor,
	data: Map<string, string>,
	importers?: PasteImporters,
): Promise<FieldEditorTransferController> {
	const fieldEditor: FieldEditorTransferController = {
		activateTextSelection: vi.fn(),
	};
	await executePasteTransfer({
		source: "paste",
		editor,
		fieldEditor,
		importers,
		dataTransfer: {
			files: [] as unknown as FileList,
			types: [...data.keys()],
			getData: (type: string) => data.get(type) ?? "",
			setData: (type: string, value: string) => data.set(type, value),
		} as unknown as DataTransfer,
	});
	return fieldEditor;
}

function copy(editor: Editor): Map<string, string> {
	const data = new Map<string, string>();
	handleCopy(editor, {
		clipboardData: {
			setData: (type: string, value: string) => data.set(type, value),
		},
		preventDefault: vi.fn(),
	} as unknown as ClipboardEvent);
	return data;
}

async function pasteParsed(
	editor: Editor,
	blocks: PendingBlock[],
): Promise<FieldEditorTransferController> {
	return paste(
		editor,
		new Map([["text/html", "<p>parsed</p>"]]),
		htmlImporterReturning(blocks),
	);
}

function readBlocks(editor: Editor): Array<{ type: string; text: string }> {
	return editor.documentState.blockOrder.map((blockId) => {
		const block = editor.getBlock(blockId)!;
		return { type: block.type, text: block.textContent() };
	});
}

const paragraph = (content: string): PendingBlock => ({
	type: "paragraph",
	props: {},
	content,
});

describe("IOP9: parsed paste lands at the caret", () => {
	it("inserts a single pasted paragraph inline at the caret", async () => {
		const { editor, ids } = createDocument(["Hello world", "next"]);
		editor.selectText(ids[0], 6, 6);

		const fieldEditor = await pasteParsed(editor, [
			{
				type: "paragraph",
				props: {},
				content: "big ",
				marks: [{ type: "bold", start: 0, end: 3 }],
			},
		]);

		expect(readBlocks(editor)).toEqual([
			{ type: "paragraph", text: "Hello big world" },
			{ type: "paragraph", text: "next" },
		]);
		expect(editor.documentState.blockOrder[0]).toBe(ids[0]);
		expect(
			editor
				.getBlock(ids[0])!
				.textDeltas()
				.some(
					(delta) => delta.insert === "big" && delta.attributes?.bold,
				),
		).toBe(true);
		expect(fieldEditor.activateTextSelection).toHaveBeenCalledWith(
			ids[0],
			10,
			10,
		);
	});

	it("splits the caret line around multiple pasted blocks", async () => {
		const { editor, ids } = createDocument(["abcdef", "next"]);
		editor.selectText(ids[0], 3, 3);

		const fieldEditor = await pasteParsed(editor, [
			paragraph("one"),
			{ type: "heading", props: { level: 2 }, content: "two" },
			paragraph("three"),
		]);

		expect(readBlocks(editor)).toEqual([
			{ type: "paragraph", text: "abcone" },
			{ type: "heading", text: "two" },
			{ type: "paragraph", text: "threedef" },
			{ type: "paragraph", text: "next" },
		]);
		expect(editor.documentState.blockOrder[0]).toBe(ids[0]);
		const tailId = editor.documentState.blockOrder[2];
		expect(fieldEditor.activateTextSelection).toHaveBeenCalledWith(
			tailId,
			5,
			5,
		);
	});

	it("replaces a double-clicked word with multiple pasted blocks", async () => {
		const { editor, ids } = createDocument(["one two three"]);
		editor.selectText(ids[0], 4, 7);

		await pasteParsed(editor, [paragraph("X"), paragraph("Y")]);

		expect(readBlocks(editor)).toEqual([
			{ type: "paragraph", text: "one X" },
			{ type: "paragraph", text: "Y three" },
		]);
	});

	it("keeps the caret line below blocks pasted at its start", async () => {
		const { editor, ids } = createDocument(["hello"]);
		editor.selectText(ids[0], 0, 0);

		await pasteParsed(editor, [paragraph("A"), paragraph("B")]);

		expect(readBlocks(editor)).toEqual([
			{ type: "paragraph", text: "A" },
			{ type: "paragraph", text: "Bhello" },
		]);
		expect(editor.documentState.blockOrder[0]).toBe(ids[0]);
	});

	it("puts blocks pasted at the end of a line after it", async () => {
		const { editor, ids } = createDocument(["hello", "next"]);
		editor.selectText(ids[0], 5, 5);

		const fieldEditor = await pasteParsed(editor, [
			paragraph(" A"),
			paragraph("B"),
		]);

		expect(readBlocks(editor)).toEqual([
			{ type: "paragraph", text: "hello A" },
			{ type: "paragraph", text: "B" },
			{ type: "paragraph", text: "next" },
		]);
		expect(fieldEditor.activateTextSelection).toHaveBeenCalledWith(
			editor.documentState.blockOrder[1],
			1,
			1,
		);
	});

	it("splits the line around a pasted block without inline content", async () => {
		const { editor, ids } = createDocument(["abcdef"]);
		editor.selectText(ids[0], 3, 3);

		await pasteParsed(editor, [{ type: "divider", props: {} }]);

		expect(readBlocks(editor)).toEqual([
			{ type: "paragraph", text: "abc" },
			{ type: "divider", text: "" },
			{ type: "paragraph", text: "def" },
		]);
	});

	it("keeps the caret line's props on the text after the caret", async () => {
		const { editor, ids } = createDocument([""]);
		editor.apply([
			{
				type: "insert-block",
				blockId: "title",
				blockType: "heading",
				props: { level: 2, textAlignment: "center" },
				position: { before: ids[0] },
			},
			{
				type: "splice-text",
				blockId: "title",
				from: 0,
				to: 0,
				insert: "abcdef",
			},
		]);
		editor.selectText("title", 3, 3);

		await pasteParsed(editor, [paragraph("one"), paragraph("two")]);

		const tail = editor.getBlock(editor.documentState.blockOrder[1])!;
		expect(tail.textContent()).toBe("twodef");
		expect(tail.type).toBe("heading");
		expect(tail.props).toMatchObject({ level: 2, textAlignment: "center" });
	});

	it("AN14: repairs anchors after the caret into the split tail", async () => {
		const { editor, ids } = createDocument(["abcdef"]);
		let anchor = editor.anchors.create({ blockId: ids[0], offset: 4 }, 1)!;
		editor.on("commit", (event) => {
			anchor = repairAnchor(
				editor,
				anchor,
				deriveContentMoves(event.summary, undefined),
			);
		});
		editor.selectText(ids[0], 3, 3);

		await pasteParsed(editor, [paragraph("one"), paragraph("three")]);

		const tailId = editor.documentState.blockOrder[1];
		expect(editor.getBlock(tailId)!.textContent()).toBe("threedef");
		expect(editor.anchors.resolve(anchor)).toEqual({
			blockId: tailId,
			offset: 6,
		});
	});

	it("keeps blocks pasted inside a container in that container", async () => {
		const { editor, ids } = createDocument([""]);
		editor.apply([
			{
				type: "insert-block",
				blockId: "quote",
				blockType: "blockquote",
				props: {},
				position: { before: ids[0] },
			},
			{
				type: "insert-block",
				blockId: "inside",
				blockType: "paragraph",
				props: { parentId: "quote" },
				position: { after: "quote" },
			},
			{
				type: "splice-text",
				blockId: "inside",
				from: 0,
				to: 0,
				insert: "abcdef",
			},
		]);
		editor.selectText("inside", 3, 3);

		await pasteParsed(editor, [
			paragraph("one"),
			{ type: "divider", props: {} },
			paragraph("three"),
		]);

		expect(
			editor.documentState.blockOrder
				.filter((blockId) => blockId !== "quote" && blockId !== ids[0])
				.map((blockId) => editor.documentState.parentOf(blockId)),
		).toEqual(["quote", "quote", "quote"]);
	});

	it("replaces an empty caret line when the first pasted block has children", async () => {
		const { editor, ids } = createDocument(["", "next"]);
		editor.selectText(ids[0], 0, 0);

		await pasteParsed(editor, [
			{ ...paragraph("parent"), children: [paragraph("child")] },
		]);

		expect(editor.documentState.blockOrder).not.toContain(ids[0]);
		expect(readBlocks(editor)[0]).toEqual({
			type: "paragraph",
			text: "parent",
		});
	});

	it("still replaces an empty caret line with the pasted blocks", async () => {
		const { editor, ids } = createDocument(["", "next"]);
		editor.selectText(ids[0], 0, 0);

		await pasteParsed(editor, [
			{ type: "heading", props: { level: 1 }, content: "Title" },
			paragraph("body"),
		]);

		expect(readBlocks(editor)).toEqual([
			{ type: "heading", text: "Title" },
			{ type: "paragraph", text: "body" },
			{ type: "paragraph", text: "next" },
		]);
	});
});

describe("IOP9: Pen clipboard paste lands at the caret", () => {
	it("appends a copied whole line at the caret instead of adding a line", async () => {
		const { editor, ids } = createDocument(["hello", "next"]);
		editor.selectText(ids[0], 0, 5);
		const clipboard = copy(editor);
		editor.selectText(ids[0], 5, 5);

		const fieldEditor = await paste(editor, clipboard);

		expect(readBlocks(editor)).toEqual([
			{ type: "paragraph", text: "hellohello" },
			{ type: "paragraph", text: "next" },
		]);
		expect(fieldEditor.activateTextSelection).toHaveBeenCalledWith(
			ids[0],
			10,
			10,
		);
	});

	it("replaces a whole-line selection with the copied line", async () => {
		const { editor, ids } = createDocument(["hello"]);
		editor.selectText(ids[0], 0, 5);
		const clipboard = copy(editor);

		await paste(editor, clipboard);

		expect(readBlocks(editor)).toEqual([
			{ type: "paragraph", text: "hello" },
		]);
	});

	it("splits the caret line around copied blocks", async () => {
		const { editor, ids } = createDocument(["one", "two", "abcdef"]);
		editor.setSelection({
			type: "text",
			anchor: { blockId: ids[0], offset: 0 },
			focus: { blockId: ids[1], offset: 3 },
		});
		const clipboard = copy(editor);
		editor.selectText(ids[2], 3, 3);

		await paste(editor, clipboard);

		expect(readBlocks(editor).map((block) => block.text)).toEqual([
			"one",
			"two",
			"abcone",
			"twodef",
		]);
	});
});

describe("IOP9: plain-text paste lands at the caret", () => {
	it("keeps the caret line's props on the text after pasted lines", async () => {
		const { editor, ids } = createDocument([""]);
		editor.apply([
			{
				type: "insert-block",
				blockId: "title",
				blockType: "heading",
				props: { level: 2 },
				position: { before: ids[0] },
			},
			{
				type: "splice-text",
				blockId: "title",
				from: 0,
				to: 0,
				insert: "abcdef",
			},
		]);
		editor.selectText("title", 3, 3);

		await paste(editor, new Map([["text/plain", "one\ntwo"]]));

		const [head, tail] = editor.documentState.blockOrder.map((blockId) =>
			editor.getBlock(blockId)!,
		);
		expect(head.id).toBe("title");
		expect(head.textContent()).toBe("abcone");
		expect(tail.textContent()).toBe("twodef");
		expect(tail.props).toMatchObject({ level: 2 });
	});

	it("fills an empty line in place so it keeps its id and props", async () => {
		const { editor, ids } = createDocument([""]);
		editor.apply([
			{
				type: "insert-block",
				blockId: "item",
				blockType: "bulletListItem",
				props: { indent: 1 },
				position: { before: ids[0] },
			},
		]);
		editor.selectText("item", 0, 0);

		await paste(editor, new Map([["text/plain", "one\ntwo"]]));

		const item = editor.getBlock("item")!;
		expect(item.textContent()).toBe("one");
		expect(item.props).toMatchObject({ indent: 1 });
		expect(
			editor.getBlock(editor.documentState.blockOrder[1])!.textContent(),
		).toBe("two");
	});
});

describe("pasteBlocksAtCaret", () => {
	it("drops the paste with a diagnostic when the caret block is gone", () => {
		const { editor } = createDocument(["hello"]);
		const diagnostics: string[] = [];
		editor.on("diagnostic", (event) => diagnostics.push(event.code));
		const apply = vi.spyOn(editor, "apply");

		pasteBlocksAtCaret(
			editor,
			{ activateTextSelection: vi.fn() },
			[paragraph("lost")],
			{
				blockId: "deleted",
				offset: 0,
				blockType: "paragraph",
				isInline: true,
				isEmpty: false,
			},
			{ undoGroup: false },
		);

		expect(apply).not.toHaveBeenCalled();
		expect(readBlocks(editor)).toEqual([
			{ type: "paragraph", text: "hello" },
		]);
		expect(diagnostics).toEqual(["paste-target-missing"]);
	});
});
