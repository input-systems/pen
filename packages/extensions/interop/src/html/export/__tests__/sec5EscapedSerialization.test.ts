import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { escapeMarkupAttribute, escapeMarkupText } from "../../../escapeMarkup";
import { htmlExporter } from "../exporter";
import { defaultSchema } from "@input/pen-schema";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

const HOSTILE_PLAIN_TEXTS = [
	`<script>alert("xss")</script>`,
	`foo & bar < baz > 'qux' "quux"`,
	`"><img src=x onerror=alert(1)>`,
];

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

function decodeMarkupEntities(value: string): string {
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");
}

function extractParagraphInner(html: string): string {
	const match = /<p>([\s\S]*)<\/p>/.exec(html);
	if (!match?.[1]) {
		throw new Error(`Expected a paragraph in exported HTML: ${html}`);
	}
	return match[1];
}

describe("SEC5 escaped HTML serialization", () => {
	it("SEC5 escapes text and attribute values", () => {
		expect(escapeMarkupText(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
		expect(escapeMarkupAttribute(`&<>"'`)).toBe(
			"&amp;&lt;&gt;&quot;&apos;",
		);
	});

	it.each(HOSTILE_PLAIN_TEXTS)(
		"SEC5 round-trips hostile plain text %j through escaped HTML export",
		async (text) => {
			const source = createBareEditor();
			source.apply([
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
					insert: text,
				},
			]);

			const html = await htmlExporter.export(source);
			expect(html).not.toContain("<script>");
			if (text.includes("<")) {
				expect(html).toContain("&lt;");
			}
			if (text.includes("&")) {
				expect(html).toContain("&amp;");
			}
			if (text.includes("'")) {
				expect(html).toContain("&apos;");
			}
			if (text.includes('"')) {
				expect(html).toContain("&quot;");
			}

			expect(decodeMarkupEntities(extractParagraphInner(html))).toBe(
				text,
			);

			source.destroy();
		},
	);
});
