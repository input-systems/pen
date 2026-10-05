import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import {
	INGEST_MAX_IMAGE_COUNT,
	INGEST_MAX_NESTING_DEPTH,
	INGEST_MAX_NODE_COUNT,
	INGEST_MAX_TEXT_SIZE,
	boundPendingBlocks,
	capRawHtmlSource,
	IngestDropCounts,
} from "../ingestBounds";
import { htmlImporter, parseHtmlWithReport } from "../importer";
import {
	defaultRegistry,
	noDefaultExtensionsPreset,
} from "./importHtml.testHelpers";

function createBareEditor() {
	return createEditor({
		schema: defaultRegistry,
		preset: noDefaultExtensionsPreset,
	});
}

function nestedListHtml(depth: number): string {
	let html = "";
	for (let index = 0; index < depth; index++) {
		html += `<ul><li>item ${index}`;
	}
	for (let index = 0; index < depth; index++) {
		html += "</li></ul>";
	}
	return html;
}

describe("IOP5 HTML ingest bounds", () => {
	it("IOP5 truncates oversize node count at a block boundary", () => {
		const drops = new IngestDropCounts();
		const blocks = Array.from(
			{ length: INGEST_MAX_NODE_COUNT + 3 },
			() => ({
				type: "paragraph",
				props: {},
				content: "x",
			}),
		);

		const kept = boundPendingBlocks(blocks, drops);

		expect(kept).toHaveLength(INGEST_MAX_NODE_COUNT);
		expect(drops.toDroppedByReason()).toEqual([
			{
				reason: "count-exceeded",
				count: 3,
				bound: "INGEST_MAX_NODE_COUNT",
				limit: INGEST_MAX_NODE_COUNT,
				actual: INGEST_MAX_NODE_COUNT + 3,
				dropped: "3 blocks",
			},
		]);
	});

	it("IOP5 truncates oversize parsed HTML node count at a block boundary", () => {
		const editor = createBareEditor();
		const overflow = 3;
		const html = Array.from(
			{ length: INGEST_MAX_NODE_COUNT + overflow },
			(_, index) => `<p>${index}</p>`,
		).join("");

		const { blocks, report } = parseHtmlWithReport(html, editor);

		expect(blocks).toHaveLength(INGEST_MAX_NODE_COUNT);
		expect(report.droppedByReason).toEqual([
			{
				reason: "count-exceeded",
				count: overflow,
				bound: "INGEST_MAX_NODE_COUNT",
				limit: INGEST_MAX_NODE_COUNT,
				actual: INGEST_MAX_NODE_COUNT + overflow,
				dropped: "3 blocks",
			},
		]);

		editor.destroy();
	});

	it("IOP5 truncates oversize imported text at a block boundary", () => {
		const editor = createBareEditor();
		const overflow = "y".repeat(32);
		const html = `${"x".repeat(INGEST_MAX_TEXT_SIZE)}\n<p>${overflow}</p>`;

		const { blocks, report } = parseHtmlWithReport(html, editor);

		expect(
			blocks.every((block) => (block.content ?? "").includes("y")),
		).toBe(false);
		expect(report.droppedByReason).toEqual([
			{
				reason: "text-size-exceeded",
				count: `\n<p>${overflow}</p>`.length,
				bound: "INGEST_MAX_TEXT_SIZE",
				limit: INGEST_MAX_TEXT_SIZE,
				actual: html.length,
				dropped: `${`\n<p>${overflow}</p>`.length} code units`,
			},
		]);

		editor.destroy();
	});

	it("IOP5 truncates deep list nesting past depth 32", () => {
		const editor = createBareEditor();
		const { blocks, report } = parseHtmlWithReport(
			nestedListHtml(INGEST_MAX_NESTING_DEPTH + 2),
			editor,
		);

		const maxIndent = Math.max(
			0,
			...blocks.map((block) =>
				typeof block.props.indent === "number" ? block.props.indent : 0,
			),
		);
		expect(maxIndent).toBe(INGEST_MAX_NESTING_DEPTH - 1);
		expect(report.droppedByReason).toEqual([
			{
				reason: "depth-exceeded",
				count: 2,
				bound: "INGEST_MAX_NESTING_DEPTH",
				limit: INGEST_MAX_NESTING_DEPTH,
				actual: INGEST_MAX_NESTING_DEPTH + 2,
				dropped: "2 blocks",
			},
		]);

		editor.destroy();
	});

	it("IOP5 truncates many images and names the bound", async () => {
		const editor = createBareEditor();
		const html = Array.from(
			{ length: INGEST_MAX_IMAGE_COUNT + 4 },
			(_, index) =>
				`<img src="https://example.com/${index}.png" alt="alt ${index}" />`,
		).join("\n");

		const diagnostics: Array<{ code: string; droppedByReason?: unknown }> =
			[];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		const result = await htmlImporter.import(html, editor);

		const imageCount = [...editor.documentState.allBlocks()].filter(
			(block) => block.type === "image",
		).length;
		expect(imageCount).toBe(INGEST_MAX_IMAGE_COUNT);
		expect(result.droppedByReason).toEqual([
			{
				reason: "image-count-exceeded",
				count: 4,
				bound: "INGEST_MAX_IMAGE_COUNT",
				limit: INGEST_MAX_IMAGE_COUNT,
				actual: INGEST_MAX_IMAGE_COUNT + 4,
				dropped: "4 images",
			},
		]);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("import-truncated");
		expect(diagnostics[0]?.droppedByReason).toEqual(result.droppedByReason);

		editor.destroy();
	});
});

