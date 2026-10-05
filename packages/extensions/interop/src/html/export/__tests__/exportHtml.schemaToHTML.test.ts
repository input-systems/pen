import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { htmlExporter } from "../exporter";
import { defaultSchema } from "@input/pen-schema";
import type { BlockSchema } from "@input/pen-types";
import { noDefaultExtensionsPreset } from "./exportHtml.testHelpers";

function editorWithSchema(
	schema: typeof defaultSchema,
	ops: Parameters<ReturnType<typeof createEditor>["apply"]>[0],
) {
	const editor = createEditor({
		schema,
		preset: noDefaultExtensionsPreset,
	});
	editor.apply(ops);
	return editor;
}

describe("@input/pen-interop/html schema toHTML dispatch", () => {
	it("IOP3: image serialize.toHTML override is honored", () => {
		const existing = defaultSchema.resolve("image")!;
		const schema = defaultSchema.override("image", {
			serialize: {
				toHTML: () =>
					'<img src="https://example.com/custom.png" data-host="yes" />',
			},
		} as Partial<BlockSchema>);

		const editor = editorWithSchema(schema, [
			{
				type: "insert-block",
				blockId: "img-1",
				blockType: "image",
				props: { src: "https://example.com/photo.png", alt: "photo" },
				position: "last",
			},
		]);

		const html = htmlExporter.export(editor);
		expect(html).toContain('src="https://example.com/custom.png"');
		expect(html).toContain('data-host="yes"');
		expect(html).not.toContain("photo.png");
		expect(existing.serialize.toHTML).toBeDefined();
		editor.destroy();
	});

	it("IOP3: image without serialize.toHTML falls back to the built-in serializer", () => {
		const existing = defaultSchema.resolve("image")!;
		const schema = defaultSchema.override("image", {
			serialize: {
				...existing.serialize,
				toHTML: undefined,
			},
		} as Partial<BlockSchema>);

		const editor = editorWithSchema(schema, [
			{
				type: "insert-block",
				blockId: "img-1",
				blockType: "image",
				props: {
					src: "https://example.com/photo.png",
					alt: "photo",
					width: 80,
				},
				position: "last",
			},
		]);

		const html = htmlExporter.export(editor);
		expect(html).toContain(
			'<img src="https://example.com/photo.png" alt="photo" width="80" />',
		);
		editor.destroy();
	});

	it("SEC1: schema image toHTML still omits a hostile src", () => {
		const schema = defaultSchema.override("image", {
			serialize: {
				toHTML: () =>
					'<img src="javascript:alert(1)" data-host="yes" alt="hostile" />',
			},
		} as Partial<BlockSchema>);

		const editor = editorWithSchema(schema, [
			{
				type: "insert-block",
				blockId: "img-1",
				blockType: "image",
				props: { src: "javascript:alert(1)", alt: "hostile" },
				position: "last",
			},
		]);

		const html = htmlExporter.export(editor);
		expect(html).toContain('data-pen-blocked-url=""');
		expect(html).toContain('data-host="yes"');
		expect(html).toContain('alt="hostile"');
		expect(html).not.toContain("src=");
		expect(html).not.toContain("javascript:");
		editor.destroy();
	});

	it("IOP3: list-item toHTML attributes survive run re-wrap", () => {
		const schema = defaultSchema.override("bulletListItem", {
			serialize: {
				toHTML: (block) =>
					`<li data-align="center">${block.content ?? ""}</li>`,
			},
		} as Partial<BlockSchema>);

		const editor = editorWithSchema(schema, [
			{
				type: "insert-block",
				blockId: "l1",
				blockType: "bulletListItem",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "l1",
				from: 0,
				to: 0,
				insert: "First",
			},
			{
				type: "insert-block",
				blockId: "l2",
				blockType: "bulletListItem",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "l2",
				from: 0,
				to: 0,
				insert: "Second",
			},
		]);

		const html = htmlExporter.export(editor);
		expect(html).toContain("<ul>");
		expect(html).toContain('<li data-align="center">First</li>');
		expect(html).toContain('<li data-align="center">Second</li>');
		editor.destroy();
	});
});
