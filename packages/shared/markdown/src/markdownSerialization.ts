import type { BlockHandle, Editor, TableCellHandle } from "@input/pen-types";
import {
	buildTableChildren,
	getNumberedListItemValue,
	sortDeltaAttributes,
} from "@input/pen-core";
import { groupListItems } from "./listGrouper";

export interface MarkdownExportRange {
  startBlockId?: string | null;
  endBlockId?: string | null;
}

export type MarkdownExportViewMode = "resolved" | "raw";

export interface MarkdownExportConfig {
  viewMode?: MarkdownExportViewMode;
}

const DELETE_SUGGESTION_ACTION = "delete";

export function exportMarkdownRange(
  editor: Editor,
  range?: MarkdownExportRange | null,
  config?: MarkdownExportConfig,
): string {
  return exportMarkdownForBlocks(editor, resolveBlockRange(editor, range), config);
}

export function exportMarkdownForBlocks(
  editor: Editor,
  handles: Iterable<BlockHandle>,
  config?: MarkdownExportConfig,
): string {
  // Export is a document-preservation surface: serialize the actual document
  // graph, including nested and non-default-authoring blocks that already exist.
  const viewMode = config?.viewMode ?? "raw";
  const lines: string[] = [];
  for (const handle of handles) {
    lines.push(serializeBlockHandleToMarkdown(handle, editor, viewMode));
  }

  return groupListItems(lines).join("\n\n");
}

function resolveBlockRange(
  editor: Editor,
  range?: MarkdownExportRange | null,
): BlockHandle[] {
  const blocks = listAllBlockHandles(editor);
  const startBlockId = range?.startBlockId ?? null;
  const endBlockId = range?.endBlockId ?? null;
  if (!startBlockId && !endBlockId) {
    return blocks;
  }

  const startIndex = startBlockId
    ? blocks.findIndex((block) => block.id === startBlockId)
    : 0;
  const endIndex = endBlockId
    ? blocks.findIndex((block) => block.id === endBlockId)
    : blocks.length - 1;
  if (startIndex === -1 || endIndex === -1) {
    return blocks;
  }

  const rangeStart = Math.min(startIndex, endIndex);
  const rangeEnd = Math.max(startIndex, endIndex) + 1;
  return blocks.slice(rangeStart, rangeEnd);
}

function serializeBlockHandleToMarkdown(
  handle: BlockHandle,
  editor: Editor,
  viewMode: MarkdownExportViewMode,
): string {
  const schema = editor.schema.resolve(handle.type);
  if (!schema?.serialize?.toMarkdown) {
    return readResolvedText(handle, viewMode);
  }

  const props =
    handle.type === "numberedListItem"
      ? {
          ...handle.props,
          start: getNumberedListItemValue(handle) ?? 1,
        }
      : handle.props;

  if (handle.type === "table") {
    return renderTableMarkdown(handle, editor, viewMode);
  }

  const block = {
    id: handle.id,
    type: handle.type,
    props,
    content: serializeInlineContent(handle, editor, viewMode),
    children: buildTableChildren(handle),
  };

  return schema.serialize.toMarkdown(block);
}

function serializeInlineContent(
  handle: BlockHandle,
  editor: Editor,
  viewMode: MarkdownExportViewMode,
): string {
  const deltas = handle.textDeltas();
  if (!deltas || deltas.length === 0) {
    return readResolvedText(handle, viewMode);
  }

  return serializeMarkdownDeltas(deltas, editor, viewMode);
}

function renderTableMarkdown(
  handle: BlockHandle,
  editor: Editor,
  viewMode: MarkdownExportViewMode,
): string {
  const rows = readTableRows(handle, (cell) =>
    serializeTableCellMarkdown(cell, editor, viewMode),
  );
  if (rows.length === 0) {
    return "";
  }

  const hasHeaderRow = handle.props.hasHeaderRow !== false;
  if (!hasHeaderRow) {
    return renderHtmlTableFallback(rows);
  }

  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const lines: string[] = [];
  const headerRow = rows[0] ?? [];
  const headerCells = Array.from({ length: colCount }, (_, index) =>
    escapeMarkdownPipe(headerRow[index] ?? ""),
  );
  lines.push(`| ${headerCells.join(" | ")} |`);
  lines.push(`| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const rowCells = Array.from({ length: colCount }, (_, index) =>
      escapeMarkdownPipe(rows[rowIndex]?.[index] ?? ""),
    );
    lines.push(`| ${rowCells.join(" | ")} |`);
  }

  return lines.join("\n");
}

function readTableRows(
  handle: BlockHandle,
  serializeCell: (cell: TableCellHandle | null) => string,
): string[][] {
  const rows: string[][] = [];
  const table = handle.as("table");
  const rowCount = table?.tableRowCount() ?? 0;
  const colCount = table?.tableColumnCount() ?? 0;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row: string[] = [];
    for (let columnIndex = 0; columnIndex < colCount; columnIndex++) {
      row.push(serializeCell(table?.tableCell(rowIndex, columnIndex) ?? null));
    }
    rows.push(row);
  }

  return rows;
}

function serializeTableCellMarkdown(
  cell: TableCellHandle | null,
  editor: Editor,
  viewMode: MarkdownExportViewMode,
): string {
  if (!cell) {
    return "";
  }

  return serializeMarkdownDeltas(cell.textDeltas(), editor, viewMode);
}

/**
 * Delta text wrapped by each mark's `toMarkdown`, in schema mark order.
 * Resolved view drops suggested deletions.
 */
function serializeMarkdownDeltas(
  deltas: ReturnType<BlockHandle["textDeltas"]>,
  editor: Editor,
  viewMode: MarkdownExportViewMode,
): string {
  const stored = deltas
    .map((delta) => (typeof delta.insert === "string" ? delta.insert : ""))
    .join("");
  if (stored === "") {
    return "";
  }

  let result = "";

  for (const delta of deltas) {
    let text = typeof delta.insert === "string" ? delta.insert : "";
    if (!text) continue;
    const suggestion = delta.attributes?.suggestion as
      | { action?: string }
      | undefined;
    if (viewMode === "resolved" && suggestion?.action === DELETE_SUGGESTION_ACTION) {
      continue;
    }

    if (delta.attributes) {
      const ordered = sortDeltaAttributes(delta.attributes, editor.schema);
      for (const [mark, props] of Object.entries(ordered)) {
        const inlineSchema = editor.schema.resolveInline(mark);
        if (!inlineSchema?.serialize?.toMarkdown) continue;
        text = inlineSchema.serialize.toMarkdown(
          text,
          typeof props === "object" ? (props as Record<string, unknown>) : {},
        );
      }
    }

    result += text;
  }

  return result;
}

function renderHtmlTableFallback(rows: string[][]): string {
  const parts = ["<table><tbody>"];
  for (const row of rows) {
    parts.push("<tr>");
    for (const cell of row) {
      parts.push(`<td>${escapeHTML(cell)}</td>`);
    }
    parts.push("</tr>");
  }
  parts.push("</tbody></table>");
  return parts.join("");
}

function escapeMarkdownPipe(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function listAllBlockHandles(editor: Editor): BlockHandle[] {
  return Array.from(editor.documentState.allBlocks());
}

function readResolvedText(
  handle: BlockHandle,
  viewMode: MarkdownExportViewMode,
): string {
  return viewMode === "resolved"
    ? handle.textContent({ resolved: true })
    : handle.textContent();
}
