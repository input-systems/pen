import type { Importer, ImportOptions, Editor } from "@input/pen-types";
import { blocksToOps, type PendingBlock } from "@input/pen-core";
import { parseMarkdownToBlocks as parseMarkdownContentToBlocks } from "@input/pen-ingest";
import {
	boundIngestedBlocks,
	capRawMarkdownSource,
	emitIngestReport,
	INGEST_MAX_TEXT_SIZE,
	IngestDropCounts,
	normalizeIngestedBlocks,
	type IngestReport,
} from "./ingestBounds";

function parseMarkdownSource(source: string, editor: Editor): PendingBlock[] {
	if (source.length > INGEST_MAX_TEXT_SIZE) {
		throw new Error(
			`markdown parse received ${source.length} code units; INGEST_MAX_TEXT_SIZE is ${INGEST_MAX_TEXT_SIZE}`,
		);
	}
	return parseMarkdownContentToBlocks(source, editor);
}

function parseCappedMarkdownToBlocks(
	input: string,
	editor: Editor,
	drops: IngestDropCounts,
): PendingBlock[] {
	return parseMarkdownSource(capRawMarkdownSource(input, drops), editor);
}

export function parseMarkdownWithReport(
	input: string,
	editor: Editor,
): {
	blocks: PendingBlock[];
	report: IngestReport;
} {
	const drops = new IngestDropCounts();
	return boundIngestedBlocks(
		parseCappedMarkdownToBlocks(input, editor, drops),
		drops,
	);
}

function normalizeMarkdownToBlocks(
	input: string,
	editor: Editor,
): {
	blocks: PendingBlock[];
	result: IngestReport;
} {
	const drops = new IngestDropCounts();
	return normalizeIngestedBlocks(
		parseCappedMarkdownToBlocks(input, editor, drops),
		editor,
		drops,
		"import-markdown",
	);
}

export function parseMarkdownToBlocks(
	input: string,
	editor: Editor,
): PendingBlock[] {
	return parseMarkdownWithReport(input, editor).blocks;
}

export const markdownImporter = {
	name: "markdown",
	mimeType: "text/markdown",
	parse(input: string, editor: Editor): PendingBlock[] {
		const { blocks, report } = parseMarkdownWithReport(input, editor);
		emitIngestReport(editor, report, "import-markdown");
		return blocks;
	},

	import(input: string, editor: Editor, options?: ImportOptions): IngestReport {
		const { blocks, result } = normalizeMarkdownToBlocks(input, editor);
		if (blocks.length === 0) return result;

		const ops = blocksToOps(blocks, options);

		editor.apply(ops, {
			origin: "import",
			...(options?.undoGroup === false ? {} : { undoGroup: true }),
		});
		return result;
	},
} satisfies Importer<string, PendingBlock[]>;
