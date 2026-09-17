// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@input/pen-core";
import {
	PEN_CLIPBOARD_JSON_MIME,
	PEN_CLIPBOARD_JSON_MIME_LEGACY,
	type Editor,
} from "@input/pen-types";
import { handleCopy, handleCut } from "../field-editor/clipboard";
import { executePasteTransfer } from "../field-editor/transferPaste";
import type { FieldEditorTransferController } from "../field-editor/controller";
import {
	CLIPBOARD_INGEST_MAX_IMAGE_COUNT,
	CLIPBOARD_INGEST_MAX_NESTING_DEPTH,
	CLIPBOARD_INGEST_MAX_TEXT_SIZE,
} from "../utils/clipboardIngest";
import { defaultSchema } from "@input/pen-schema";
import {
	PEN_CLIPBOARD_PAYLOAD_VERSION,
	parsePenClipboardPayload,
	serializePenClipboardPayload,
	type PenBlock,
} from "../utils/clipboardPayload";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function createBareEditor(): Editor {
	return createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
	});
}

function createClipboardData(entries: Record<string, string>): DataTransfer {
	const data = new Map(Object.entries(entries));
	return {
		files: [] as unknown as FileList,
		types: [...data.keys()],
		getData(type: string) {
			return data.get(type) ?? "";
		},
		setData(type: string, value: string) {
			data.set(type, value);
		},
	} as unknown as DataTransfer;
}

function createFieldEditorStub(): FieldEditorTransferController {
	return {
		activateTextSelection: vi.fn(),
	};
}

function hostileHeadingPayload(
	content: string,
	knownProps = '"level":1,"safe":"kept"',
): string {
	return [
		"{",
		`"version":${PEN_CLIPBOARD_PAYLOAD_VERSION},`,
		'"blockTypes":["heading"],',
		'"blocks":[{',
		'"type":"heading",',
		`"props":{${knownProps},"__proto__":{"polluted":true},"constructor":{"polluted":true},"prototype":{"polluted":true}},`,
		`"content":${JSON.stringify(content)},`,
		`"deltas":[{"insert":${JSON.stringify(content)},"attributes":{"bold":true,"__proto__":{"polluted":true}}}]`,
		"}]}",
	].join("");
}

function nestToggles(depth: number): PenBlock {
	if (depth <= 1) {
		return { type: "paragraph", content: "leaf" };
	}
	return {
		type: "toggle",
		content: `d${depth}`,
		children: [nestToggles(depth - 1)],
	};
}

