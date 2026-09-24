// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createEditor as createCoreEditor } from "@input/pen-core";
import type { AssetProvider } from "@input/pen-types";
import { defaultPreset } from "@input/pen";
import {
	getPasteImporters,
	handleClipboardPaste,
	handleCopy,
} from "@input/pen-dom/field-editor/clipboard";
import type { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import type { PasteImporters } from "../context/editorContext";
import { defaultSchema } from "@input/pen-schema";

function createEditor(
	options: Parameters<typeof createCoreEditor>[0] = {},
	config: {
		undo?: boolean;
	} = {},
) {
	return createCoreEditor({
		schema: defaultSchema,
		...options,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: config.undo ?? false,
		}),
	});
}

function createFileList(files: File[]): FileList {
	return Object.assign([...files], {
		item(index: number) {
			return files[index] ?? null;
		},
	}) as unknown as FileList;
}

function createClipboardData(files: File[] = []): DataTransfer {
	const data = new Map<string, string>();
	const types: string[] = files.length > 0 ? ["Files"] : [];

	return {
		files: createFileList(files),
		types,
		getData(type: string) {
			return data.get(type) ?? "";
		},
		setData(type: string, value: string) {
			data.set(type, value);
		},
	} as unknown as DataTransfer;
}

function createFieldEditorStub(): FieldEditorImpl {
	return {
		activateTextSelection: vi.fn(),
	} as unknown as FieldEditorImpl;
}

function getClipboardPenBlocks(
	clipboardData: DataTransfer,
): Array<{ type?: string; content?: string }> {
	const parsed = JSON.parse(
		clipboardData.getData("application/x-pen-blocks"),
	) as
		| { blocks?: Array<{ type?: string; content?: string }> }
		| Array<{
				type?: string;
				content?: string;
		  }>;
	return Array.isArray(parsed) ? parsed : (parsed.blocks ?? []);
}

function seedTable(
	editor: ReturnType<typeof createEditor>,
	tableId: string,
): void {
	editor.apply([
		{
			type: "insert-block",
			blockId: tableId,
			blockType: "table",
			props: {},
			position: "last",
		},
		{
			type: "splice-text",
			blockId: tableId,
			cell: { row: 0, col: 0 },
			from: 0,
			to: 0,
			insert: "Alpha",
		},
		{
			type: "splice-text",
			blockId: tableId,
			cell: { row: 0, col: 1 },
			from: 0,
			to: 0,
			insert: "Bravo",
		},
	]);
}

