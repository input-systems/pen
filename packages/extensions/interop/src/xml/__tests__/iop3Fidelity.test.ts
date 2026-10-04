import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultBlocks, defaultInlines } from "@input/pen-schema";
import type { DocumentOp } from "@input/pen-types";
import { xmlExporter } from "../exporter";
import {
	XML_EXPORT_FIDELITY,
	renderXmlFidelityTable,
} from "../fidelityTable";
import type { ExportFidelityRow } from "../../fidelityTable";
import { xmlImporter } from "../importer";
import { defaultSchema } from "@input/pen-schema";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

// Package root is 3 levels up after the move (was 2: src/__tests__ → package
// root). Depth difference: +1 (xml inserted). FIDELITY.md is the concatenated
// D8 document; this format's section must still equal renderXmlFidelityTable()
// exactly.
const committedTable = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "../../../FIDELITY.md"),
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
					props:
						row.type === "mention"
							? { id: "user-1", label: "Ada" }
							: { appType: "timer", config: { x: 1 } },
				},
			},
		];
	}

	if (row.type === "table") {
		return [
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "table",
				props: {},
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
	}

	if (row.type === "toggle") {
		return [
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "toggle",
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
	}

	return [
		{
			type: "insert-block",
			blockId: "b1",
			blockType: row.type,
			props:
				row.type === "heading"
					? { level: 1 }
					: row.type === "image"
						? { src: "x.png", alt: "Alt", caption: "Caption" }
						: row.type === "subdocument"
							? { subdocumentGuid: "nested-guid" }
							: {},
			position: "last",
		},
		...(row.type === "divider" ||
		row.type === "image" ||
		row.type === "subdocument"
			? []
			: [
					{
						type: "splice-text" as const,
						blockId: "b1",
						from: 0,
						to: 0,
						insert: "Hello",
					},
				]),
	];
}

function exportSample(row: ExportFidelityRow): string {
	const editor = createBareEditor();
	editor.apply(sampleOps(row));
	const xml = xmlExporter.export(editor);
	editor.destroy();
	if (typeof xml !== "string") {
		throw new Error("Expected synchronous XML export.");
	}
	return xml;
}

function assertXmlFidelity(row: ExportFidelityRow, xml: string): void {
	if (row.type === "toggle") {
		const parentStart = xml.indexOf('<block id="b1"');
		const childrenStart = xml.indexOf("<children>", parentStart);
		const childStart = xml.indexOf('<block id="child"', childrenStart);
		expect(xml).toContain('type="toggle"');
		expect(childrenStart).toBeGreaterThan(parentStart);
		expect(childStart).toBeGreaterThan(childrenStart);
		expect(xml).toContain("<content>Nested</content>");
		return;
	}

	if (row.kind === "block") {
		expect(xml).toContain(`type="${row.type}"`);
		return;
	}

	if (row.kind === "mark") {
		expect(xml).toContain(`type="${row.type}"`);
		expect(xml).toContain("<mark ");
		return;
	}

	expect(xml).toContain(`<node type="${row.type}"`);
}

describe("IOP3 XML export fidelity", () => {
	it("IOP3 catalog covers every default block and inline", () => {
		expect(
			new Set(
				XML_EXPORT_FIDELITY.filter((row) => row.kind === "block").map(
					(row) => row.type,
				),
			),
		).toEqual(new Set(defaultBlocks.map((block) => block.type)));
		expect(
			new Set(
				XML_EXPORT_FIDELITY.filter((row) => row.kind === "mark").map(
					(row) => row.type,
				),
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
				XML_EXPORT_FIDELITY.filter(
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
		expect(committedTable).toContain(renderXmlFidelityTable());
	});

	it.each(XML_EXPORT_FIDELITY)("IOP3 $kind $type is $fidelity", (row) => {
		assertXmlFidelity(row, exportSample(row));
	});

	it("IOP3 XML export then import is semantically equal on a small fixture", async () => {
		const source = createBareEditor();
		source.apply([
			{
				type: "insert-block",
				blockId: "h1",
				blockType: "heading",
				props: { level: 2 },
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "h1",
				from: 0,
				to: 0,
				insert: "Title",
			},
			{
				type: "insert-block",
				blockId: "p1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "p1",
				from: 0,
				to: 0,
				insert: `Hello & <world> "quotes"`,
			},
			{
				type: "format-text",
				blockId: "p1",
				from: 0,
				to: 24,
				marks: { bold: true },
			},
		]);

		const exported = await xmlExporter.export(source);
		const target = createBareEditor();
		await xmlImporter.import(exported, target);
		const reexported = await xmlExporter.export(target);

		expect(reexported).toEqual(exported);

		source.destroy();
		target.destroy();
	});
});
