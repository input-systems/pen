import { describe, expect, it, vi } from "vitest";
import { ToolContextImpl } from "../toolContext";
import { readDocumentTool } from "../tools/readDocument";
import { searchDocumentTool } from "../tools/searchDocument";
import { retrieveDocumentSpansTool } from "../tools/retrieveDocumentSpans";
import { deleteBlockTool } from "../tools/deleteBlock";
import { moveBlockTool } from "../tools/moveBlock";
import { updateBlockTool } from "../tools/updateBlock";
import {
	createNestedDocumentEditor,
	createReadDocumentEditor,
	createStructuredTargetEditor,
} from "./tools.testHelpers";

describe("@input/pen-tools tools: mutation guards and nested reads", () => {
	it("rejects block mutations against read-only targets", async () => {
		const editor = createStructuredTargetEditor("subdocument-1");

		await expect(
			updateBlockTool(editor).handler(
				{
					blockId: "subdocument-1",
					props: { title: "Forbidden" },
				},
				{} as never,
			),
		).rejects.toThrow(
			'Block "subdocument-1" of type "subdocument" is not editable in structured documents.',
		);
		await expect(
			deleteBlockTool(editor).handler(
				{ blockId: "subdocument-1" },
				{} as never,
			),
		).rejects.toThrow(
			'Block "subdocument-1" of type "subdocument" is not editable in structured documents.',
		);
		await expect(
			moveBlockTool(editor).handler(
				{
					blockId: "subdocument-1",
					position: "last",
				},
				{} as never,
			),
		).rejects.toThrow(
			'Block "subdocument-1" of type "subdocument" is not editable in structured documents.',
		);

		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("guards ToolContext block mutations with the same policy", () => {
		const editor = createStructuredTargetEditor("subdocument-1");
		const emit = vi.fn();
		const context = new ToolContextImpl(editor, "doc-1", emit);

		expect(() =>
			context.updateBlock("subdocument-1", { title: "Forbidden" }),
		).toThrow(
			'Block "subdocument-1" of type "subdocument" is not editable in structured documents.',
		);
		expect(() => context.deleteBlock("subdocument-1")).toThrow(
			'Block "subdocument-1" of type "subdocument" is not editable in structured documents.',
		);

		expect(emit).not.toHaveBeenCalled();
		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("returns raw text when suggestions are included", async () => {
		const editor = createReadDocumentEditor();

		const result = (await readDocumentTool(editor).handler(
			{
				format: "json",
				includeSuggestions: true,
			},
			{} as never,
		)) as {
			viewMode: string;
			blocks: Array<{ id: string; content: string }>;
		};

		expect(result.viewMode).toBe("raw");
		expect(
			result.blocks.find((block) => block.id === "block-2")?.content,
		).toBe("Second draft");
	});

	it("includes nested blocks when reading document ranges", async () => {
		const editor = createNestedDocumentEditor();

		const result = (await readDocumentTool(editor).handler(
			{ format: "summary" },
			{} as never,
		)) as {
			preview: Array<{ id: string }>;
		};

		expect(result.preview.map((block) => block.id)).toEqual([
			"heading-1",
			"layout-1",
			"paragraph-1",
		]);
	});

	it("searches nested blocks through the shared document traversal", async () => {
		const editor = createNestedDocumentEditor();

		const result = (await searchDocumentTool(editor).handler(
			{ query: "stable block identity" },
			{} as never,
		)) as Array<{ blockId: string }>;

		expect(result).toEqual([
			expect.objectContaining({ blockId: "paragraph-1" }),
		]);
	});

	it("retrieves ranked spans with nested-block and heading metadata", async () => {
		const editor = createNestedDocumentEditor();

		const result = (await retrieveDocumentSpansTool(editor).handler(
			{
				query: "stable block identity architecture",
				activeBlockId: "paragraph-1",
				targetBlockId: "paragraph-1",
			},
			{} as never,
		)) as {
			spans: Array<{
				id: string;
				blockIds: string[];
				headingPath: string[];
				score: number;
			}>;
		};

		expect(result.spans[0]).toMatchObject({
			id: "span:paragraph-1",
			blockIds: ["heading-1", "layout-1", "paragraph-1"],
			range: {
				startBlockId: "heading-1",
				endBlockId: "paragraph-1",
			},
			headingPath: ["Architecture"],
		});
		expect(result.spans[0]?.score).toBeGreaterThan(0);
	});
});
