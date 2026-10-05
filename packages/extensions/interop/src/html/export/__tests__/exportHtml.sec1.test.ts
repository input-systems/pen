import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { htmlExporter } from "../exporter";
import { defaultSchema } from "@input/pen-schema";
import {
	editorWithBlocks,
	noDefaultExtensionsPreset,
} from "./exportHtml.testHelpers";

describe("@input/pen-interop/html SEC1 urlPolicy", () => {
	it("SEC1: javascript: link href omitted with data-pen-blocked-url", () => {
		const editor = editorWithBlocks([
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
				insert: "click",
			},
			{
				type: "format-text",
				blockId: "b1",
				from: 0,
				to: 0 + 5,
				marks: { link: { href: "javascript:alert(1)" } },
			},
		]);

		const html = htmlExporter.export(editor);
		expect(html).toContain('<a data-pen-blocked-url="">click</a>');
		expect(html).not.toContain("href=");
		expect(html).not.toContain("javascript:");
		editor.destroy();
	});

	it("SEC1: vbscript: and mixed-case javascript: href omitted", () => {
		const editor = editorWithBlocks([
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
				insert: "ab",
			},
			{
				type: "format-text",
				blockId: "b1",
				from: 0,
				to: 0 + 1,
				marks: { link: { href: "vbscript:msgbox(1)" } },
			},
			{
				type: "format-text",
				blockId: "b1",
				from: 1,
				to: 1 + 1,
				marks: { link: { href: "JAVASCRIPT:alert(1)" } },
			},
		]);

		const html = htmlExporter.export(editor);
		expect(html).toContain('data-pen-blocked-url=""');
		expect(html).not.toContain("href=");
		expect(html).not.toContain("vbscript:");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("JAVASCRIPT:");
		editor.destroy();
	});

	it("SEC1: allowed https and mailto href still land", () => {
		const editor = editorWithBlocks([
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
				insert: "docs mail",
			},
			{
				type: "format-text",
				blockId: "b1",
				from: 0,
				to: 0 + 4,
				marks: { link: { href: "https://example.com/docs" } },
			},
			{
				type: "format-text",
				blockId: "b1",
				from: 5,
				to: 5 + 4,
				marks: { link: { href: "mailto:hi@example.com" } },
			},
		]);

		const html = htmlExporter.export(editor);
		expect(html).toContain('<a href="https://example.com/docs">docs</a>');
		expect(html).toContain('<a href="mailto:hi@example.com">mail</a>');
		expect(html).not.toContain("data-pen-blocked-url");
		editor.destroy();
	});

	it("SEC1: javascript: / data:text/html image src omitted with data-pen-blocked-url", () => {
		const editor = editorWithBlocks([
			{
				type: "insert-block",
				blockId: "img-js",
				blockType: "image",
				props: { src: "javascript:alert(1)", alt: "hostile js" },
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "img-html",
				blockType: "image",
				props: {
					src: "data:text/html,<script>alert(1)</script>",
					alt: "hostile html",
				},
				position: "last",
			},
		]);

		const html = htmlExporter.export(editor);
		expect(html).toContain(
			'<img data-pen-blocked-url="" alt="hostile js" />',
		);
		expect(html).toContain(
			'<img data-pen-blocked-url="" alt="hostile html" />',
		);
		expect(html).not.toContain("src=");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("data:text/html");
		editor.destroy();
	});

	it("SEC1: allowed https image src still lands", () => {
		const editor = editorWithBlocks([
			{
				type: "insert-block",
				blockId: "img-ok",
				blockType: "image",
				props: { src: "https://example.com/photo.png", alt: "photo" },
				position: "last",
			},
		]);

		const html = htmlExporter.export(editor);
		expect(html).toContain(
			'<img src="https://example.com/photo.png" alt="photo" />',
		);
		expect(html).not.toContain("data-pen-blocked-url");
		editor.destroy();
	});

	it("SEC1: javascript: href in a table cell is omitted", () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: { hasHeaderRow: false },
				position: "last",
			},
		]);
		editor.apply([
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "cell",
			},
			{
				type: "format-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 4,
				marks: { link: { href: "javascript:alert(1)" } },
			},
		]);

		const html = htmlExporter.export(editor);
		expect(html).toContain('<a data-pen-blocked-url="">cell</a>');
		expect(html).not.toContain("href=");
		expect(html).not.toContain("javascript:");
		editor.destroy();
	});
});
