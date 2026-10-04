import {
  createImportResult,
  inlineContentToOps,
  normalizePendingBlocksForImport,
  reportPendingBlockImportViolations,
  type PendingBlock,
} from "@input/pen-core";
import {
  generateId,
  type DocumentOp,
  type Editor,
  type Importer,
  type ImportOptions,
  type ImportResult,
  type Position,
} from "@input/pen-types";
import { isSupportedPenDocumentVersion } from "./schema";
import { INGEST_MAX_TEXT_SIZE } from "../import/ingestBounds";
import type {
  PenBlockJSON,
  PenDocumentJSON,
  PenInlineSegmentJSON,
} from "./types";

export const jsonImporter: Importer<string | PenDocumentJSON, PendingBlock[]> = {
  name: "json",
  mimeType: "application/json",

  parse(input: string | PenDocumentJSON): PendingBlock[] {
    const document = parseJsonDocument(input);
    return document.blocks.map(jsonBlockToPendingBlock);
  },

  import(
    input: string | PenDocumentJSON,
    editor: Editor,
    options?: ImportOptions,
  ): ImportResult {
    const document = parseJsonDocument(input);
    const parsedBlocks = document.blocks.map(jsonBlockToPendingBlock);
    const normalized = normalizePendingBlocksForImport(
      parsedBlocks,
      editor.documentProfile,
      editor.schema,
    );

    reportPendingBlockImportViolations(
      editor,
      normalized.violations,
      "import-json:parse",
    );

    const result = createImportResult(
      parsedBlocks.length,
      normalized.blocks.length,
      normalized.violations,
    );

    if (normalized.blocks.length === 0) {
      return result;
    }

    const importOps = canReuseJsonBlockIds(document.blocks, normalized.blocks)
      ? buildOpsWithIds(normalized.blocks, document.blocks, options)
      : buildOpsWithIds(normalized.blocks, undefined, options);
    const ops = options?.replace
      ? [...buildDeleteExistingBlockOps(editor), ...importOps]
      : importOps;

    editor.apply(ops, {
      origin: "import",
      ...(options?.undoGroup === false ? {} : { undoGroup: true }),
    });

    return result;
  },
};

export function parseJsonDocument(input: string | PenDocumentJSON): PenDocumentJSON {
  if (typeof input === "string" && input.length > INGEST_MAX_TEXT_SIZE) {
    throw new Error(
      `JSON parse received ${input.length} code units; INGEST_MAX_TEXT_SIZE is ${INGEST_MAX_TEXT_SIZE}`,
    );
  }
  const value = typeof input === "string" ? JSON.parse(input) : input;

  if (!isRecord(value)) {
    throw new Error("Invalid Pen JSON document.");
  }

  if (!isSupportedPenDocumentVersion(value.version)) {
    throw new Error("Unsupported Pen JSON document version.");
  }

  if (!Array.isArray(value.blocks)) {
    throw new Error("Invalid Pen JSON document: expected blocks array.");
  }

  return sanitizeIngestedJson(value) as PenDocumentJSON;
}

function jsonBlockToPendingBlock(block: PenBlockJSON): PendingBlock {
  return {
    type: block.type,
    props: block.props ?? {},
    ...(block.content ? { content: block.content.text } : {}),
    ...(block.content?.segments
      ? { segments: block.content.segments.map(jsonInlineSegmentToPendingSegment) }
      : {}),
    ...(block.content?.marks
      ? {
          marks: block.content.marks.map((mark) => ({
            type: mark.type,
            start: mark.start,
            end: mark.end,
            ...(mark.props ? { props: mark.props } : {}),
          })),
        }
      : {}),
    ...(block.children
      ? { children: block.children.map(jsonBlockToPendingBlock) }
      : {}),
  };
}

function jsonInlineSegmentToPendingSegment(segment: PenInlineSegmentJSON) {
  if (segment.type === "text") {
    return {
      type: "text" as const,
      text: segment.text,
      ...(segment.attributes ? { attributes: segment.attributes } : {}),
    };
  }

  return {
    type: "node" as const,
    nodeType: segment.nodeType,
    ...(segment.props ? { props: segment.props } : {}),
  };
}

