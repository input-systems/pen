import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultBlocks, defaultInlines } from "@input/pen-schema";
import type { DocumentOp } from "@input/pen-types";
import { markdownExporter } from "../exporter";
import { defaultSchema } from "@input/pen-schema";
import {
	MARKDOWN_EXPORT_FIDELITY,
	renderMarkdownFidelityTable,
} from "../fidelityTable";
import type { ExportFidelityRow } from "../../../fidelityTable";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

// Package root is 4 levels up after the move (was 2: src/__tests__ → package
// root). Depth difference: +2 (markdown/export inserted). FIDELITY.md is the
// concatenated D8 document; this format's section must still equal
// renderMarkdownFidelityTable() exactly.
const committedTable = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "../../../../FIDELITY.md"),
	"utf8",
);

function createBareEditor() {
	const editor = createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
	});
	const existingBlockIds = [...editor.documentState.allBlocks()]
		.filter((handle) => handle.parent === null)
		.map((handle) => handle.id);
	if (existingBlockIds.length > 0) {
		editor.apply(
			existingBlockIds.reverse().map((blockId) => ({
				type: "delete-block" as const,
				blockId,
			})),
		);
	}
	return editor;
}

function markValue(type: string): unknown {
	switch (type) {
		case "highlight":
			return { color: "yellow" };
		case "textColor":
			return { color: "red" };
		case "backgroundColor":
			return { color: "blue" };
		case "link":
			return { href: "https://example.com", title: "Example" };
		default:
			return true;
	}
}

function inlineNodeProps(type: string): Record<string, unknown> {
	if (type === "mention") {
		return { id: "user-1", label: "Ada" };
	}
	return { appType: "timer", config: { x: 1 } };
}

function sampleOps(row: ExportFidelityRow): DocumentOp[] {
	if (row.kind === "mark") {
		return [
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "format-text",
				blockId: "b1",
				from: 0,
				to: 5,
				marks: { [row.type]: markValue(row.type) },
			},
		];
	}

	if (row.kind === "inline-node") {
		return [
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0,
				insert: "Hi ",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 3,
				to: 3,
				insert: {
					nodeType: row.type,
					props: inlineNodeProps(row.type),
				},
			},
		];
	}

	return blockSampleOps(row.type);
}

function blockSampleOps(type: string): DocumentOp[] {
	switch (type) {
		case "paragraph":
		case "blockquote":
		case "codeBlock":
		case "bulletListItem":
		case "checkListItem":
			return [
				{
					type: "insert-block",
					blockId: "b1",
					blockType: type,
					props: {},
					position: "last",
				},
				{
					type: "splice-text",
					blockId: "b1",
					from: 0,
					to: 0,
					insert: "Hello",
				},
			];
		case "heading":
			return [
				{
					type: "insert-block",
					blockId: "b1",
					blockType: "heading",
					props: { level: 1 },
					position: "last",
				},
				{
					type: "splice-text",
					blockId: "b1",
					from: 0,
					to: 0,
					insert: "Hello",
				},
			];
		case "numberedListItem":
			return [
				{
					type: "insert-block",
					blockId: "b1",
					blockType: "numberedListItem",
					props: { start: 3 },
					position: "last",
				},
				{
					type: "splice-text",
					blockId: "b1",
					from: 0,
					to: 0,
					insert: "Hello",
				},
			];
		case "image":
			return [
				{
					type: "insert-block",
					blockId: "b1",
					blockType: "image",
					props: {
						src: "x.png",
						alt: "Alt",
						caption: "my-caption",
					},
					position: "last",
				},
			];
		case "divider":
		case "subdocument":
			return [
				{
					type: "insert-block",
					blockId: "b1",
					blockType: type,
					props:
						type === "subdocument"
							? {
									subdocumentGuid: "nested-guid",
									title: "Nested",
								}
							: {},
					position: "last",
				},
			];
		case "callout":
		case "toggle":
			return [
				{
					type: "insert-block",
					blockId: "b1",
					blockType: type,
					props: type === "callout" ? { severity: "info" } : {},
					position: "last",
				},
				{
					type: "splice-text",
					blockId: "b1",
					from: 0,
					to: 0,
					insert: "Hello",
				},
				{
					type: "insert-block",
					blockId: "child",
					blockType: "paragraph",
					props: {},
					position: { parent: "b1", index: 0 },
				},
				{
					type: "splice-text",
					blockId: "child",
					from: 0,
					to: 0,
					insert: "Nested",
				},
			];
		case "table":
			return [
				{
					type: "insert-block",
					blockId: "b1",
					blockType: "table",
					props: { hasHeaderRow: true },
					position: "last",
				},
				{
					type: "splice-text",
					blockId: "b1",
					cell: { row: 0, col: 0 },
					from: 0,
					to: 0,
					insert: "Hello",
				},
			];
		default:
			throw new Error(`Unhandled sample block type: ${type}`);
	}
}

