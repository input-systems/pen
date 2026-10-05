import type {
  PendingBlock,
} from "@input/pen-core";
import type {
  Editor,
  Importer,
} from "@input/pen-types";
import {
  applyHtmlImageSrcPolicy,
  DEFAULT_HTML_IMAGE_SRC_POLICY,
  type HtmlImportOptions,
} from "./imageSrcPolicy";
import { blocksToOps } from "@input/pen-core";
import {
  boundIngestedBlocks,
  capRawHtmlSource,
  emitIngestReport,
  INGEST_MAX_TEXT_SIZE,
  IngestDropCounts,
  normalizeIngestedBlocks,
  type IngestReport,
} from "./ingestBounds";
import { sanitizeHTML } from "./sanitize";
import { parseHTML } from "./domAdapter";
import { domToBlocks } from "./domToBlocks";

function parseHtmlSource(source: string, editor: Editor): PendingBlock[] {
  if (source.length > INGEST_MAX_TEXT_SIZE) {
    throw new Error(
      `HTML parse received ${source.length} code units; INGEST_MAX_TEXT_SIZE is ${INGEST_MAX_TEXT_SIZE}`,
    );
  }
  const sanitized = sanitizeHTML(source);
  const dom = parseHTML(sanitized);
  return domToBlocks(dom, editor.schema);
}

function parseCappedHtmlToBlocks(
  input: string,
  editor: Editor,
  drops: IngestDropCounts,
): PendingBlock[] {
  return parseHtmlSource(capRawHtmlSource(input, drops), editor);
}

export function parseHtmlWithReport(
  input: string,
  editor: Editor,
): {
  blocks: PendingBlock[];
  report: IngestReport;
} {
  const drops = new IngestDropCounts();
  return boundIngestedBlocks(
    parseCappedHtmlToBlocks(input, editor, drops),
    drops,
  );
}

function normalizeHtmlToBlocks(
  input: string,
  editor: Editor,
): {
  blocks: PendingBlock[];
  result: IngestReport;
} {
  const drops = new IngestDropCounts();
  return normalizeIngestedBlocks(
    parseCappedHtmlToBlocks(input, editor, drops),
    editor,
    drops,
    "import-html",
  );
}

export function parseHtmlToBlocks(
  input: string,
  editor: Editor,
): PendingBlock[] {
  return parseHtmlWithReport(input, editor).blocks;
}

export interface HtmlImporter extends Importer<string, PendingBlock[]> {
  import(
    input: string,
    editor: Editor,
    options?: HtmlImportOptions,
  ): Promise<IngestReport>;
}

export const htmlImporter: HtmlImporter = {
  name: "html",
  mimeType: "text/html",
  parse(input: string, editor: Editor): PendingBlock[] {
    const { blocks, report } = parseHtmlWithReport(input, editor);
    emitIngestReport(editor, report, "import-html");
    return blocks;
  },

  async import(
    input: string,
    editor: Editor,
    options?: HtmlImportOptions,
  ): Promise<IngestReport> {
    const { blocks, result } = normalizeHtmlToBlocks(input, editor);
    const imageSrc = options?.imageSrc ?? DEFAULT_HTML_IMAGE_SRC_POLICY;
    const resolvedBlocks = await applyHtmlImageSrcPolicy(
      blocks,
      editor,
      imageSrc,
      options?.onProgress,
    );
    if (resolvedBlocks.length === 0) return result;

    const ops = blocksToOps(resolvedBlocks, options);
    editor.apply(ops, {
      origin: "import",
      ...(options?.undoGroup === false ? {} : { undoGroup: true }),
    });
    return result;
  },
};