function buildOpsWithIds(
  blocks: PendingBlock[],
  idBlocks?: PenBlockJSON[],
  options?: ImportOptions,
): DocumentOp[] {
  const ops: DocumentOp[] = [];
  let position: Position = options?.position ?? "last";

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.type.startsWith("__table")) {
      continue;
    }

    const idBlock = idBlocks?.[index];
    const blockId = idBlock?.id ?? generateId();

    ops.push({
      type: "insert-block",
      blockId,
      blockType: block.type,
      props: cleanProps(block.props),
      position,
    });

    if (block.type === "table" && block.children) {
      materializeTableChildren(ops, blockId, block.children);
    } else {
      ops.push(...inlineContentToOps(block, blockId));

      if (block.children) {
        const childIdBlocks = idBlock?.children;
        for (let childIndex = 0; childIndex < block.children.length; childIndex += 1) {
          const child = block.children[childIndex]!;
          const childOps = buildOpsWithIds([child], childIdBlocks?.[childIndex] ? [childIdBlocks[childIndex]!] : undefined, {
            position: { parent: blockId, index: childIndex },
          });
          ops.push(...childOps);
        }
      }
    }

    position = { after: blockId };
  }

  return ops;
}

function buildDeleteExistingBlockOps(editor: Editor): DocumentOp[] {
  return [...editor.documentState.allBlocks()]
    .filter((handle) => handle.parent === null)
    .reverse()
    .map((handle) => ({
      type: "delete-block",
      blockId: handle.id,
    }));
}

function materializeTableChildren(
  ops: DocumentOp[],
  blockId: string,
  rows: PendingBlock[],
): void {
  const tableRows = rows.filter((row) => row.type === "__table_row");
  const seedRows = 2;
  const seedCols = 2;
  const desiredRowCount = Math.max(tableRows.length, 1);
  const desiredColCount = Math.max(
    tableRows.reduce((max, row) => {
      const cellCount = (row.children ?? []).filter(
        (cell: PendingBlock) => cell.type === "__table_cell",
      ).length;
      return Math.max(max, cellCount);
    }, 0),
    1,
  );

  for (let rowIdx = seedRows - 1; rowIdx >= desiredRowCount; rowIdx -= 1) {
    ops.push({
      type: "grid",
      blockId,
      change: { kind: "delete-row", index: rowIdx },
    });
  }

  for (let colIdx = seedCols - 1; colIdx >= desiredColCount; colIdx -= 1) {
    ops.push({
      type: "grid",
      blockId,
      change: { kind: "delete-column", index: colIdx },
    });
  }

  for (let colIdx = seedCols; colIdx < desiredColCount; colIdx += 1) {
    ops.push({
      type: "grid",
      blockId,
      change: { kind: "insert-column", index: colIdx },
    });
  }

  for (let rowIdx = 0; rowIdx < tableRows.length; rowIdx += 1) {
    const row = tableRows[rowIdx]!;
    const cells = (row.children ?? []).filter(
      (cell: PendingBlock) => cell.type === "__table_cell",
    );

    if (rowIdx >= seedRows) {
      ops.push({
        type: "grid",
        blockId,
        change: { kind: "insert-row", index: rowIdx },
      });
    }

    for (let colIdx = 0; colIdx < cells.length; colIdx += 1) {
      const cell = cells[colIdx]!;

      materializeTableCellContent(ops, blockId, rowIdx, colIdx, cell);
    }
  }
}

function materializeTableCellContent(
  ops: DocumentOp[],
  blockId: string,
  row: number,
  col: number,
  cell: PendingBlock,
): void {
  if (!cell.content) {
    return;
  }

  ops.push({
    type: "splice-text",
    blockId,
    cell: { row, col },
    from: 0,
    to: 0,
    insert: cell.content,
  });

  for (const mark of cell.marks ?? []) {
    if (mark.start >= mark.end) {
      continue;
    }

    ops.push({
      type: "format-text",
      blockId,
      cell: { row, col },
      from: mark.start,
      to: mark.end,
      marks: { [mark.type]: mark.props ?? true },
    });
  }
}

function canReuseJsonBlockIds(
  originalBlocks: PenBlockJSON[],
  normalizedBlocks: PendingBlock[],
): boolean {
  if (originalBlocks.length !== normalizedBlocks.length) {
    return false;
  }

  for (let index = 0; index < originalBlocks.length; index += 1) {
    const original = originalBlocks[index]!;
    const normalized = normalizedBlocks[index]!;

    if (original.type !== normalized.type) {
      return false;
    }

    if ((original.children?.length ?? 0) !== (normalized.children?.length ?? 0)) {
      return false;
    }

    if (
      original.children &&
      normalized.children &&
      !canReuseJsonBlockIds(original.children, normalized.children)
    ) {
      return false;
    }
  }

  return true;
}

const REJECTED_OWN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeIngestedJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeIngestedJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  const clean = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (REJECTED_OWN_KEYS.has(key)) {
      continue;
    }
    clean[key] = sanitizeIngestedJson(value[key]);
  }
  return clean;
}

function cleanProps(props: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (REJECTED_OWN_KEYS.has(key) || value === undefined) {
      continue;
    }
    cleaned[key] = value;
  }

  return cleaned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
