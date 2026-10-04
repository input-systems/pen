import { defaultSchema } from "./fixtures/testSchema";
import type { Editor } from "@input/pen-types";
import { describe, expect, it, vi } from "vitest";
import { ToolContextImpl } from "../toolContext";
import { getContextTool } from "../tools/getContext";
import { getCursorContextTool } from "../tools/getCursorContext";
import { readDocumentTool } from "../tools/readDocument";
import { createFakeEditor, createMockBlockHandle } from "./tools.testHelpers";

function createReadDocumentEditor(): Editor {
	const blocks = [
		createMockBlockHandle({
			id: "block-1",
			type: "paragraph",
			props: {},
			children: [],
			textContent: (options?: { resolved?: boolean }) =>
				options?.resolved ? "First accepted" : "First accepted",
			textDeltas: () => [{ insert: "First accepted" }],
		}),
		createMockBlockHandle({
			id: "block-2",
			type: "paragraph",
			props: {},
			children: [],
			textContent: (options?: { resolved?: boolean }) =>
				options?.resolved ? "Second" : "Second draft",
			textDeltas: () => [
				{ insert: "Second" },
				{
					insert: " draft",
					attributes: { suggestion: { action: "delete" } },
				},
			],
		}),
		createMockBlockHandle({
			id: "block-3",
			type: "heading",
			props: {},
			children: [],
			textContent: (options?: { resolved?: boolean }) =>
				options?.resolved ? "Third" : "Third",
			textDeltas: () => [{ insert: "Third" }],
		}),
	] as const;
	for (const block of blocks) {
		delete (block as { prev?: unknown }).prev;
		delete (block as { next?: unknown }).next;
	}

	return {
		documentProfile: "structured",
		schema: defaultSchema,
		facet: () => null,
		blockCount: () => 3,
		blocks: () => blocks,
		getBlock: (blockId: string) =>
			blocks.find((block) => block.id === blockId) ?? null,
		internals: {
			doc: {
				blockOrder: {
					length: 3,
					get: (index: number) =>
						["block-1", "block-2", "block-3"][index],
				},
				blocks: { get: () => undefined },
			},
		},
		getSelection: () => ({
			type: "text",
			anchor: { blockId: "block-2", offset: 0 },
			focus: { blockId: "block-2", offset: 6 },
		}),
		getSelectedText: () => "Second",
	} as unknown as Editor;
}

describe("@input/pen-tools tools: read_document and context", () => {
	it("guards ToolContext block insertion with the same policy", () => {
		const editor = createFakeEditor("flow");
		const emit = vi.fn();
		const context = new ToolContextImpl(editor, "doc-1", emit);

		expect(() => context.insertBlock("subdocument", {}, "last")).toThrow(
			'Block type "subdocument" is not available in flow documents.',
		);

		expect(emit).not.toHaveBeenCalled();
		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("allows ToolContext streaming without an undo manager", () => {
		const streaming = {
			beginStreaming: vi.fn(),
			appendDelta: vi.fn(),
			endStreaming: vi.fn(),
		};
		const editor = {
			...createFakeEditor("structured"),
			facet: (facet: { name: string }) =>
				facet.name === "deltaStream.target" ? streaming : null,
			internals: {
				emit: vi.fn(),
			},
		} as unknown as Editor;
		const emit = vi.fn();
		const context = new ToolContextImpl(editor, "doc-1", emit);

		expect(() => {
			context.beginStreaming("zone-1", "block-1");
			context.appendDelta("Hello");
			context.endStreaming("complete");
		}).not.toThrow();

		expect(emit).toHaveBeenCalledWith({
			type: "gen-start",
			zoneId: "zone-1",
			blockId: "block-1",
		});
		expect(emit).toHaveBeenCalledWith({
			type: "gen-delta",
			zoneId: "zone-1",
			delta: "Hello",
		});
		expect(emit).toHaveBeenCalledWith({
			type: "gen-end",
			zoneId: "zone-1",
			status: "complete",
		});
		expect(streaming.beginStreaming).toHaveBeenCalledWith(
			"zone-1",
			"block-1",
		);
		expect(streaming.appendDelta).toHaveBeenCalledWith("Hello");
		expect(streaming.endStreaming).toHaveBeenCalledWith("complete");
	});

	it("defaults read_document to a compact summary", async () => {
		const editor = createReadDocumentEditor();

		const result = (await readDocumentTool(editor).handler(
			{},
			{} as never,
		)) as {
			blockCount: number;
			preview: Array<{ id: string; type: string; content: string }>;
		};

		expect(result.blockCount).toBe(3);
		expect(result.preview).toEqual([
			{ id: "block-1", type: "paragraph", content: "First accepted" },
			{ id: "block-2", type: "paragraph", content: "Second" },
			{ id: "block-3", type: "heading", content: "Third" },
		]);
	});

	it("limits read_document to the requested block range", async () => {
		const editor = createReadDocumentEditor();

		const result = (await readDocumentTool(editor).handler(
			{
				format: "markdown",
				range: {
					startBlockId: "block-2",
					endBlockId: "block-3",
				},
			},
			{} as never,
		)) as string;

		expect(result).toBe("Second\n\n# Third");
	});

	it("returns summary context with selection details", async () => {
		const editor = createReadDocumentEditor();

		const result = (await getContextTool(editor).handler(
			{
				format: "summary",
				includeSelection: true,
			},
			{} as never,
		)) as {
			blockCount: number;
			activeBlockId: string;
			selectedText: string;
			blocks: Array<{ id: string; preview: string }>;
		};

		expect(result.blockCount).toBe(3);
		expect(result.activeBlockId).toBe("block-2");
		expect(result.selectedText).toBe("Second");
		expect(result.blocks.map((block) => block.id)).toEqual([
			"block-1",
			"block-2",
			"block-3",
		]);
	});

	it("returns cursor context without reading the full document", async () => {
		const editor = createReadDocumentEditor();

		const result = (await getCursorContextTool(editor).handler(
			{},
			{} as never,
		)) as {
			activeBlockId: string | null;
			activeBlockType: string | null;
			selectedText: string | null;
			surroundingBlocks: Array<{ id: string }>;
			structuredTarget: {
				target: { kind: string };
				validOperations: string[];
			} | null;
		};

		expect(result.activeBlockId).toBe("block-2");
		expect(result.activeBlockType).toBe("paragraph");
		expect(result.selectedText).toBe("Second");
		expect(result.surroundingBlocks.map((block) => block.id)).toEqual([
			"block-1",
			"block-2",
			"block-3",
		]);
		expect(result.structuredTarget?.target.kind).toBe("block");
		expect(result.structuredTarget?.validOperations).toContain(
			"replace_text",
		);
	});
});
