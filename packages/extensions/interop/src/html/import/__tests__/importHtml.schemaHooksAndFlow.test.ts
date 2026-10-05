import { describe, it, expect } from "vitest";
import { createEditor } from "@input/pen-core";
import type { HTMLImportElement, SchemaRegistry } from "@input/pen-types";
import { createDefaultSchema } from "@input/pen-schema";
import { htmlExporter } from "../../export";
import { htmlImporter, parseHtmlToBlocks, parseHtmlWithReport } from "../importer";
import { sanitizeHTML } from "../sanitize";
import { parseHTML } from "../domAdapter";
import { domToBlocks } from "../domToBlocks";
import {
	convert,
	defaultRegistry,
	noDefaultExtensionsPreset,
	stubRegistry,
} from "./importHtml.testHelpers";

function tableEditor() {
	const editor = createEditor({
		schema: defaultRegistry,
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
	editor.apply([{
		type: "insert-block",
		blockId: "t1",
		blockType: "table",
		props: { hasHeaderRow: true },
		position: "last",
	}]);
	editor.apply([{
		type: "splice-text",
		blockId: "t1",
		cell: { row: 0, col: 0 },
		from: 0,
		to: 0,
		insert: "Name",
	}]);
	return editor;
}

describe("@input/pen-interop/html dom-to-blocks: schema hooks and flow documents", () => {
	it("server-side parsing produces identical blocks as browser-side for same input (AC 43)", () => {
		const inputs = [
			"<h1>Title</h1><p>Body</p>",
			"<ul><li>a</li><li>b</li></ul>",
			'<pre><code class="language-js">const x = 1;</code></pre>',
			"<hr />",
			'<img src="url" alt="text" />',
			"<p><strong>bold</strong> and <em>italic</em></p>",
		];

		for (const html of inputs) {
			const sanitized = sanitizeHTML(html);
			const dom = parseHTML(sanitized);
			const blocks = domToBlocks(dom, stubRegistry);

			expect(blocks.length).toBeGreaterThan(0);
			for (const block of blocks) {
				expect(block.type).toBeTruthy();
				expect(block.props).toBeDefined();
			}
		}
	});

	it("<details> → toggle block via schema fromHTML", () => {
		const blocks = convert(
			"<details><summary>Toggle title</summary></details>",
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "toggle",
			props: { open: false },
			content: "Toggle title",
		});
	});

	it("passes the public HTML import element to schema fromHTML hooks", () => {
		let receivedElement: HTMLImportElement | null = null;
		const registry: SchemaRegistry = {
			...stubRegistry,
			allBlocks: () => [{
				type: "custom",
				propSchema: {},
				content: "inline",
				serialize: {
					fromHTML(element: HTMLImportElement) {
						receivedElement = element;
						if (element.tagName !== "div") {
							return null;
						}
						return {
							type: "paragraph",
							props: {},
							content: element.getAttribute("title") ?? "",
						};
					},
				},
			}],
			resolve: (type) => (type === "custom" ? registry.allBlocks()[0] : null),
		};

		const blocks = convert('<div title="From hook"></div>', registry);

		expect(receivedElement).toMatchObject({
			type: "element",
			tagName: "div",
			attributes: { title: "From hook" },
		});
		if (!receivedElement) {
			throw new Error("Expected schema fromHTML hook to receive an element");
		}
		const hookElement = receivedElement as unknown as HTMLImportElement;
		expect(hookElement.getAttribute("title")).toBe("From hook");
		expect(hookElement.hasAttribute("title")).toBe(true);
		expect(blocks).toMatchObject([
			{
				type: "paragraph",
				content: "From hook",
			},
		]);
	});

	it("SEC3: parseHtmlWithReport keeps enumerated text-align and align for fromHTML", () => {
		const seen: Array<{ style: string | null; align: string | null }> = [];
		const base = createDefaultSchema();
		const paragraph = base.resolve("paragraph");
		if (!paragraph) {
			throw new Error("Expected default paragraph schema");
		}
		const alignedParagraph = {
			...paragraph,
			serialize: {
				...paragraph.serialize,
				fromHTML(element: HTMLImportElement) {
					if (element.tagName !== "p") {
						return null;
					}
					seen.push({
						style: element.getAttribute("style"),
						align: element.getAttribute("align"),
					});
					return {
						type: "paragraph",
						props: {
							style: element.getAttribute("style") ?? "",
							align: element.getAttribute("align") ?? "",
						},
					};
				},
			},
		};
		const registry: SchemaRegistry = {
			...base,
			allBlocks: () =>
				base
					.allBlocks()
					.map((block) => (block.type === "paragraph" ? alignedParagraph : block)),
			resolve: (type) =>
				type === "paragraph" ? alignedParagraph : base.resolve(type),
		};
		const editor = createEditor({
			schema: registry,
			preset: noDefaultExtensionsPreset,
		});

		const { blocks } = parseHtmlWithReport(
			'<p style="text-align:center;color:red;position:fixed">Centered</p><p align="right">Right</p>',
			editor,
		);

		expect(seen).toEqual([
			{ style: "text-align: center; color: red", align: null },
			{ style: null, align: "right" },
		]);
		expect(blocks).toMatchObject([
			{
				type: "paragraph",
				content: "Centered",
				props: { style: "text-align: center; color: red", align: "" },
			},
			{
				type: "paragraph",
				content: "Right",
				props: { style: "", align: "right" },
			},
		]);

		editor.destroy();
	});

	it("<details open> → toggle block with open=true", () => {
		const blocks = convert(
			'<details open><summary>Open toggle</summary></details>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "toggle",
			props: { open: true },
			content: "Open toggle",
		});
	});

	it("preserves inline formatting inside an HTML toggle summary", () => {
		const blocks = convert(
			"<details><summary><strong>Bold</strong> and <em>italic</em></summary></details>",
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "toggle",
			content: "Bold and italic",
		});
		expect(blocks[0].marks?.some((mark) => mark.type === "bold")).toBe(true);
		expect(blocks[0].marks?.some((mark) => mark.type === "italic")).toBe(true);
	});

	it("<div class='callout callout-warning'> → callout block", () => {
		const blocks = convert(
			'<div class="callout callout-warning">Be careful</div>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "callout",
			props: { severity: "warning" },
			content: "Be careful",
		});
	});

	it("<div class='callout callout-error'> → callout block", () => {
		const blocks = convert(
			'<div class="callout callout-error">Something failed</div>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "callout",
			props: { severity: "error" },
			content: "Something failed",
		});
	});

	it("<div class='callout callout-info'> → callout block", () => {
		const blocks = convert(
			'<div class="callout callout-info">FYI</div>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "callout",
			props: { severity: "info" },
			content: "FYI",
		});
	});

	it("<ol start='5'> preserves start value on first list item", () => {
		const blocks = convert('<ol start="5"><li>fifth</li><li>sixth</li></ol>');

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "numberedListItem",
			content: "fifth",
			props: { indent: 0, start: 5 },
		});
		expect(blocks[1]).toMatchObject({
			type: "numberedListItem",
			content: "sixth",
			props: { indent: 0 },
		});
	});

	it("<ol> without start attribute does not set start", () => {
		const blocks = convert("<ol><li>first</li></ol>");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].props.start).toBeUndefined();
	});

	it("keeps parseHtmlToBlocks parse-only in flow documents", () => {
		const source = tableEditor();
		const html = htmlExporter.export(source);
		const editor = createEditor({
			schema: defaultRegistry,
			documentProfile: "flow",
			preset: noDefaultExtensionsPreset,
		});

		const blocks = parseHtmlToBlocks(`${html}<h2>Allowed</h2>`, editor);

		expect(blocks.some((block) => block.type === "table")).toBe(true);
		expect(blocks.some((block) => block.type === "heading")).toBe(true);

		source.destroy();
		editor.destroy();
	});

  it("does not emit normalization diagnostics during parseHtmlToBlocks", () => {
    const source = tableEditor();
    const html = htmlExporter.export(source);
    const editor = createEditor({
      schema: defaultRegistry,
      documentProfile: "flow",
      preset: noDefaultExtensionsPreset,
    });
    const diagnostics: unknown[] = [];

    editor.on("diagnostic", (event) => {
      diagnostics.push(event);
    });

    parseHtmlToBlocks(`${html}<h2>Allowed</h2>`, editor);

    expect(diagnostics).toEqual([]);

    source.destroy();
    editor.destroy();
  });

	it("imports table blocks into flow documents", async () => {
		const source = tableEditor();
		const html = htmlExporter.export(source);
		const editor = createEditor({
			schema: defaultRegistry,
			documentProfile: "flow",
			preset: noDefaultExtensionsPreset,
		});

		await htmlImporter.import(`${html}<h2>Allowed</h2>`, editor);

		const blockOrder = editor.documentState.blockOrder;
		expect(
			blockOrder.some((blockId) => editor.getBlock(blockId)?.type === "heading"),
		).toBe(true);
		expect(
			blockOrder.some((blockId) => editor.getBlock(blockId)?.type === "table"),
		).toBe(true);

		source.destroy();
		editor.destroy();
	});

  it("returns a structured import result for HTML imports", async () => {
    const source = tableEditor();
    const html = htmlExporter.export(source);
    const editor = createEditor({
      schema: defaultRegistry,
      documentProfile: "flow",
      preset: noDefaultExtensionsPreset,
    });

    const result = await htmlImporter.import(`${html}<h2>Allowed</h2>`, editor);

    expect(result).toEqual({
      parsedTopLevelBlockCount: 2,
      importedTopLevelBlockCount: 2,
      droppedBlockCount: 0,
      droppedBlockTypes: [],
      normalized: false,
      droppedByReason: [],
    });

    source.destroy();
    editor.destroy();
  });
});