describe("IOP6 HTML ingest report", () => {
	it("IOP6 returns one dropped-by-reason report instead of a diagnostic stream", async () => {
		const editor = createBareEditor();
		const diagnostics: unknown[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		const html = Array.from(
			{ length: 8 },
			(_, index) =>
				`<img src="https://example.com/${index}.png" alt="alt ${index}" />`,
		).join("\n");
		const overImageHtml = `${html}\n${Array.from(
			{ length: INGEST_MAX_IMAGE_COUNT },
			(_, index) =>
				`<img src="https://example.com/extra-${index}.png" alt="extra ${index}" />`,
		).join("\n")}`;

		const result = await htmlImporter.import(overImageHtml, editor);

		expect(diagnostics).toHaveLength(1);
		expect(result.droppedByReason).toHaveLength(1);
		expect(result.droppedByReason[0]?.reason).toBe("image-count-exceeded");
		expect(result.droppedByReason[0]?.count).toBe(8);
		expect(result.droppedByReason[0]?.limit).toBe(INGEST_MAX_IMAGE_COUNT);
		expect(result.droppedByReason[0]?.actual).toBe(
			INGEST_MAX_IMAGE_COUNT + 8,
		);

		editor.destroy();
	});
});

describe("IOP5 HTML ingest pre-parse cap", () => {
	it("IOP5 parser never receives more than INGEST_MAX_TEXT_SIZE characters", () => {
		const editor = createBareEditor();
		const keep = "<p>keep</p>\n";
		const later = "<p>later</p>";
		const input = `${keep}${"x".repeat(INGEST_MAX_TEXT_SIZE * 2)}\n${later}`;

		const { blocks, report } = parseHtmlWithReport(input, editor);

		expect(input.length).toBeGreaterThan(INGEST_MAX_TEXT_SIZE);
		expect(report.droppedByReason[0]).toMatchObject({
			reason: "text-size-exceeded",
			bound: "INGEST_MAX_TEXT_SIZE",
			limit: INGEST_MAX_TEXT_SIZE,
			actual: input.length,
		});
		expect(blocks).toEqual([
			expect.objectContaining({ type: "paragraph", content: "keep" }),
		]);
		expect(
			blocks.some((block) => (block.content ?? "").includes("later")),
		).toBe(false);

		editor.destroy();
	});

	it("IOP5 a 2×-cap source is sliced before parse, so work matches the capped source, not the input", () => {
		const editor = createBareEditor();
		const keep = "<p>keep</p>\n";
		const later = "<p>later</p>";
		const input2x = `${keep}${"x".repeat(INGEST_MAX_TEXT_SIZE * 2)}\n${later}`;
		const input4x = `${keep}${"x".repeat(INGEST_MAX_TEXT_SIZE * 4)}\n${later}`;
		const preview = new IngestDropCounts();
		const capped = capRawHtmlSource(input2x, preview);

		expect(capped.length).toBeLessThanOrEqual(INGEST_MAX_TEXT_SIZE);
		expect(capped.includes("later")).toBe(false);
		expect(preview.toDroppedByReason()).toEqual([
			{
				reason: "text-size-exceeded",
				count: input2x.length - capped.length,
				bound: "INGEST_MAX_TEXT_SIZE",
				limit: INGEST_MAX_TEXT_SIZE,
				actual: input2x.length,
				dropped: `${input2x.length - capped.length} code units`,
			},
		]);

		const full2x = parseHtmlWithReport(input2x, editor);
		const fromCapped = parseHtmlWithReport(capped, editor);
		const full4x = parseHtmlWithReport(input4x, editor);

		expect(full2x.report.droppedByReason).toEqual(
			preview.toDroppedByReason(),
		);
		expect(full2x.blocks).toEqual(fromCapped.blocks);
		expect(full2x.blocks).toEqual(full4x.blocks);
		expect(full2x.blocks).toEqual([
			expect.objectContaining({ type: "paragraph", content: "keep" }),
		]);
		expect(
			full2x.blocks.some((block) =>
				(block.content ?? "").includes("later"),
			),
		).toBe(false);
		expect(full4x.report.droppedByReason[0]?.actual).toBeGreaterThan(
			full2x.report.droppedByReason[0]?.actual ?? 0,
		);

		editor.destroy();
	});

	it("IOP5/IOP6 htmlImporter.parse (paste entry) emits one report naming the bound, limit, and actual", async () => {
		const editor = createBareEditor();
		const diagnostics: Array<{
			code: string;
			droppedByReason?: unknown;
			message?: string;
		}> = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		const html = Array.from(
			{ length: INGEST_MAX_IMAGE_COUNT + 4 },
			(_, index) =>
				`<img src="https://example.com/${index}.png" alt="alt ${index}" />`,
		).join("\n");
		const parse = htmlImporter.parse;
		if (!parse) {
			throw new Error(
				"htmlImporter.parse is the paste entry point under test",
			);
		}
		const blocks = await parse(html, editor);

		expect(blocks.filter((block) => block.type === "image")).toHaveLength(
			INGEST_MAX_IMAGE_COUNT,
		);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("import-truncated");
		expect(diagnostics[0]?.message).toContain("actual 260");
		expect(diagnostics[0]?.message).toContain("limit 256");
		expect(diagnostics[0]?.droppedByReason).toEqual([
			{
				reason: "image-count-exceeded",
				count: 4,
				bound: "INGEST_MAX_IMAGE_COUNT",
				limit: INGEST_MAX_IMAGE_COUNT,
				actual: INGEST_MAX_IMAGE_COUNT + 4,
				dropped: "4 images",
			},
		]);

		editor.destroy();
	});
});
