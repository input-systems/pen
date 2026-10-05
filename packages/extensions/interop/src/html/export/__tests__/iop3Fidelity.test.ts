import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultBlocks, defaultInlines } from "@input/pen-schema";
import type { DocumentOp } from "@input/pen-types";
import { htmlExporter } from "../exporter";
import { defaultSchema } from "@input/pen-schema";
import {
	HTML_EXPORT_FIDELITY,
	renderHtmlFidelityTable,
} from "../fidelityTable";
import type { ExportFidelityRow } from "../../../fidelityTable";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

// Package root is 4 levels up after the move (was 2: src/__tests__ → package
// root). Depth difference: +2 (html/export inserted). FIDELITY.md is the
// concatenated D8 document; this format's section must still equal
// renderHtmlFidelityTable() exactly.
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
				insert: "Hello ",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 6,
				to: 6,
				insert: {
					nodeType: row.type,
					props: inlineNodeProps(row.type),
				},
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 7,
				to: 7,
				insert: " end",
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
						width: 100,
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
		default: {
			const exhaustive: never = type as never;
			throw new Error(`Unhandled sample block type: ${exhaustive}`);
		}
	}
}

function exportSample(row: ExportFidelityRow): string {
	const editor = createBareEditor();
	editor.apply(sampleOps(row));
	const html = htmlExporter.export(editor);
	editor.destroy();
	if (typeof html !== "string") {
		throw new Error("Expected synchronous HTML export.");
	}
	return html;
}

function assertHtmlFidelity(row: ExportFidelityRow, html: string): void {
	switch (row.type) {
		case "paragraph":
			expect(html).toContain("<p>");
			expect(html).toContain("Hello");
			return;
		case "heading":
			expect(html).toContain("<h1>");
			expect(html).toContain("Hello");
			return;
		case "bulletListItem":
			expect(html).toContain("<ul>");
			expect(html).toContain("<li>Hello</li>");
			return;
		case "numberedListItem":
			expect(html).toContain("<ol>");
			expect(html).toContain("Hello");
			expect(html).not.toContain('start="3"');
			return;
		case "checkListItem":
			expect(html).toContain('type="checkbox"');
			expect(html).toContain("Hello");
			return;
		case "codeBlock":
			expect(html).toContain("<pre>");
			expect(html).toContain("Hello");
			return;
		case "image":
			expect(html).toContain("<img");
			expect(html).toContain("x.png");
			expect(html).not.toContain("my-caption");
			return;
		case "table":
			expect(html).toContain("<table>");
			expect(html).toContain("<th>Hello</th>");
			return;
		case "divider":
			expect(html).toContain("<hr");
			return;
		case "callout":
			expect(html).toContain("callout");
			expect(html).toContain("Hello");
			expect(html).toContain("Nested");
			expect(html).not.toContain(
				`<div class="callout callout-info">HelloNested`,
			);
			return;
		case "toggle":
			expect(html).toContain("<details>");
			expect(html).toContain("Hello");
			expect(html).toContain("Nested");
			expect(html).not.toMatch(/<details[\s\S]*Nested[\s\S]*<\/details>/);
			return;
		case "blockquote":
			expect(html).toContain("<blockquote>");
			expect(html).toContain("Hello");
			return;
		case "subdocument":
			expect(html).toContain("data-pen-subdocument=");
			expect(html).not.toContain("Nested");
			return;
		case "bold":
			expect(html).toContain("<strong>Hello</strong>");
			return;
		case "italic":
			expect(html).toContain("<em>Hello</em>");
			return;
		case "underline":
			expect(html).toContain("<u>Hello</u>");
			return;
		case "strikethrough":
			expect(html).toContain("<s>Hello</s>");
			return;
		case "highlight":
			expect(html).toContain("<mark");
			expect(html).toContain("Hello");
			return;
		case "textColor":
			expect(html).toContain("color:");
			expect(html).toContain("Hello");
			return;
		case "backgroundColor":
			expect(html).toContain("background-color:");
			expect(html).toContain("Hello");
			return;
		case "link":
			expect(html).toContain("<a ");
			expect(html).toContain("Hello");
			return;
		case "code":
			expect(html).toContain("<code>Hello</code>");
			return;
		case "mention":
			expect(html).not.toContain('class="mention"');
			expect(html).not.toContain("data-id");
			expect(html).toContain("Hello");
			return;
		case "inlineApp":
			expect(html).not.toContain("inline-app");
			expect(html).toContain("Hello");
			return;
		default: {
			const exhaustive: never = row.type as never;
			throw new Error(`Unhandled fidelity type: ${exhaustive}`);
		}
	}
}

describe("IOP3 HTML export fidelity", () => {
	it("IOP3 catalog covers every default block and inline", () => {
		const blockTypes = new Set(
			HTML_EXPORT_FIDELITY.filter((row) => row.kind === "block").map(
				(row) => row.type,
			),
		);
		const markTypes = new Set(
			HTML_EXPORT_FIDELITY.filter((row) => row.kind === "mark").map(
				(row) => row.type,
			),
		);
		const nodeTypes = new Set(
			HTML_EXPORT_FIDELITY.filter(
				(row) => row.kind === "inline-node",
			).map((row) => row.type),
		);

		expect(blockTypes).toEqual(
			new Set(defaultBlocks.map((block) => block.type)),
		);
		expect(markTypes).toEqual(
			new Set(
				defaultInlines
					.filter((inline) => inline.kind === "mark")
					.map((inline) => inline.type),
			),
		);
		expect(nodeTypes).toEqual(
			new Set(
				defaultInlines
					.filter((inline) => inline.kind === "node")
					.map((inline) => inline.type),
			),
		);
	});

	it("IOP3 committed fidelity table matches the generated table", () => {
		expect(committedTable).toContain(renderHtmlFidelityTable());
	});

	it.each(HTML_EXPORT_FIDELITY)("IOP3 $kind $type is $fidelity", (row) => {
		assertHtmlFidelity(row, exportSample(row));
	});
});
