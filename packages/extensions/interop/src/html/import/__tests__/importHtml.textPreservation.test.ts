import { describe, it, expect } from "vitest";
import type { PendingBlock } from "@input/pen-core";
import type { BlockSchema, SchemaRegistry } from "@input/pen-types";
import { createDefaultSchema } from "@input/pen-schema";
import { sanitizeHTML } from "../sanitize";
import { parseHTML, type DOMNode } from "../domAdapter";
import { domToBlocks } from "../domToBlocks";
import { stubRegistry } from "./importHtml.testHelpers";

function convert(html: string, registry: SchemaRegistry = stubRegistry) {
	return domToBlocks(parseHTML(sanitizeHTML(html)), registry);
}

function outline(blocks: PendingBlock[]): string[] {
	return blocks.map(
		(block) =>
			`${block.type}:${String(block.props.indent ?? "-")}:${block.content ?? ""}`,
	);
}

describe("@input/pen-interop/html dom-to-blocks: list nesting", () => {
	it("IOP11 keeps the ordered start after a nested-only item", () => {
		const blocks = convert(
			'<ol start="5"><li><ul><li>Child</li></ul></li><li>Parent</li><li>Next</li></ol>',
		);
		expect(outline(blocks)).toEqual([
			"bulletListItem:1:Child",
			"numberedListItem:0:Parent",
			"numberedListItem:0:Next",
		]);
		expect(blocks[1].props.start).toBe(5);
		expect(blocks[2].props.start).toBeUndefined();
	});

	it("IOP11 keeps the ordered start after a directly nested list", () => {
		const blocks = convert(
			'<ol start="5"><ul><li>Child</li></ul><li>Parent</li></ol>',
		);
		expect(blocks[1].props.start).toBe(5);
	});

	it("keeps a list nested as a child of the list (Slack, Apple Notes, Google Docs)", () => {
		const blocks = convert(
			"<ul><li>Parent</li><ul><li>Child</li><ul><li>Grandchild</li></ul></ul><li>Next</li></ul>",
		);

		expect(outline(blocks)).toEqual([
			"bulletListItem:0:Parent",
			"bulletListItem:1:Child",
			"bulletListItem:2:Grandchild",
			"bulletListItem:0:Next",
		]);
	});

	it("keeps an ordered list nested as a child of a bullet list", () => {
		const blocks = convert(
			'<ul><li>Parent</li><ol start="3"><li>Child</li><li>Sibling</li></ol></ul>',
		);

		expect(outline(blocks)).toEqual([
			"bulletListItem:0:Parent",
			"numberedListItem:1:Child",
			"numberedListItem:1:Sibling",
		]);
		expect(blocks[1].props.start).toBe(3);
		expect(blocks[2].props.start).toBeUndefined();
	});

	it("does not emit an empty item for an <li> that only wraps a nested list", () => {
		const blocks = convert(
			'<ul><li>Parent</li><li style="list-style-type:none"><ul><li>Child</li></ul></li><li>Next</li></ul>',
		);

		expect(outline(blocks)).toEqual([
			"bulletListItem:0:Parent",
			"bulletListItem:1:Child",
			"bulletListItem:0:Next",
		]);
	});

	it("keeps an empty item that wraps nothing", () => {
		expect(outline(convert("<ul><li>a</li><li></li></ul>"))).toEqual([
			"bulletListItem:0:a",
			"bulletListItem:0:",
		]);
	});

	it("reads an item's block children as lines of the one item", () => {
		const blocks = convert(
			"<ul>\n <li>\n  <div>Parent</div>\n  <div>second line</div>\n  <ul><li><p>Child</p></li></ul>\n </li>\n</ul>",
		);

		expect(outline(blocks)).toEqual([
			"bulletListItem:0:Parent\nsecond line",
			"bulletListItem:1:Child",
		]);
	});

	it.each([
		["<p>a<br></p><p>b</p>", "a\nb"],
		["<p>a<br><br></p><p>b</p>", "a\n\nb"],
		["<p>a<br></p><p>b<br><br></p>", "a\nb\n"],
		["<p><br></p><p>b</p>", "\nb"],
		["<p>a<br>b<br></p><p>c</p>", "a\nb\nc"],
	])("EM8 normalizes each list child before joining: %s", (html, text) => {
		const [block] = convert(`<ul><li>${html}</li></ul>`);
		expect(block.type).toBe("bulletListItem");
		expect(block.content).toBe(text);
	});

	it("EM8 keeps mark offsets and inherited marks across normalized list lines", () => {
		const [block] = convert(
			'<ul><li style="font-weight:bold"><p><i>a<br></i></p><p><u>b<br><br></u></p></li></ul>',
		);
		expect(block.content).toBe("a\nb\n");
		expect(block.marks).toEqual([
			{ type: "bold", start: 0, end: 4 },
			{ type: "italic", start: 0, end: 1 },
			{ type: "underline", start: 2, end: 4 },
		]);
	});

	it("imports items copied without their list as bullets", () => {
		expect(outline(convert("<li>Loose item</li><li>Second</li>"))).toEqual([
			"bulletListItem:0:Loose item",
			"bulletListItem:0:Second",
		]);
	});

	it("keeps text placed between items", () => {
		const blocks = convert(
			"<ul>stray <b>text</b><li>a</li><p>para</p></ul>",
		);

		expect(outline(blocks)).toEqual([
			"bulletListItem:0:stray text",
			"bulletListItem:0:a",
			"paragraph:-:para",
		]);
		expect(blocks[0].marks).toEqual([{ type: "bold", start: 6, end: 10 }]);
	});
});