describe("clipboard JSON-flavor paste", () => {
	it("SEC4: rejects __proto__, constructor, and prototype own keys", () => {
		const result = parsePenClipboardPayload(hostileHeadingPayload("Safe"));

		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			return;
		}
		expect(result.forbiddenKeyCount).toBe(4);

		const [block] = result.payload.blocks;
		expect(block).toBeDefined();
		expect(Object.getPrototypeOf(block)).toBeNull();
		expect(Object.getPrototypeOf(block?.props)).toBeNull();
		expect(Object.hasOwn(block?.props ?? {}, "__proto__")).toBe(false);
		expect(Object.hasOwn(block?.props ?? {}, "constructor")).toBe(false);
		expect(Object.hasOwn(block?.props ?? {}, "prototype")).toBe(false);
		expect(block?.props).toEqual({ level: 1, safe: "kept" });
		expect(
			Object.hasOwn(block?.deltas?.[0]?.attributes ?? {}, "__proto__"),
		).toBe(false);
		expect(
			(Object.prototype as { polluted?: boolean }).polluted,
		).toBeUndefined();
	});

	it("SEC4: proto-key JSON flavor paste does not pollute and keeps safe fields", async () => {
		const editor = createBareEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		editor.selectText(emptyBlockId, 0, 0);
		const diagnostics: unknown[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		const handled = await executePasteTransfer({
			source: "paste",
			editor,
			fieldEditor: createFieldEditorStub(),
			dataTransfer: createClipboardData({
				"application/x-pen-blocks": hostileHeadingPayload(
					"Kept",
					'"level":1',
				),
			}),
		});

		expect(handled).toBe(true);
		const block = editor.getBlock(editor.documentState.blockOrder[0]!)!;
		expect(block.type).toBe("heading");
		expect(block.textContent()).toBe("Kept");
		expect(Object.hasOwn(block.props, "__proto__")).toBe(false);
		expect(Object.hasOwn(block.props, "constructor")).toBe(false);
		expect(Object.hasOwn(block.props, "prototype")).toBe(false);
		expect(block.props).toMatchObject({ level: 1 });
		expect(
			(Object.prototype as { polluted?: boolean }).polluted,
		).toBeUndefined();
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "import-dropped",
				droppedByReason: [
					expect.objectContaining({
						reason: "forbidden-key",
						count: 4,
					}),
				],
			}),
		]);

		editor.destroy();
	});

	it("SEC4: spec JSON flavor paste drops unknown props and types with import-dropped", async () => {
		const editor = createBareEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		editor.selectText(emptyBlockId, 0, 0);
		const diagnostics: unknown[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		const handled = await executePasteTransfer({
			source: "paste",
			editor,
			fieldEditor: createFieldEditorStub(),
			dataTransfer: createClipboardData({
				[PEN_CLIPBOARD_JSON_MIME]: serializePenClipboardPayload([
					{
						type: "heading",
						props: { level: 2, extraEvil: "nope" },
						content: "Title",
						deltas: [{ insert: "Title" }],
					},
					{
						type: "not-a-real-block",
						content: "gone",
					},
				]),
			}),
		});

		expect(handled).toBe(true);
		const heading = [...editor.documentState.allBlocks()].find(
			(block) => block.type === "heading",
		);
		expect(heading?.textContent()).toBe("Title");
		expect(heading?.props.level).toBe(2);
		expect(heading?.props).not.toHaveProperty("extraEvil");
		expect(
			[...editor.documentState.allBlocks()].some(
				(block) => block.type === "not-a-real-block",
			),
		).toBe(false);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "import-dropped",
				droppedByReason: expect.arrayContaining([
					expect.objectContaining({ reason: "invalid-props" }),
					expect.objectContaining({ reason: "unknown-block-type" }),
				]),
			}),
		]);

		editor.destroy();
	});

	it("SEC4: copy writes application/x-pen-blocks+json and paste round-trips content", async () => {
		const source = createBareEditor();
		const target = createBareEditor();
		const sourceBlockId = source.firstBlock()!.id;
		const targetBlockId = target.firstBlock()!.id;
		const clipboardData = createClipboardData({});

		source.apply([
			{
				type: "splice-text",
				blockId: sourceBlockId,
				from: 0,
				to: 0,
				insert: "Hello world",
			},
		]);
		source.selectText(sourceBlockId, 0, 11);
		handleCopy(source, { clipboardData } as ClipboardEvent);

		const specFlavor = clipboardData.getData(PEN_CLIPBOARD_JSON_MIME);
		const legacyFlavor = clipboardData.getData(
			PEN_CLIPBOARD_JSON_MIME_LEGACY,
		);
		expect(specFlavor).toBe(legacyFlavor);
		expect(specFlavor.length).toBeGreaterThan(0);
		const copied = parsePenClipboardPayload(specFlavor);
		expect(copied.status).toBe("ok");
		if (copied.status === "ok") {
			expect(copied.payload.blocks[0]?.content).toBe("Hello world");
		}

		const specOnly = createClipboardData({
			[PEN_CLIPBOARD_JSON_MIME]: specFlavor,
		});
		target.selectText(targetBlockId, 0, 0);
		await executePasteTransfer({
			source: "paste",
			editor: target,
			dataTransfer: specOnly,
			fieldEditor: createFieldEditorStub(),
		});

		expect(target.getBlock(target.firstBlock()!.id)?.textContent()).toBe(
			"Hello world",
		);

		source.destroy();
		target.destroy();
	});

	it("IOP7: cut then paste keeps an inline atom in the Pen JSON flavor", async () => {
		const editor = createBareEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: [
					"hello ",
					{
						nodeType: "mention",
						props: { id: "user-1", label: "Ada" },
					},
					" world",
				],
			},
		]);

		expect(editor.getBlock(blockId)!.inlineDeltas()).toEqual([
			{ insert: "hello " },
			{
				insert: {
					type: "mention",
					props: { id: "user-1", label: "Ada" },
				},
			},
			{ insert: " world" },
		]);

		const clipboardData = createClipboardData({});
		editor.selectText(blockId, 0, editor.getBlock(blockId)!.length());
		handleCut(editor, { clipboardData } as ClipboardEvent);

		const specFlavor = clipboardData.getData(PEN_CLIPBOARD_JSON_MIME);
		const copied = parsePenClipboardPayload(specFlavor);
		expect(copied.status).toBe("ok");
		if (copied.status === "ok") {
			expect(copied.payload.blocks[0]?.deltas).toEqual([
				{ insert: "hello " },
				{
					insert: {
						type: "mention",
						props: { id: "user-1", label: "Ada" },
					},
				},
				{ insert: " world" },
			]);
		}

		const remaining = editor.firstBlock()!;
		expect(remaining.textContent()).toBe("");
		expect(
			remaining
				.inlineDeltas()
				.some((delta) => typeof delta.insert !== "string"),
		).toBe(false);

		editor.selectText(remaining.id, 0, 0);
		await executePasteTransfer({
			source: "paste",
			editor,
			dataTransfer: createClipboardData({
				[PEN_CLIPBOARD_JSON_MIME]: specFlavor,
			}),
			fieldEditor: createFieldEditorStub(),
		});

		const pasted = editor.getBlock(editor.firstBlock()!.id)!;
		expect(pasted.inlineDeltas()).toEqual([
			{ insert: "hello " },
			{
				insert: {
					type: "mention",
					props: { id: "user-1", label: "Ada" },
				},
			},
			{ insert: " world" },
		]);

		editor.destroy();
	});

	it("SEC4: oversized clipboard JSON emits import-truncated", async () => {
		const editor = createBareEditor();
		editor.selectText(editor.firstBlock()!.id, 0, 0);
		const diagnostics: unknown[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		await executePasteTransfer({
			source: "paste",
			editor,
			fieldEditor: createFieldEditorStub(),
			dataTransfer: createClipboardData({
				[PEN_CLIPBOARD_JSON_MIME]: serializePenClipboardPayload([
					nestToggles(CLIPBOARD_INGEST_MAX_NESTING_DEPTH + 1),
				]),
			}),
		});

		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "import-truncated",
				droppedByReason: [
					expect.objectContaining({
						reason: "depth-exceeded",
						bound: "CLIPBOARD_INGEST_MAX_NESTING_DEPTH",
					}),
				],
			}),
		]);

		editor.destroy();
	});

	it("IOP5: paste drops image blocks past the 256 image cap and emits import-truncated", async () => {
		const editor = createBareEditor();
		editor.selectText(editor.firstBlock()!.id, 0, 0);
		const diagnostics: unknown[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		const overflow = 2;

		await executePasteTransfer({
			source: "paste",
			editor,
			fieldEditor: createFieldEditorStub(),
			dataTransfer: createClipboardData({
				[PEN_CLIPBOARD_JSON_MIME]: serializePenClipboardPayload(
					Array.from(
						{ length: CLIPBOARD_INGEST_MAX_IMAGE_COUNT + overflow },
						(_, index) => ({
							type: "image",
							props: { src: `https://example.com/${index}.png` },
						}),
					),
				),
			}),
		});

		const imageCount = [...editor.documentState.allBlocks()].filter(
			(block) => block.type === "image",
		).length;
		expect(imageCount).toBe(CLIPBOARD_INGEST_MAX_IMAGE_COUNT);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "import-truncated",
				droppedByReason: [
					expect.objectContaining({
						reason: "image-count-exceeded",
						count: overflow,
						bound: "CLIPBOARD_INGEST_MAX_IMAGE_COUNT",
					}),
				],
			}),
		]);

		editor.destroy();
	});

	it("IOP5: paste drops blocks past the 1 MiB text cap and emits import-truncated", async () => {
		const editor = createBareEditor();
		editor.selectText(editor.firstBlock()!.id, 0, 0);
		const diagnostics: unknown[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		await executePasteTransfer({
			source: "paste",
			editor,
			fieldEditor: createFieldEditorStub(),
			dataTransfer: createClipboardData({
				[PEN_CLIPBOARD_JSON_MIME]: serializePenClipboardPayload([
					{
						type: "paragraph",
						content: "x".repeat(CLIPBOARD_INGEST_MAX_TEXT_SIZE),
					},
					{ type: "paragraph", content: "overflow" },
				]),
			}),
		});

		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "import-truncated",
				droppedByReason: [
					expect.objectContaining({
						reason: "text-size-exceeded",
						bound: "CLIPBOARD_INGEST_MAX_TEXT_SIZE",
					}),
				],
			}),
		]);
		const pasted = [...editor.documentState.allBlocks()].find(
			(block) =>
				block.textContent().length === CLIPBOARD_INGEST_MAX_TEXT_SIZE,
		);
		expect(pasted).toBeDefined();
		expect(
			[...editor.documentState.allBlocks()].some(
				(block) => block.textContent() === "overflow",
			),
		).toBe(false);

		editor.destroy();
	});

	it("pasting a URL onto a text selection applies a link mark and keeps the text", async () => {
		const editor = createBareEditor();
		const blockId = editor.firstBlock()!.id;
		const href = "http://localhost:5173/";
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "selected text",
			},
		]);
		editor.selectText(blockId, 0, 13);

		const handled = await executePasteTransfer({
			source: "paste",
			editor,
			fieldEditor: createFieldEditorStub(),
			dataTransfer: createClipboardData({
				"text/plain": href,
			}),
		});

		expect(handled).toBe(true);
		const block = editor.getBlock(blockId)!;
		expect(block.textContent()).toBe("selected text");
		const link = block.textDeltas().find((delta) => delta.attributes?.link);
		expect(
			(link?.attributes?.link as { href?: string } | undefined)?.href,
		).toBe(href);

		editor.destroy();
	});

	it("pasting a URL with Chrome HTML wrapper still links the selection", async () => {
		const editor = createBareEditor();
		const blockId = editor.firstBlock()!.id;
		const href = "http://localhost:5173/";
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "selected text",
			},
		]);
		editor.selectText(blockId, 0, 13);

		const handled = await executePasteTransfer({
			source: "paste",
			editor,
			fieldEditor: createFieldEditorStub(),
			dataTransfer: createClipboardData({
				"text/plain": href,
				"text/html": `<meta charset='utf-8'>${href}`,
			}),
		});

		expect(handled).toBe(true);
		const block = editor.getBlock(blockId)!;
		expect(block.textContent()).toBe("selected text");
		const link = block.textDeltas().find((delta) => delta.attributes?.link);
		expect(
			(link?.attributes?.link as { href?: string } | undefined)?.href,
		).toBe(href);

		editor.destroy();
	});

	it("does not treat javascript: clipboard text as a pasteable link", async () => {
		const editor = createBareEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);

		const handled = await executePasteTransfer({
			source: "paste",
			editor,
			fieldEditor: createFieldEditorStub(),
			dataTransfer: createClipboardData({
				"text/plain": "javascript:alert(1)",
			}),
		});

		expect(handled).toBe(true);
		const block = editor.getBlock(blockId)!;
		expect(block.textContent()).toBe("javascript:alert(1)");
		expect(
			block.textDeltas().some((delta) => Boolean(delta.attributes?.link)),
		).toBe(false);

		editor.destroy();
	});

	it("pasting a URL on a collapsed caret inserts the URL as a hyperlink", async () => {
		const editor = createBareEditor();
		const blockId = editor.firstBlock()!.id;
		const href = "http://localhost:5173/";
		editor.selectText(blockId, 0, 0);

		const handled = await executePasteTransfer({
			source: "paste",
			editor,
			fieldEditor: createFieldEditorStub(),
			dataTransfer: createClipboardData({
				"text/plain": href,
			}),
		});

		expect(handled).toBe(true);
		const block = editor.getBlock(blockId)!;
		expect(block.textContent()).toBe(href);
		const link = block.textDeltas().find((delta) => delta.attributes?.link);
		expect(
			(link?.attributes?.link as { href?: string } | undefined)?.href,
		).toBe(href);

		editor.destroy();
	});

	it("SEC4: JSON-flavor paste does not pre-launder javascript: URLs", async () => {
		const editor = createBareEditor();
		editor.selectText(editor.firstBlock()!.id, 0, 0);
		const href = "javascript:alert(1)";

		await executePasteTransfer({
			source: "paste",
			editor,
			fieldEditor: createFieldEditorStub(),
			dataTransfer: createClipboardData({
				[PEN_CLIPBOARD_JSON_MIME]: serializePenClipboardPayload([
					{
						type: "heading",
						props: { level: 1 },
						content: "go",
						deltas: [
							{
								insert: "go",
								attributes: { link: { href } },
							},
						],
					},
					{
						type: "image",
						props: { src: href, alt: "x" },
					},
				]),
			}),
		});

		const heading = [...editor.documentState.allBlocks()].find(
			(block) => block.type === "heading",
		);
		const image = [...editor.documentState.allBlocks()].find(
			(block) => block.type === "image",
		);
		const link = heading
			?.textDeltas()
			.find((delta) => delta.attributes?.link);
		expect(
			(link?.attributes?.link as { href?: string } | undefined)?.href,
		).toBe(href);
		expect(image?.props.src).toBe(href);

		editor.destroy();
	});
});
