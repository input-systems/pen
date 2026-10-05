import { describe, expect, it } from "vitest";
import * as html from "../html";
import * as markdown from "../markdown";
import * as json from "../json";
import * as xml from "../xml";
import * as root from "../index";

function assertNamed(
	barrel: Record<string, unknown>,
	symbol: string,
	barrelName: string,
): void {
	expect(
		symbol in barrel && barrel[symbol] !== undefined,
		`${symbol} missing from ${barrelName} barrel`,
	).toBe(true);
}

function assertExporter(value: unknown, name: string, symbol: string): void {
	expect(value, `${symbol} missing`).toEqual(
		expect.objectContaining({
			name,
			mimeType: expect.any(String),
			export: expect.any(Function),
		}),
	);
}

function assertImporter(value: unknown, name: string, symbol: string): void {
	expect(value, `${symbol} missing`).toEqual(
		expect.objectContaining({
			name,
			mimeType: expect.any(String),
			parse: expect.any(Function),
			import: expect.any(Function),
		}),
	);
}

describe("SF2 format barrels", () => {
	it("html barrel exports the html satellite public surface", () => {
		assertNamed(html, "htmlExporter", "./html");
		assertNamed(html, "htmlImporter", "./html");
		assertNamed(html, "parseHtmlToBlocks", "./html");
		assertNamed(html, "parseHtmlWithReport", "./html");
		assertNamed(html, "sanitizeHTML", "./html");
		assertNamed(html, "ALLOWED_DATA_PEN_ATTRS", "./html");
		assertNamed(html, "admitProviderImageUrl", "./html");
		assertNamed(html, "applyHtmlImageSrcPolicy", "./html");
		assertNamed(html, "DEFAULT_HTML_IMAGE_SRC_POLICY", "./html");
		assertNamed(html, "isIngestibleImageSrc", "./html");
		assertNamed(html, "INGEST_MAX_TEXT_SIZE", "./html");

		assertExporter(html.htmlExporter, "html", "htmlExporter");
		assertImporter(html.htmlImporter, "html", "htmlImporter");
		expect(html.htmlExporter.mimeType).toBe("text/html");
		expect(html.htmlExporter.fileExtension).toBe(".html");
		expect(typeof html.parseHtmlToBlocks).toBe("function");
		expect(typeof html.parseHtmlWithReport).toBe("function");
		expect(typeof html.sanitizeHTML).toBe("function");
		expect(Array.isArray(html.ALLOWED_DATA_PEN_ATTRS)).toBe(true);
	});

	it("markdown barrel exports the markdown satellite public surface", () => {
		assertNamed(markdown, "markdownExporter", "./markdown");
		assertNamed(markdown, "markdownImporter", "./markdown");
		assertNamed(markdown, "exportMarkdownForBlocks", "./markdown");
		assertNamed(markdown, "exportMarkdownRange", "./markdown");
		assertNamed(markdown, "parseMarkdownToBlocks", "./markdown");
		assertNamed(markdown, "parseMarkdownWithReport", "./markdown");
		assertNamed(markdown, "INGEST_MAX_TEXT_SIZE", "./markdown");

		assertExporter(
			markdown.markdownExporter,
			"markdown",
			"markdownExporter",
		);
		assertImporter(
			markdown.markdownImporter,
			"markdown",
			"markdownImporter",
		);
		expect(markdown.markdownExporter.mimeType).toBe("text/markdown");
		expect(markdown.markdownExporter.fileExtension).toBe(".md");
		expect(typeof markdown.exportMarkdownForBlocks).toBe("function");
		expect(typeof markdown.exportMarkdownRange).toBe("function");
		expect(typeof markdown.parseMarkdownToBlocks).toBe("function");
		expect(typeof markdown.parseMarkdownWithReport).toBe("function");
	});

	it("json barrel exports both json importers as jsonImporter and jsonDocumentImporter", () => {
		assertNamed(json, "jsonExporter", "./json");
		assertNamed(json, "jsonImporter", "./json");
		assertNamed(json, "jsonDocumentImporter", "./json");
		assertNamed(json, "parseJsonDocument", "./json");
		assertNamed(json, "parseJsonToBlocks", "./json");
		assertNamed(json, "parseJsonWithReport", "./json");
		assertNamed(json, "exportEditorToJson", "./json");
		assertNamed(json, "exportEditorToText", "./json");
		assertNamed(json, "exportPenDocumentToText", "./json");
		assertNamed(json, "exportPlainText", "./json");
		assertNamed(json, "textExporter", "./json");
		assertNamed(json, "PEN_DOCUMENT_JSON_VERSION", "./json");
		assertNamed(json, "isSupportedPenDocumentVersion", "./json");
		assertNamed(json, "INGEST_MAX_TEXT_SIZE", "./json");

		assertExporter(json.jsonExporter, "json", "jsonExporter");
		assertImporter(json.jsonImporter, "json", "jsonImporter");
		assertImporter(
			json.jsonDocumentImporter,
			"json",
			"jsonDocumentImporter",
		);
		expect(json.jsonImporter).not.toBe(json.jsonDocumentImporter);
		const ingestParse = json.jsonImporter.parse;
		const documentParse = json.jsonDocumentImporter.parse;
		if (typeof ingestParse !== "function") {
			throw new Error("jsonImporter.parse missing from ./json barrel");
		}
		if (typeof documentParse !== "function") {
			throw new Error(
				"jsonDocumentImporter.parse missing from ./json barrel",
			);
		}
		expect(ingestParse.length).toBe(2);
		expect(documentParse.length).toBe(1);
		expect(typeof json.parseJsonToBlocks).toBe("function");
		expect(typeof json.parseJsonWithReport).toBe("function");
		expect(typeof json.parseJsonDocument).toBe("function");
		expect(typeof json.isSupportedPenDocumentVersion).toBe("function");
		expect(json.jsonExporter.mimeType).toBe("application/json");
		expect(json.textExporter.name).toBe("text");
	});

	it("xml barrel exports the xml satellite public surface", () => {
		assertNamed(xml, "xmlExporter", "./xml");
		assertNamed(xml, "xmlImporter", "./xml");
		assertNamed(xml, "parseXmlDocument", "./xml");
		assertNamed(xml, "serializePenDocumentToXml", "./xml");

		assertExporter(xml.xmlExporter, "xml", "xmlExporter");
		assertImporter(xml.xmlImporter, "xml", "xmlImporter");
		expect(xml.xmlExporter.mimeType).toBe("application/xml");
		expect(xml.xmlExporter.fileExtension).toBe(".xml");
		expect(typeof xml.parseXmlDocument).toBe("function");
		expect(typeof xml.serializePenDocumentToXml).toBe("function");
	});

	it("root barrel re-exports unique format symbols including both json importers", () => {
		assertNamed(root, "htmlExporter", ".");
		assertNamed(root, "htmlImporter", ".");
		assertNamed(root, "markdownExporter", ".");
		assertNamed(root, "markdownImporter", ".");
		assertNamed(root, "jsonExporter", ".");
		assertNamed(root, "jsonImporter", ".");
		assertNamed(root, "jsonDocumentImporter", ".");
		assertNamed(root, "xmlExporter", ".");
		assertNamed(root, "xmlImporter", ".");

		expect(root.htmlExporter).toBe(html.htmlExporter);
		expect(root.htmlImporter).toBe(html.htmlImporter);
		expect(root.markdownExporter).toBe(markdown.markdownExporter);
		expect(root.markdownImporter).toBe(markdown.markdownImporter);
		expect(root.jsonExporter).toBe(json.jsonExporter);
		expect(root.jsonImporter).toBe(json.jsonImporter);
		expect(root.jsonDocumentImporter).toBe(json.jsonDocumentImporter);
		expect(root.xmlExporter).toBe(xml.xmlExporter);
		expect(root.xmlImporter).toBe(xml.xmlImporter);
		expect(root.jsonImporter).not.toBe(root.jsonDocumentImporter);
	});
});
