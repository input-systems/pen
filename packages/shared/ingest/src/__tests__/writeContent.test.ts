import { createDefaultSchema } from "./fixtures/testSchema";
import { describe, expect, it, vi } from "vitest";
import { parseMarkdownToBlocks } from "../markdown";
import { buildDocumentWriteOps } from "../writeContent";

const schema = createDefaultSchema();

function createEditorStub(documentProfile: "structured" | "flow") {
	return {
		documentProfile,
		schema,
		internals: {
			emit: vi.fn(),
		},
	};
}

describe("@input/pen-ingest", () => {
	it("builds structured ops from markdown content", () => {
		const editor = createEditorStub("structured");

		const result = buildDocumentWriteOps(editor, {
			format: "markdown",
			content: "# Heading\n\n- Item",
			position: "last",
			surface: "test",
		});

		expect(result.blocks.map((block) => block.type)).toEqual([
			"heading",
			"bulletListItem",
		]);
		expect(
			result.ops.filter((op) => op.type === "insert-block"),
		).toHaveLength(2);
	});

	it("keeps flow-delegated table blocks during markdown normalization", () => {
		const editor = createEditorStub("flow");
		const markdown = "| Name |\n| --- |\n| Ship |\n\n## Allowed";

		const result = buildDocumentWriteOps(editor, {
			format: "markdown",
			content: markdown,
			position: "last",
			surface: "test",
		});

		expect(result.blocks.map((block) => block.type)).toEqual([
			"table",
			"heading",
		]);
	});

	it("preserves consecutive empty paragraph blocks from markdown", () => {
		expect(
			parseMarkdownToBlocks("Before\n\nAfter", { schema }).map(
				(block) => block.content,
			),
		).toEqual(["Before", "After"]);
		expect(
			parseMarkdownToBlocks("Before\n\n\n\nAfter", { schema }).map(
				(block) => block.content,
			),
		).toEqual(["Before", "", "After"]);
		expect(
			parseMarkdownToBlocks("Before\n\n\n\n\n\nAfter", { schema }).map(
				(block) => block.content,
			),
		).toEqual(["Before", "", "", "After"]);
	});

	it("lifts image-only paragraphs into image blocks", () => {
		const blocks = parseMarkdownToBlocks(
			'![alt text](https://example.com/image.png "caption")',
			{ schema },
		);

		expect(blocks).toEqual([
			expect.objectContaining({
				type: "image",
				props: expect.objectContaining({
					src: "https://example.com/image.png",
					alt: "alt text",
					caption: "caption",
				}),
			}),
		]);
	});

	it("keeps heading and list item text, not just block types", () => {
		const editor = createEditorStub("structured");

		const result = buildDocumentWriteOps(editor, {
			format: "markdown",
			content: "# Heading\n\n- Item",
			position: "last",
		});

		expect(result.blocks).toEqual([
			expect.objectContaining({
				type: "heading",
				content: "Heading",
			}),
			expect.objectContaining({
				type: "bulletListItem",
				content: "Item",
			}),
		]);
		expect(
			result.ops
				.filter((op) => op.type === "splice-text")
				.map((op) => op.insert),
		).toEqual(["Heading", "Item"]);
	});

	it("keeps bold and italic marks from markdown inline nodes", () => {
		const editor = createEditorStub("structured");

		const result = buildDocumentWriteOps(editor, {
			format: "markdown",
			content: "**bold** and *italic*",
			position: "last",
		});

		expect(result.blocks).toEqual([
			expect.objectContaining({
				type: "paragraph",
				content: "bold and italic",
				marks: [
					{ type: "bold", start: 0, end: 4 },
					{ type: "italic", start: 9, end: 15 },
				],
			}),
		]);
	});

	it("keeps underline marks from Pen markdown", () => {
		const editor = createEditorStub("structured");

		const result = buildDocumentWriteOps(editor, {
			format: "markdown",
			content: "plain <u>underlined</u> plain",
			position: "last",
		});

		expect(result.blocks).toEqual([
			expect.objectContaining({
				type: "paragraph",
				content: "plain underlined plain",
				marks: [{ type: "underline", start: 6, end: 16 }],
			}),
		]);
	});

	it("keeps table cell text from GFM tables", () => {
		const editor = createEditorStub("structured");

		const result = buildDocumentWriteOps(editor, {
			format: "markdown",
			content: "| Name |\n| --- |\n| Ship |",
			position: "last",
		});

		expect(result.blocks).toEqual([
			expect.objectContaining({
				type: "table",
				children: [
					expect.objectContaining({
						type: "__table_row",
						children: [
							expect.objectContaining({
								type: "__table_cell",
								content: "Name",
							}),
						],
					}),
					expect.objectContaining({
						type: "__table_row",
						children: [
							expect.objectContaining({
								type: "__table_cell",
								content: "Ship",
							}),
						],
					}),
				],
			}),
		]);
	});

	it("returns no ops when any block type is hidden from tooling", () => {
		const editor = createEditorStub("structured");

		const result = buildDocumentWriteOps(editor, {
			format: "blocks",
			blocks: [
				{ blockType: "paragraph", content: "Allowed" },
				{ blockType: "subdocument", content: "Blocked" },
			],
			position: "last",
		});

		expect(result.blocks).toEqual([]);
		expect(result.ops).toEqual([]);
		expect(editor.internals.emit).toHaveBeenCalledWith(
			"diagnostic",
			expect.objectContaining({
				code: "ingest-unexposed-block",
				source: "ingest",
				message:
					'Block type "subdocument" is not available in structured documents.',
			}),
		);
	});

	it.each([
		["bullet", "- First\n\n\n\n- Second", "bulletListItem"],
		["numbered", "1. First\n\n\n\n2. Second", "numberedListItem"],
		["check", "- [ ] First\n\n\n\n- [x] Second", "checkListItem"],
	] as const)(
		"preserves an empty paragraph between %s list items",
		(_name, markdown, listItemType) => {
			const blocks = parseMarkdownToBlocks(markdown, { schema });

			expect(blocks.map((block) => block.type)).toEqual([
				listItemType,
				"paragraph",
				listItemType,
			]);
			expect(blocks.map((block) => block.content)).toEqual([
				"First",
				"",
				"Second",
			]);
		},
	);

	it("returns no ops when an unknown type is mixed with an allowed sibling", () => {
		const editor = createEditorStub("structured");

		const result = buildDocumentWriteOps(editor, {
			format: "blocks",
			blocks: [
				{ blockType: "paragraph", content: "Allowed sibling" },
				{
					blockType: "not-a-real-type",
					content: "Dropped by normalize",
				},
			],
			position: "last",
		});

		// Normalize would strip the unknown type and keep the paragraph.
		// The write path must not treat that as a successful partial apply.
		expect(result.blocks).toEqual([]);
		expect(result.ops).toEqual([]);
		expect(editor.internals.emit).toHaveBeenCalledWith(
			"diagnostic",
			expect.objectContaining({
				code: "ingest-unexposed-block",
				source: "ingest",
				message:
					'Block type "not-a-real-type" is not available in structured documents.',
			}),
		);
	});
});
