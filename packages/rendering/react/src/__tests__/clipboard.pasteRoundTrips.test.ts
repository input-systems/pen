// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createEditor as createCoreEditor } from "@input/pen-core";
import type { AssetProvider } from "@input/pen-types";
import { defaultPreset } from "@input/pen";
import {
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

describe("@input/pen-react clipboard: paste round-trips", () => {
	it("preserves inline formatting for internal copy/paste round-trips", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hi there",
			},
			{
				type: "format-text",
				blockId,
				from: 0,
				to: 0 + 2,
				marks: { bold: true },
			},
		]);

		editor.selectText(blockId, 0, 2);
		handleCopy(editor, { clipboardData } as ClipboardEvent);

		editor.selectText(blockId, 8, 8);
		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);

		expect(editor.getBlock(blockId)?.textDeltas()).toEqual([
			{ insert: "Hi", attributes: { bold: true } },
			{ insert: " there" },
			{ insert: "Hi", attributes: { bold: true } },
		]);

		editor.destroy();
	});

	it("supports unicode round-trips through embedded HTML payloads", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "a 文🦄 z",
			},
		]);

		editor.selectText(blockId, 2, 5);
		handleCopy(editor, { clipboardData } as ClipboardEvent);

		clipboardData.setData("application/x-pen-blocks", "");
		editor.selectText(blockId, 7, 7);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);

		expect(editor.getBlock(blockId)?.textContent()).toBe("a 文🦄 z文🦄");

		editor.destroy();
	});

	it("undoes paste-over-selection as a single history entry", async () => {
		const editor = createEditor({}, { undo: true });
		const blockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		clipboardData.setData("text/plain", "X");

		editor.selectText(blockId, 1, 4);
		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(editor.getBlock(blockId)?.textContent()).toBe("HXo");
		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("does not delete the current selection when image upload fails", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = createFieldEditorStub();
		const clipboardData = createClipboardData([
			new File(["image"], "test.png", { type: "image/png" }),
		]);
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockRejectedValue(new Error("upload failed")),
			resolve(ref) {
				return ref.url;
			},
			async delete() {},
		};

		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 0, 5);
		editor.internals.assignSlot("paste:assetProvider", assetProvider);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(assetProvider.upload).toHaveBeenCalledTimes(1);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("pastes uploaded images through the transfer pipeline", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = createFieldEditorStub();
		const clipboardData = createClipboardData([
			new File(["image"], "test.png", { type: "image/png" }),
		]);
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockResolvedValue({
				url: "memory://test.png",
				mimeType: "image/png",
			}),
			resolve(ref) {
				return ref.url;
			},
			async delete() {},
		};

		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);
		editor.internals.assignSlot("paste:assetProvider", assetProvider);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const blockOrder = editor.documentState.blockOrder;
		const insertedImageId = blockOrder[1];
		const insertedImage = insertedImageId
			? editor.getBlock(insertedImageId)
			: null;

		expect(assetProvider.upload).toHaveBeenCalledTimes(1);
		expect(blockOrder).toHaveLength(2);
		expect(insertedImage?.type).toBe("image");
		expect(insertedImage?.props).toMatchObject({
			src: "memory://test.png",
			alt: "test",
		});

		editor.destroy();
	});

	it("replaces an empty block when pasting blocks into it", () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		const penBlocks = JSON.stringify([
			{
				type: "heading",
				props: { level: 1 },
				content: "Title",
				deltas: [{ insert: "Title" }],
			},
		]);
		clipboardData.setData("application/x-pen-blocks", penBlocks);

		editor.selectText(emptyBlockId, 0, 0);
		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);

		const blockOrder = editor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(1);
		const block = editor.getBlock(blockOrder[0])!;
		expect(block.type).toBe("heading");
		expect(block.textContent()).toBe("Title");

		editor.destroy();
	});

	it("IOP9: joins a pasted block into a non-empty caret line", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "existing",
			},
		]);

		const penBlocks = JSON.stringify([
			{
				type: "heading",
				props: { level: 1 },
				content: "Title",
				deltas: [{ insert: "Title" }],
			},
		]);
		clipboardData.setData("application/x-pen-blocks", penBlocks);

		editor.selectText(blockId, 8, 8);
		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);

		const blockOrder = editor.documentState.blockOrder;
		expect(blockOrder).toEqual([blockId]);
		expect(editor.getBlock(blockId)!.type).toBe("paragraph");
		expect(editor.getBlock(blockId)!.textContent()).toBe("existingTitle");

		editor.destroy();
	});

	it("replaces an empty block through importer parse output", async () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi
					.fn()
					.mockReturnValue([
						{
							type: "heading",
							props: { level: 2 },
							content: "Parsed title",
						},
					]),
				import: vi.fn(),
				name: "html",
				mimeType: "text/html",
			},
		};

		clipboardData.setData("text/html", "<h2>Parsed title</h2>");
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
		expect(editor.getBlock(blockOrder[0])?.textContent()).toBe(
			"Parsed title",
		);
		expect(importers.html?.import).not.toHaveBeenCalled();
		expect(fieldEditor.activateTextSelection).toHaveBeenCalledWith(
			blockOrder[0],
			12,
			12,
		);

		editor.destroy();
	});

	it("prefers markdown paragraph parsing when HTML collapses blank-line text", async () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi
					.fn()
					.mockReturnValue([
						{
							type: "paragraph",
							props: {},
							content: "First paragraph.\n\nSecond paragraph.",
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
			"<span>First paragraph.<br><br>Second paragraph.</span>",
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

		const blockOrder = editor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(2);
		expect(editor.getBlock(blockOrder[0])?.textContent()).toBe(
			"First paragraph.",
		);
		expect(editor.getBlock(blockOrder[1])?.textContent()).toBe(
			"Second paragraph.",
		);
		expect(importers.html?.import).not.toHaveBeenCalled();
		expect(importers.markdown?.parse).toHaveBeenCalledWith(
			"First paragraph.\n\nSecond paragraph.",
			editor,
		);

		editor.destroy();
	});
});