function exportSample(row: ExportFidelityRow): string {
	const editor = createBareEditor();
	editor.apply(sampleOps(row));
	const markdown = markdownExporter.export(editor);
	editor.destroy();
	if (typeof markdown !== "string") {
		throw new Error("Expected synchronous markdown export.");
	}
	return markdown;
}

function assertMarkdownFidelity(
	row: ExportFidelityRow,
	markdown: string,
): void {
	switch (row.type) {
		case "paragraph":
			expect(markdown).toContain("Hello");
			return;
		case "heading":
			expect(markdown).toContain("# Hello");
			return;
		case "bulletListItem":
			expect(markdown).toContain("- Hello");
			return;
		case "numberedListItem":
			expect(markdown).toContain("3. Hello");
			return;
		case "checkListItem":
			expect(markdown).toContain("- [ ] Hello");
			return;
		case "codeBlock":
			expect(markdown).toContain("```");
			expect(markdown).toContain("Hello");
			return;
		case "image":
			expect(markdown).toContain("![Alt](x.png)");
			expect(markdown).not.toContain("my-caption");
			return;
		case "table":
			expect(markdown).toContain("| Hello |");
			return;
		case "divider":
			expect(markdown).toContain("---");
			return;
		case "callout":
			expect(markdown).toContain("> **Note:** Hello");
			expect(markdown).toContain("Nested");
			expect(markdown).toMatch(/> \*\*Note:\*\* Hello\s+Nested/);
			return;
		case "toggle":
			expect(markdown).toContain("<details>");
			expect(markdown).toContain("Hello");
			expect(markdown).toContain("Nested");
			expect(markdown).not.toMatch(
				/<details>[\s\S]*Nested[\s\S]*<\/details>/,
			);
			return;
		case "blockquote":
			expect(markdown).toContain("> Hello");
			return;
		case "subdocument":
			expect(markdown).toContain("<!-- pen-subdocument:");
			expect(markdown).not.toContain("Nested");
			return;
		case "bold":
			expect(markdown).toContain("**Hello**");
			return;
		case "italic":
			expect(markdown).toContain("*Hello*");
			return;
		case "underline":
			expect(markdown).toContain("<u>Hello</u>");
			return;
		case "strikethrough":
			expect(markdown).toContain("~~Hello~~");
			return;
		case "highlight":
			expect(markdown).toContain("==Hello==");
			return;
		case "textColor":
		case "backgroundColor":
			expect(markdown).toContain("Hello");
			expect(markdown).not.toContain("color");
			expect(markdown).not.toContain("<span");
			return;
		case "link":
			expect(markdown).toContain("[Hello](https://example.com");
			return;
		case "code":
			expect(markdown).toContain("`Hello`");
			return;
		case "mention":
			expect(markdown).toContain("Hi");
			expect(markdown).not.toContain("@Ada");
			return;
		case "inlineApp":
			expect(markdown).toContain("Hi");
			expect(markdown).not.toContain("[app:timer]");
			return;
		default:
			throw new Error(`Unhandled fidelity type: ${row.type}`);
	}
}

describe("IOP3 markdown export fidelity", () => {
	it("IOP3 catalog covers every default block and inline", () => {
		expect(
			new Set(
				MARKDOWN_EXPORT_FIDELITY.filter(
					(row) => row.kind === "block",
				).map((row) => row.type),
			),
		).toEqual(new Set(defaultBlocks.map((block) => block.type)));
		expect(
			new Set(
				MARKDOWN_EXPORT_FIDELITY.filter(
					(row) => row.kind === "mark",
				).map((row) => row.type),
			),
		).toEqual(
			new Set(
				defaultInlines
					.filter((inline) => inline.kind === "mark")
					.map((inline) => inline.type),
			),
		);
		expect(
			new Set(
				MARKDOWN_EXPORT_FIDELITY.filter(
					(row) => row.kind === "inline-node",
				).map((row) => row.type),
			),
		).toEqual(
			new Set(
				defaultInlines
					.filter((inline) => inline.kind === "node")
					.map((inline) => inline.type),
			),
		);
	});

	it("IOP3 committed fidelity table matches the generated table", () => {
		expect(committedTable).toContain(renderMarkdownFidelityTable());
	});

	it.each(MARKDOWN_EXPORT_FIDELITY)(
		"IOP3 $kind $type is $fidelity",
		(row) => {
			assertMarkdownFidelity(row, exportSample(row));
		},
	);
});
