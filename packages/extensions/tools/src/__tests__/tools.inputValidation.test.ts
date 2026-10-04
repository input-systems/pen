import { describe, expect, it } from "vitest";
import { ToolRuntimeImpl } from "../toolServer";
import { searchDocumentTool } from "../tools/searchDocument";
import { retrieveDocumentSpansTool } from "../tools/retrieveDocumentSpans";
import { moveBlockTool } from "../tools/moveBlock";
import { writeDocumentTool } from "../tools/writeDocument";
import {
	createReadDocumentEditor,
	createStructuredTargetEditor,
} from "./tools.testHelpers";

describe("@input/pen-tools tools: input validation", () => {
	it("rejects invalid tool inputs at the tools runtime boundary", async () => {
		const runtime = new ToolRuntimeImpl();
		const searchEditor = createReadDocumentEditor();
		const mutationEditor = createStructuredTargetEditor("paragraph-1");
		runtime.registerTool(searchDocumentTool(searchEditor));
		runtime.registerTool(retrieveDocumentSpansTool(searchEditor));
		runtime.registerTool(moveBlockTool(mutationEditor));
		runtime.registerTool(writeDocumentTool(mutationEditor));

		await expect(
			runtime.executeTool(
				"search_document",
				{
					query: "",
					maxResults: 0,
				},
				{} as never,
			),
		).rejects.toThrow('Invalid input for tool "search_document"');
		await expect(
			runtime.executeTool(
				"retrieve_document_spans",
				{
					query: "",
					maxResults: 99,
				},
				{} as never,
			),
		).rejects.toThrow('Invalid input for tool "retrieve_document_spans"');
		await expect(
			runtime.executeTool(
				"move_block",
				{
					blockId: "paragraph-1",
					position: {
						after: "",
					},
				},
				{} as never,
			),
		).rejects.toThrow('Invalid input for tool "move_block"');
		await expect(
			runtime.executeTool(
				"write_document",
				{
					content: "Hello",
					position: {
						parent: "paragraph-1",
						index: -1,
					},
				},
				{} as never,
			),
		).rejects.toThrow('Invalid input for tool "write_document"');

		expect(mutationEditor.apply).not.toHaveBeenCalled();
	});
});
