import { describe, expect, it, vi } from "vitest";
import { insertBlockTool } from "../tools/insertBlock";
import { listBlockTypesTool } from "../tools/listBlockTypes";
import { writeDocumentTool } from "../tools/writeDocument";
import { createFakeEditor } from "./tools.testHelpers";

describe("@input/pen-tools tools", () => {
	it("filters hidden and flow-disallowed block types from list_block_types", async () => {
		const structuredEditor = createFakeEditor("structured");
		const flowEditor = createFakeEditor("flow");

		const structuredTypes = (await listBlockTypesTool(
			structuredEditor,
		).handler({}, {} as never)) as Array<{ type: string }>;
		const flowTypes = (await listBlockTypesTool(flowEditor).handler(
			{},
			{} as never,
		)) as Array<{ type: string }>;

		expect(structuredTypes.map((entry) => entry.type)).toContain("table");
		expect(structuredTypes.map((entry) => entry.type)).not.toContain(
			"subdocument",
		);
		expect(flowTypes.map((entry) => entry.type)).toContain("table");
		expect(flowTypes.map((entry) => entry.type)).not.toContain(
			"subdocument",
		);
		expect(
			structuredTypes.find((entry) => entry.type === "table"),
		).toMatchObject({
			type: "table",
			content: "table",
			fieldEditor: "table",
			flowCapability: "flow-delegated",
			selectionRole: "delegated",
		});
	});

	it("rejects hidden block types in structured documents before applying", async () => {
		const editor = createFakeEditor("structured");

		await expect(
			insertBlockTool(editor).handler(
				{
					position: "last",
					blockType: "subdocument",
				},
				{} as never,
			),
		).rejects.toThrow(
			'Block type "subdocument" is not available in structured documents.',
		);

		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("rejects hidden block types in write_document", async () => {
		const editor = createFakeEditor("structured");

		await expect(
			writeDocumentTool(editor).handler(
				{
					blocks: [{ blockType: "subdocument", content: "Rows" }],
				},
				{} as never,
			),
		).rejects.toThrow(
			'Block type "subdocument" is not available in structured documents.',
		);

		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("validates all blocks before write_document mutates the document", async () => {
		const editor = createFakeEditor("structured");

		await expect(
			writeDocumentTool(editor).handler(
				{
					blocks: [
						{ blockType: "paragraph", content: "Allowed" },
						{ blockType: "subdocument", content: "Blocked" },
					],
				},
				{} as never,
			),
		).rejects.toThrow(
			'Block type "subdocument" is not available in structured documents.',
		);

		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("writes markdown content as structured blocks", async () => {
		const editor = createFakeEditor("structured");

		const result = (await writeDocumentTool(editor).handler(
			{
				format: "markdown",
				content: "# Heading\n\n- Item",
				position: "last",
			},
			{} as never,
		)) as {
			blockIds: string[];
		};
		const appliedOps = vi.mocked(editor.apply).mock.calls[0]?.[0] ?? [];

		expect(result.blockIds).toHaveLength(2);
		expect(
			appliedOps.filter((op) => op.type === "insert-block"),
		).toHaveLength(2);
		expect(appliedOps[0]).toMatchObject({
			type: "insert-block",
			blockType: "heading",
			position: "last",
		});
		expect(appliedOps[1]).toMatchObject({
			type: "splice-text",
			insert: "Heading",
		});
		expect(appliedOps[2]).toMatchObject({
			type: "insert-block",
			blockType: "bulletListItem",
		});
		expect(appliedOps[3]).toMatchObject({
			type: "splice-text",
			insert: "Item",
		});
	});
});
