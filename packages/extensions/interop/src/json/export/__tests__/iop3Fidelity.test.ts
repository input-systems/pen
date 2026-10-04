import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultBlocks, defaultInlines } from "@input/pen-schema";
import type { DocumentOp } from "@input/pen-types";
import { jsonExporter } from "../exporter";
import {
	JSON_EXPORT_FIDELITY,
	renderJsonFidelityTable,
} from "../fidelityTable";
import type { ExportFidelityRow } from "../../../fidelityTable";
import { jsonImporter } from "../importer";
import type { PenDocumentJSON } from "../types";
import { defaultSchema } from "@input/pen-schema";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

// Package root is 4 levels up after the move (was 2: src/__tests__ → package
// root). Depth difference: +2 (json/export inserted). FIDELITY.md is the
// concatenated D8 document; this format's section must still equal
// renderJsonFidelityTable() exactly.
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
		case "callout":
		case "codeBlock":
		case "bulletListItem":
		case "checkListItem":
		case "toggle":
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
						caption: "Caption",
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
		case "table":
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
		default:
			throw new Error(`Unhandled sample block type: ${type}`);
	}
}

async function exportSample(row: ExportFidelityRow): Promise<PenDocumentJSON> {
	const editor = createBareEditor();
	editor.apply(sampleOps(row));
	const json = await jsonExporter.export(editor);
	editor.destroy();
	return json;
}

async function importAndReexport(
	exported: PenDocumentJSON,
): Promise<PenDocumentJSON> {
	const target = createBareEditor();
	await jsonImporter.import(exported, target);
	const reexported = await jsonExporter.export(target);
	target.destroy();
	return reexported;
}

function assertDocumentedLoss(
	row: ExportFidelityRow,
	exported: PenDocumentJSON,
	reexported: PenDocumentJSON,
): void {
	switch (row.type) {
		case "subdocument": {
			const original = exported.blocks[0];
			const imported = reexported.blocks[0];
			expect(imported?.type).toBe("subdocument");
			expect(imported?.props.title).toBe(original?.props.title);
			expect(imported?.props.subdocumentGuid).not.toBe(
				original?.props.subdocumentGuid,
			);
			return;
		}
		default:
			throw new Error(`Unhandled degraded fidelity type: ${row.type}`);
	}
}

function assertJsonFidelity(
	row: ExportFidelityRow,
	json: PenDocumentJSON,
): void {
	if (row.kind === "block") {
		expect(json.blocks.some((block) => block.type === row.type)).toBe(true);
		return;
	}

	if (row.kind === "mark") {
		const marks = json.blocks.flatMap(
			(block) => block.content?.marks ?? [],
		);
		expect(marks.some((mark) => mark.type === row.type)).toBe(true);
		return;
	}

	if (row.kind === "inline-node") {
		const segments = json.blocks.flatMap(
			(block) => block.content?.segments ?? [],
		);
		expect(
			segments.some(
				(segment) =>
					segment.type === "node" && segment.nodeType === row.type,
			),
		).toBe(true);
		return;
	}

	const exhaustive: never = row.kind;
	throw new Error(`Unhandled fidelity kind: ${exhaustive}`);
}

describe("IOP3 JSON export fidelity", () => {
	it("IOP3 catalog covers every default block and inline", () => {
		expect(
			new Set(
				JSON_EXPORT_FIDELITY.filter((row) => row.kind === "block").map(
					(row) => row.type,
				),
			),
		).toEqual(new Set(defaultBlocks.map((block) => block.type)));
		expect(
			new Set(
				JSON_EXPORT_FIDELITY.filter((row) => row.kind === "mark").map(
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
				JSON_EXPORT_FIDELITY.filter(
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
		expect(committedTable).toContain(renderJsonFidelityTable());
	});

	it.each(JSON_EXPORT_FIDELITY)(
		"IOP3 $kind $type is $fidelity",
		async (row) => {
			const exported = await exportSample(row);
			assertJsonFidelity(row, exported);
			const reexported = await importAndReexport(exported);
			if (row.fidelity === "full") {
				expect(reexported).toEqual(exported);
				return;
			}
			assertDocumentedLoss(row, exported, reexported);
		},
	);

	it("IOP3 JSON export then import is semantically equal on a small fixture", async () => {
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

		const exported = await jsonExporter.export(source);
		const reexported = await importAndReexport(exported);

		expect(reexported).toEqual(exported);

		source.destroy();
	});

	it("IOP3 DUR3 JSON export → import is lossless including unknown props", async () => {
		const source = createBareEditor();
		source.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: { futureNote: "keep" },
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
				marks: { italic: true },
			},
		]);

		const exported = await jsonExporter.export(source);
		expect(exported.blocks[0]?.props).toMatchObject({ futureNote: "keep" });

		const target = createBareEditor();
		await jsonImporter.import(exported, target);
		const reexported = await jsonExporter.export(target);

		expect(reexported).toEqual(exported);
		expect(target.getBlock("b1")?.props.futureNote).toBe("keep");

		source.destroy();
		target.destroy();
	});
});
