import { describe, it, expect } from "vitest";
import { blocksToOps } from "@input/pen-core";
import type { SchemaRegistry } from "@input/pen-types";
import { sanitizeHTML } from "../sanitize";
import { parseHTML } from "../domAdapter";
import { domToBlocks } from "../domToBlocks";

const stubRegistry: SchemaRegistry = {
	resolve: () => null,
	resolveInline: () => null,
	resolveApp: () => null,
	resolveLayout: () => null,
	allBlocks: () => [],
	allInlines: () => [],
	allApps: () => [],
	allBlockDisplays: () => [],
};

function convert(html: string, registry: SchemaRegistry = stubRegistry) {
	const sanitized = sanitizeHTML(html);
	const dom = parseHTML(sanitized);
	return domToBlocks(dom, registry);
}

describe("@input/pen-interop/html dom-to-blocks: element mapping", () => {
	it("heading + paragraph (AC 28)", () => {
		const blocks = convert("<h1>Title</h1><p>Body</p>");

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "heading",
			props: { level: 1 },
			content: "Title",
		});
		expect(blocks[1]).toMatchObject({
			type: "paragraph",
			content: "Body",
		});
	});

	it("IOP2 imports a placeholder break as one empty paragraph", () => {
		const blocks = convert(
			"<p>hello there</p><p><br></p><p>this is a test</p>",
		);

		expect(blocks).toMatchObject([
			{ type: "paragraph", content: "hello there" },
			{ type: "paragraph", content: "" },
			{ type: "paragraph", content: "this is a test" },
		]);
	});

	it("EM8 imports a container break wrapped in inline formatting as one empty paragraph", () => {
		const blocks = convert(
			"<div>hello there</div><div><b><br></b></div><div>this is a test</div>",
		);

		expect(blocks).toMatchObject([
			{ type: "paragraph", content: "hello there" },
			{ type: "paragraph", content: "" },
			{ type: "paragraph", content: "this is a test" },
		]);
	});

	it("IOP2 keeps marks on a block container's inline content", () => {
		const blocks = convert("<div>Hello <b>world</b> again</div>");

		expect(blocks).toMatchObject([
			{
				type: "paragraph",
				content: "Hello world again",
				marks: [{ type: "bold", start: 6, end: 11 }],
			},
		]);
	});

	it("EM8 drops the line-terminating break of a block container and clamps its mark", () => {
		const blocks = convert("<div><b>hello<br></b></div><div>there</div>");

		expect(blocks).toMatchObject([
			{
				type: "paragraph",
				content: "hello",
				marks: [{ type: "bold", start: 0, end: 5 }],
			},
			{ type: "paragraph", content: "there" },
		]);
	});

	it("IOP2 imports a Gmail draft's enters, blank lines and shift-enters", () => {
		const blocks = convert(
			'<div dir="ltr"><div>one enter</div><div>two enter</div><div><br></div>' +
				"<div>three enter</div><div><br></div><div><br></div><div><br></div>" +
				"<div>one shift enter<br>two shift enter<br><br>three shift enter<br><br><br>end</div></div>",
		);

		expect(blocks.map((block) => block.content)).toEqual([
			"one enter",
			"two enter",
			"",
			"three enter",
			"",
			"",
			"",
			"one shift enter\ntwo shift enter\n\nthree shift enter\n\n\nend",
		]);
	});

	it("IOP2 keeps blocks nested in an inline wrapper as separate blocks", () => {
		const blocks = convert(
			'<div><a href="https://a.test"><div>card one</div></a><a href="https://b.test"><div>card two</div></a></div>',
		);

		expect(blocks.map((block) => block.content)).toEqual([
			"card one",
			"card two",
		]);
	});

	it("IOP2 collapses source formatting whitespace in a block container", () => {
		const blocks = convert(
			"<div>\n  <span>Label</span>\n  <span>Value</span>\n</div>" +
				"<div>line one<br>\nline two </div>" +
				"<div><b> </b></div>",
		);

		expect(blocks.map((block) => block.content)).toEqual([
			"Label Value",
			"line one\nline two",
		]);
	});

	it("EM8 drops the line-terminating break of a paragraph like a container's", () => {
		const blocks = convert("<p>hello<br></p><p>there<br><br></p>");

		expect(blocks.map((block) => block.content)).toEqual([
			"hello",
			"there\n",
		]);
	});

	it("IOP2 keeps spaces that are not source formatting, such as code indentation", () => {
		const blocks = convert(
			"<div><span>    </span><span>return  1;</span></div>",
		);

		expect(blocks.map((block) => block.content)).toEqual([
			"    return  1;",
		]);
	});

	it("IOP2 does not turn a break between top-level blocks into a paragraph", () => {
		const blocks = convert(
			'<p>one</p><br><p>two</p><br class="Apple-interchange-newline">',
		);

		expect(blocks.map((block) => block.content)).toEqual(["one", "two"]);
	});

	it("IOP2 preserves a break between inline text", () => {
		const blocks = convert("<p>hello<br>there</p>");

		expect(blocks).toMatchObject([
			{ type: "paragraph", content: "hello\nthere" },
		]);
	});

	it("script tag is stripped (AC 29)", () => {
		const blocks = convert('<script>alert("xss")</script><p>safe</p>');

		const types = blocks.map((b) => b.type);
		expect(types).not.toContain("script");
		expect(blocks.some((b) => b.content === "safe")).toBe(true);
	});

	it("event handler stripped, text preserved (AC 30)", () => {
		const blocks = convert('<div onclick="alert(1)">text</div>');

		expect(blocks.length).toBeGreaterThanOrEqual(1);
		const hasText = blocks.some((b) => b.content?.includes("text"));
		expect(hasText).toBe(true);
	});

	it("bold mark from <strong> (AC 32)", () => {
		const blocks = convert("<p><strong>bold</strong></p>");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].content).toBe("bold");
		expect(blocks[0].marks?.some((m) => m.type === "bold")).toBe(true);
	});

	it("italic mark from <em> (AC 33)", () => {
		const blocks = convert("<p><em>italic</em></p>");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].content).toBe("italic");
		expect(blocks[0].marks?.some((m) => m.type === "italic")).toBe(true);
	});

	it("IOP2 preserves marks expressed as inline styles", () => {
		const blocks = convert(
			'<p><span style="font-weight: 700">Bold</span> <span style="font-style: italic">italic</span> <span style="text-decoration: underline line-through">both</span></p>',
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "paragraph",
			content: "Bold italic both",
		});
		expect(blocks[0].marks).toEqual(
			expect.arrayContaining([
				{ type: "bold", start: 0, end: 4 },
				{ type: "italic", start: 5, end: 11 },
				{ type: "underline", start: 12, end: 16 },
				{ type: "strikethrough", start: 12, end: 16 },
			]),
		);
	});

	it("IOP2 preserves marks expressed by pasted stylesheet classes", () => {
		const blocks = convert(
			'<style>span.s1 {text-decoration: underline}</style><p>normal, <span class="s1">underline</span></p>',
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "paragraph",
			content: "normal, underline",
		});
		expect(blocks[0].marks).toContainEqual({
			type: "underline",
			start: 8,
			end: 17,
		});
	});

	it("IOP2 preserves text alignment on default text blocks", () => {
		const blocks = convert(
			'<p style="text-align: center">Centered</p><h2 align="right">Right</h2><blockquote style="text-align: justify">Quoted</blockquote><ul style="text-align: end"><li>Listed</li></ul>',
		);

		expect(blocks).toMatchObject([
			{ type: "paragraph", props: { textAlignment: "center" } },
			{ type: "heading", props: { level: 2, textAlignment: "right" } },
			{ type: "blockquote", props: { textAlignment: "justify" } },
			{ type: "bulletListItem", props: { textAlignment: "end" } },
		]);
	});

	it("link mark with href (AC 34)", () => {
		const blocks = convert('<p><a href="https://example.com">text</a></p>');

		expect(blocks).toHaveLength(1);
		expect(blocks[0].content).toBe("text");
		const linkMark = blocks[0].marks?.find((m) => m.type === "link");
		expect(linkMark).toBeDefined();
		expect(linkMark!.props!.href).toBe("https://example.com");
	});

	it("bullet list items (AC 35)", () => {
		const blocks = convert("<ul><li>a</li><li>b</li></ul>");

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "bulletListItem",
			content: "a",
		});
		expect(blocks[1]).toMatchObject({
			type: "bulletListItem",
			content: "b",
		});
	});

	it("numbered list items (AC 36)", () => {
		const blocks = convert("<ol><li>a</li><li>b</li></ol>");

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "numberedListItem",
			content: "a",
		});
		expect(blocks[1]).toMatchObject({
			type: "numberedListItem",
			content: "b",
		});
	});

	it("nested list with indent (AC 37)", () => {
		const blocks = convert("<ul><li>a<ul><li>b</li></ul></li></ul>");

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "bulletListItem",
			content: "a",
			props: { indent: 0 },
		});
		expect(blocks[1]).toMatchObject({
			type: "bulletListItem",
			content: "b",
			props: { indent: 1 },
		});
	});

	it("code block with language (AC 38)", () => {
		const blocks = convert(
			'<pre><code class="language-js">const x = 1;</code></pre>',
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "codeBlock",
			props: { language: "js" },
			content: "const x = 1;",
		});
	});

	it("hr → divider (AC 39)", () => {
		const blocks = convert("<hr />");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("divider");
	});

	it("image with props (AC 40)", () => {
		const blocks = convert('<img src="url" alt="text" title="cap" />');

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "image",
			props: { src: "url", alt: "text", caption: "cap" },
		});
	});

	it("heading levels 1-6", () => {
		const blocks = convert(
			"<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>",
		);

		expect(blocks).toHaveLength(6);
		for (let i = 0; i < 6; i++) {
			expect(blocks[i].type).toBe("heading");
			expect(blocks[i].props.level).toBe(i + 1);
		}
	});

	it("div content is unwrapped (block container)", () => {
		const blocks = convert("<div><p>inner</p></div>");

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "paragraph",
			content: "inner",
		});
	});

	it("table with header (AC 40 extension)", () => {
		const blocks = convert(
			"<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("table");
		expect(blocks[0].props.hasHeaderRow).toBe(true);
		expect(blocks[0].children).toHaveLength(2);
	});

	it("blocksToOps generates correct ops (AC 41)", () => {
		const blocks = convert("<h1>Title</h1><p><strong>bold</strong></p>");
		const ops = blocksToOps(blocks);

		const insertBlocks = ops.filter((o) => o.type === "insert-block");
		expect(insertBlocks).toHaveLength(2);

		const formatTexts = ops.filter((o) => o.type === "format-text");
		expect(formatTexts.length).toBeGreaterThan(0);
		expect(formatTexts[0].marks).toHaveProperty("bold");
	});

	it("inline-only at block level wraps in paragraph", () => {
		const dom = parseHTML("<strong>bold at root</strong>");
		const blocks = domToBlocks(dom, stubRegistry);

		expect(
			blocks.some(
				(b) =>
					b.type === "paragraph" &&
					b.content?.includes("bold at root"),
			),
		).toBe(true);
	});
});
