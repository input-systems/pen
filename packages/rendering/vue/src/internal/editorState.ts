import type { Editor, TableCellHandle } from "@input/pen-types";
import { useExternalStore } from "./useExternalStore";

/**
 * Editor-level state for the Vue binding. Per-block state comes from the
 * field editor's block notifier (`./blockNotifier`), never from per-block
 * editor listeners (SCALE6).
 */

interface BlockTextDelta {
  insert: string;
  attributes?: Readonly<Record<string, unknown>>;
}

interface BlockTextSnapshot {
  exists: boolean;
  text: string;
  deltas: readonly BlockTextDelta[];
}

const EMPTY_BLOCK_TEXT_SNAPSHOT: BlockTextSnapshot = {
  exists: false,
  text: "",
  deltas: [],
};

export function useDocumentEmptyState(editor: Editor) {
  return useExternalStore(
    (callback) => editor.on("commit", () => callback()),
    () => editor.documentState.isEmpty,
  );
}

/** One block's text and deltas, read now. */
export function readBlockTextSnapshot(editor: Editor, blockId: string): BlockTextSnapshot {
  const block = editor.getBlock(blockId);
  if (!block) {
    return EMPTY_BLOCK_TEXT_SNAPSHOT;
  }

  return {
    exists: true,
    text: block.textContent(),
    deltas: block.textDeltas(),
  };
}

/** One table cell's text and deltas, read now. */
export function readCellTextSnapshot(
  editor: Editor,
  tableBlockId: string,
  row: number,
  col: number,
): BlockTextSnapshot {
  const block = editor.getBlock(tableBlockId);
  if (!block) {
    return EMPTY_BLOCK_TEXT_SNAPSHOT;
  }

  const cell: TableCellHandle | null = block.as("table")?.tableCell(row, col) ?? null;
  if (!cell) {
    return EMPTY_BLOCK_TEXT_SNAPSHOT;
  }

  return {
    exists: true,
    text: cell.textContent(),
    deltas: cell.textDeltas(),
  };
}