describe("@input/pen-interop/html dom-to-blocks: inline wrapper around blocks", () => {
	it("IOP10 inherits an outer mark across matching inner marks", () => {
		const [block] = convert("<b><div>all <b>bold</b></div></b>");
		expect(block.marks).toEqual([{ type: "bold", start: 0, end: 8 }]);
	});

	it("IOP10 respects explicit resets inside inherited formatting", () => {
		const [block] = convert(
			'<b><div>a<span style="font-weight:normal">b</span>c</div></b>',
		);
		expect(block.marks).toEqual([
			{ type: "bold", start: 0, end: 1 },
			{ type: "bold", start: 2, end: 3 },
		]);
	});

	it("IOP10 overrides inherited color only over the inner range", () => {
		const [block] = convert(
			'<span style="color:red"><div>a<span style="color:blue">b</span>c</div></span>',
		);
		expect(block.marks).toEqual([
			{ type: "textColor", props: { color: "red" }, start: 0, end: 1 },
			{ type: "textColor", props: { color: "blue" }, start: 1, end: 2 },
			{ type: "textColor", props: { color: "red" }, start: 2, end: 3 },
		]);
	});

	it("IOP10 inherits marks in list items and table cells, but not code blocks", () => {
		const blocks = convert(
			"<b><ul><li>Item</li></ul><table><tr><td>Cell</td></tr></table><pre>code</pre></b>",
		);
		expect(blocks[0].marks).toEqual([{ type: "bold", start: 0, end: 4 }]);
		expect(blocks[1].children?.[0].children?.[0].marks).toEqual([
			{ type: "bold", start: 0, end: 4 },
		]);
		expect(blocks[2].marks ?? []).toEqual([]);
	});

	it.each(["thead", "tbody", "tfoot"])(
		"IOP10 respects resets on table section %s",
		(section) => {
			const [table] = convert(
				`<b><table><${section} style="font-weight:normal;color:red"><tr><td>plain</td></tr></${section}></table></b>`,
			);
			expect(table.children?.[0].children?.[0].marks).toEqual([
				{
					type: "textColor",
					props: { color: "red" },
					start: 0,
					end: 5,
				},
			]);
		},
	);

	it("IOP10 reads a wrapper around a heading, list and table as a container", () => {
		const blocks = convert(
			'<b style="font-weight:normal"><h1>Title</h1><ul><li>Item</li></ul><table><tr><td>A</td></tr></table></b>',
		);

		expect(blocks.map((block) => block.type)).toEqual([
			"heading",
			"bulletListItem",
			"table",
		]);
		expect(blocks[0].marks).toEqual([]);
	});

	it("IOP10 applies the wrapper's marks to each line inside it", () => {
		const blocks = convert(
			'<a href="https://a.test"><div>title</div><div>desc</div></a>',
		);

		expect(outline(blocks)).toEqual([
			"paragraph:-:title",
			"paragraph:-:desc",
		]);
		for (const block of blocks) {
			expect(block.marks).toEqual([
				{
					type: "link",
					props: { href: "https://a.test", title: undefined },
					start: 0,
					end: block.content!.length,
				},
			]);
		}
	});

	it("keeps an image inside an inline wrapper in its line of text", () => {
		const blocks = convert(
			'<span>hi <img src="https://x.test/e.png" alt=":)"> there</span>',
		);

		expect(outline(blocks)).toEqual(["paragraph:-:hi  there"]);
	});
});