describe("@input/pen-react clipboard: importer parsing", () => {
	it("preserves Apple Notes numbered and bullet lists through the paste pipeline", async () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		const html =
			'<style>span.s1 {text-decoration: underline} ol.ol1 {list-style-type: decimal} ul.ul1 {list-style-type: disc}</style><p style="text-align: center">normal, <b>bold</b>, <i>italic</i>, <span class="s1">underline</span></p><ol class="ol1"><li>numbered</li><li>bullets</li></ol><p><br></p><ul class="ul1"><li>dotted</li><li>Bullets</li></ul>';
		clipboardData.setData("text/html", html);
		editor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
			getPasteImporters(editor),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const blocks = editor.documentState.blockOrder.map((blockId) =>
			editor.getBlock(blockId),
		);
		expect(
			blocks.map((block) => ({
				type: block?.type,
				text: block?.textContent(),
				textAlignment: block?.props.textAlignment,
			})),
		).toEqual([
			{
				type: "paragraph",
				text: "normal, bold, italic, underline",
				textAlignment: "center",
			},
			{ type: "numberedListItem", text: "numbered", textAlignment: undefined },
			{ type: "numberedListItem", text: "bullets", textAlignment: undefined },
			{ type: "paragraph", text: "\n", textAlignment: undefined },
			{ type: "bulletListItem", text: "dotted", textAlignment: undefined },
			{ type: "bulletListItem", text: "Bullets", textAlignment: undefined },
		]);
		expect(blocks[0]?.textDeltas()).toEqual([
			{ insert: "normal, " },
			{ insert: "bold", attributes: { bold: true } },
			{ insert: ", " },
			{ insert: "italic", attributes: { italic: true } },
			{ insert: ", " },
			{ insert: "underline", attributes: { underline: true } },
		]);

		editor.destroy();
	});

	it("keeps HTML paragraph parsing when inline marks are preserved", async () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi.fn().mockReturnValue([
					{
						type: "paragraph",
						props: {},
						content: "First paragraph.\n\nSecond paragraph.",
						marks: [{ type: "bold", start: 0, end: 5 }],
					},
				]),
				import: vi.fn(),
				name: "html",
				mimeType: "text/html",
			},
			markdown: {
				parse: vi.fn().mockReturnValue([
					{
						type: "paragraph",
						props: {},
						content: "First paragraph.",
					},
					{
						type: "paragraph",
						props: {},
						content: "Second paragraph.",
					},
				]),
				import: vi.fn(),
				name: "markdown",
				mimeType: "text/plain",
			},
		};

		clipboardData.setData(
			"text/html",
			"<span><strong>First</strong> paragraph.<br><br>Second paragraph.</span>",
		);
		clipboardData.setData(
			"text/plain",
			"First paragraph.\n\nSecond paragraph.",
		);
		editor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
			importers,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const block = editor.getBlock(editor.documentState.blockOrder[0]!)!;
		expect(block.textDeltas()).toEqual([
			{ insert: "First", attributes: { bold: true } },
			{ insert: " paragraph.\n\nSecond paragraph." },
		]);
		expect(importers.markdown?.parse).not.toHaveBeenCalled();
		expect(importers.html?.import).not.toHaveBeenCalled();

		editor.destroy();
	});

	it("keeps an empty block when importer parse yields no blocks", async () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi.fn().mockReturnValue([]),
				import: vi.fn(),
				name: "html",
				mimeType: "text/html",
			},
		};

		clipboardData.setData("text/html", "<script>alert('xss')</script>");
		editor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
			importers,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(editor.documentState.blockOrder).toEqual([emptyBlockId]);
		expect(editor.getBlock(emptyBlockId)?.type).toBe("paragraph");
		expect(importers.html?.import).toHaveBeenCalledTimes(1);

		editor.destroy();
	});

	it("filters unknown importer parse blocks in flow documents before applying parsed paste", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi.fn().mockReturnValue([
					{
						type: "customWidget",
						props: {},
						content: "Ignored",
					},
					{
						type: "heading",
						props: { level: 2 },
						content: "Allowed title",
					},
				]),
				import: vi.fn(),
				name: "html",
				mimeType: "text/html",
			},
		};

		clipboardData.setData("text/html", "<div>mixed</div>");
		editor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
			importers,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const blockOrder = editor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(1);
		expect(blockOrder[0]).not.toBe(emptyBlockId);
		expect(editor.getBlock(blockOrder[0])?.type).toBe("heading");
		expect(
			blockOrder.some(
				(blockId) => editor.getBlock(blockId)?.type === "customWidget",
			),
		).toBe(false);
		expect(importers.html?.import).not.toHaveBeenCalled();
		expect(fieldEditor.activateTextSelection).toHaveBeenCalledWith(
			blockOrder[0],
			13,
			13,
		);

		editor.destroy();
	});

	it("filters unknown importer parse blocks before applying parsed paste", async () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi.fn().mockReturnValue([
					{ type: "customWidget", props: {}, content: "Ignored" },
					{
						type: "heading",
						props: { level: 2 },
						content: "Allowed title",
					},
				]),
				import: vi.fn(),
				name: "html",
				mimeType: "text/html",
			},
		};

		clipboardData.setData("text/html", "<div>mixed</div>");
		editor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
			importers,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const blockOrder = editor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(1);
		expect(blockOrder[0]).not.toBe(emptyBlockId);
		expect(editor.getBlock(blockOrder[0])?.type).toBe("heading");
		expect(importers.html?.import).not.toHaveBeenCalled();
		expect(fieldEditor.activateTextSelection).toHaveBeenCalledWith(
			blockOrder[0],
			13,
			13,
		);

		editor.destroy();
	});

	it("round-trips a structured table block selection as a table block payload", () => {
		const sourceEditor = createEditor();
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		seedTable(sourceEditor, "table-structured");
		sourceEditor.selectBlock("table-structured");
		handleCopy(sourceEditor, { clipboardData } as ClipboardEvent);

		expect(
			getClipboardPenBlocks(clipboardData).map((block) => block.type),
		).toEqual(["table"]);

		const targetEditor = createEditor();
		const emptyBlockId = targetEditor.firstBlock()!.id;
		targetEditor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			targetEditor,
			fieldEditor,
		);

		const blockOrder = targetEditor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(1);
		expect(targetEditor.getBlock(blockOrder[0])?.type).toBe("table");
		expect(
			targetEditor
				.getBlock(blockOrder[0])!
				.as("table")
				?.tableCell(0, 0)
				?.textContent(),
		).toBe("Alpha");
		expect(
			targetEditor
				.getBlock(blockOrder[0])!
				.as("table")
				?.tableCell(0, 1)
				?.textContent(),
		).toBe("Bravo");

		sourceEditor.destroy();
		targetEditor.destroy();
	});

	it("round-trips a flow-promoted table selection as document blocks", () => {
		const sourceEditor = createEditor({
			documentProfile: "flow",
		});
		const firstBlockId = sourceEditor.firstBlock()!.id;
		const paragraphId = crypto.randomUUID();
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		sourceEditor.apply([
			{
				type: "splice-text",
				blockId: firstBlockId,
				from: 0,
				to: 0,
				insert: "Intro",
			},
		]);
		seedTable(sourceEditor, "table-flow");
		sourceEditor.apply([
			{
				type: "insert-block",
				blockId: paragraphId,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: paragraphId,
				from: 0,
				to: 0,
				insert: "After",
			},
		]);

		sourceEditor.selectTextRange(
			{ blockId: firstBlockId, offset: 0 },
			{ blockId: paragraphId, offset: 5 },
		);
		handleCopy(sourceEditor, { clipboardData } as ClipboardEvent);

		expect(
			getClipboardPenBlocks(clipboardData).map((block) => block.type),
		).toEqual(["paragraph", "table", "paragraph"]);

		const targetEditor = createEditor();
		const emptyBlockId = targetEditor.firstBlock()!.id;
		targetEditor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			targetEditor,
			fieldEditor,
		);

		const blockOrder = targetEditor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(3);
		expect(targetEditor.getBlock(blockOrder[0])?.textContent()).toBe(
			"Intro",
		);
		expect(targetEditor.getBlock(blockOrder[1])?.type).toBe("table");
		expect(
			targetEditor
				.getBlock(blockOrder[1])!
				.as("table")
				?.tableCell(0, 0)
				?.textContent(),
		).toBe("Alpha");
		expect(targetEditor.getBlock(blockOrder[2])?.textContent()).toBe(
			"After",
		);

		sourceEditor.destroy();
		targetEditor.destroy();
	});
});
