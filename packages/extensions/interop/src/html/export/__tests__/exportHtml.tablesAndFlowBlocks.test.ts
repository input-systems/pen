import { describe, it, expect } from "vitest";
import { createEditor } from "@input/pen-core";
import { htmlExporter } from "../exporter";
import { defaultSchema } from "@input/pen-schema";
import { noDefaultExtensionsPreset } from "./exportHtml.testHelpers";

function editorWithTable(
	insertOp: Parameters<ReturnType<typeof createEditor>["apply"]>[0][0],
	cellOps: Parameters<ReturnType<typeof createEditor>["apply"]>[0],
) {
	const editor = createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
	});
	editor.apply([insertOp]);
	if (cellOps.length > 0) {
		editor.apply(cellOps);
	}
	return editor;
}

function createFlowEditorFromSeededDocument(
	seed: (editor: ReturnType<typeof createEditor>) => void,
) {
	const seedEditor = createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
	});
	seed(seedEditor);

	const document = seedEditor.internals.crdtDoc;
	seedEditor.internals.adapter.setDocumentProfile?.(document, "flow");

	const editor = createEditor({
		schema: defaultSchema,
		document,
		preset: noDefaultExtensionsPreset,
	});
	seedEditor.destroy();
	return editor;
}

describe("@input/pen-interop/html: table cells and flow blocks", () => {
	it("supports resolved suggestion export inside table cells", () => {
		const editor = editorWithTable(
			{
				type: "insert-block",
				blockId: "t3",
				blockType: "table",
				props: { hasHeaderRow: false },
				position: "last",
			},
			[
				{
					type: "splice-text",
					blockId: "t3",
					cell: { row: 0, col: 0 },
					from: 0,
					to: 0,
					insert: "ab",
				},
				{
					type: "format-text",
					blockId: "t3",
					cell: { row: 0, col: 0 },
					from: 0,
					to: 1,
					marks: {
						suggestion: { id: "cell-insert", action: "insert" },
					},
				},
				{
					type: "format-text",
					blockId: "t3",
					cell: { row: 0, col: 0 },
					from: 1,
					to: 2,
					marks: {
						suggestion: { id: "cell-delete", action: "delete" },
					},
				},
			],
		);

		const rawHtml = htmlExporter.export(editor);
		expect(rawHtml).toContain(
			'<ins data-suggestion-id="cell-insert">a</ins>',
		);
		expect(rawHtml).toContain(
			'<del data-suggestion-id="cell-delete">b</del>',
		);

		const resolvedHtml = htmlExporter.export(editor, {
			includeSuggestions: false,
		});
		expect(resolvedHtml).toContain("<td>a</td>");
		expect(resolvedHtml).not.toContain("<ins");
		expect(resolvedHtml).not.toContain("<del");
		expect(resolvedHtml).not.toContain(">b<");

		editor.destroy();
	});

	it("preserves seeded structured and hidden blocks when exporting flow documents", () => {
		const editor = createFlowEditorFromSeededDocument((seedEditor) => {
			seedEditor.apply([
				{
					type: "insert-block",
					blockId: "t1",
					blockType: "table",
					props: { hasHeaderRow: true },
					position: "last",
				},
				{
					type: "splice-text",
					blockId: "t1",
					cell: { row: 0, col: 0 },
					from: 0,
					to: 0,
					insert: "Alice",
				},
				{
					type: "insert-block",
					blockId: "sub-1",
					blockType: "subdocument",
					props: { subdocumentGuid: "nested-guid" },
					position: "last",
				},
			]);
		});

		const html = htmlExporter.export(editor);

		expect(editor.documentProfile).toBe("flow");
		expect(html).toContain("<table>");
		expect(html).toContain(">Alice</th>");
		expect(html).toContain('data-pen-subdocument="');

		editor.destroy();
	});
});