describe("@input/pen-interop/html dom-to-blocks: IOP11 text preservation", () => {
	it("IOP11 keeps unconsumed inline text around a schema's content source", () => {
		const [block] = convert(
			"<details>Before<summary>Title</summary>Lost <b>text</b><p>Kept text</p>After</details>",
			createDefaultSchema(),
		);
		expect(block.type).toBe("toggle");
		expect(block.content).toBe("Title");
		expect(block.children?.map((child) => child.content)).toEqual([
			"Before",
			"Lost text",
			"Kept text",
			"After",
		]);
		expect(block.children?.[1].marks).toEqual([
			{ type: "bold", start: 5, end: 9 },
		]);
	});

	it("IOP11 keeps text in a schema container without its content source", () => {
		const [block] = convert(
			"<details>Lost <b>text</b></details>",
			createDefaultSchema(),
		);
		expect(block.type).toBe("toggle");
		expect(block.children).toMatchObject([
			{
				type: "paragraph",
				content: "Lost text",
				marks: [{ type: "bold", start: 5, end: 9 }],
			},
		]);
	});

	it("keeps a table caption as a paragraph before the table", () => {
		const blocks = convert(
			"<table><caption>Totals</caption><tr><td>a</td><td>b</td></tr></table>",
		);

		expect(blocks.map((block) => block.type)).toEqual([
			"paragraph",
			"table",
		]);
		expect(blocks[0].content).toBe("Totals");
	});

	it("keeps <pre> text that sits outside its <code>", () => {
		const blocks = convert("<pre>outside<code>inside</code></pre>");

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "codeBlock",
			content: "outsideinside",
		});
	});

	// the sanitizer repairs most malformed markup, so the backstop is driven with a
	// tree it would not produce: a row's own text has no cell to land in
	const lossyTable: DOMNode = {
		type: "element",
		tagName: "table",
		children: [
			{
				type: "element",
				tagName: "tr",
				children: [
					{ type: "text", textContent: "lost" },
					{
						type: "element",
						tagName: "td",
						children: [{ type: "text", textContent: "a" }],
					},
				],
			},
		],
	};

	it("IOP11 imports the fragment as plain lines when a conversion would drop text", () => {
		const root: DOMNode = {
			type: "root",
			children: [
				...(parseHTML("<h1>Title</h1>").children ?? []),
				lossyTable,
				...(parseHTML("<ul><li>one</li><li>two</li></ul>").children ??
					[]),
			],
		};

		expect(outline(domToBlocks(root, stubRegistry))).toEqual([
			"paragraph:-:Title",
			"paragraph:-:lost a",
			"paragraph:-:one",
			"paragraph:-:two",
		]);
	});

	it("IOP11 does not measure a subtree a schema's fromHTML claimed", () => {
		const claimsTables = {
			type: "table",
			serialize: {
				fromHTML: (element: { tagName: string }) =>
					element.tagName === "table"
						? { type: "table", props: {}, content: "" }
						: null,
			},
		} as unknown as BlockSchema;
		const registry: SchemaRegistry = {
			...stubRegistry,
			resolve: () => claimsTables,
			allBlocks: () => [claimsTables],
		};
		const root: DOMNode = {
			type: "root",
			children: [
				...(parseHTML("<h1>Title</h1>").children ?? []),
				lossyTable,
			],
		};

		expect(domToBlocks(root, registry).map((block) => block.type)).toEqual([
			"heading",
			"table",
		]);
	});
});
