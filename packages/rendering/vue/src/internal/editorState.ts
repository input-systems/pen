import {
  affectedBlockIdsFromSummary,
  getNumberedListItemValue,
  isBlockSelected as isBlockIdInSelection,
} from "@input/pen-core";
import { getExpandedBlockRole } from "@input/pen-dom/field-editor";
import type {
  FieldEditorStore,
  FieldEditorStoreSnapshot,
} from "@input/pen-dom/field-editor/store";
import { getDocumentPlaceholderTargetBlockId } from "@input/pen-dom/utils/editorEmptyState";
import { getChildBlockIds } from "@input/pen-dom/utils/parentIdTree";
import type {
  Decoration,
  Editor,
  ReadonlySelectionState,
  TableCellHandle,
} from "@input/pen-types";
import { useExternalStore } from "./useExternalStore";

interface BlockTextDelta {
  insert: string;
  attributes?: Readonly<Record<string, unknown>>;
}

interface BlockTextSnapshot {
  exists: boolean;
  text: string;
  deltas: readonly BlockTextDelta[];
}

interface CellTextSnapshot {
  exists: boolean;
  text: string;
  deltas: readonly BlockTextDelta[];
}

interface BlockModelSnapshot {
  exists: boolean;
  id: string;
  type: string | null;
  props: Readonly<Record<string, unknown>> | null;
  revision: number;
}

const EMPTY_BLOCK_TEXT_SNAPSHOT: BlockTextSnapshot = {
  exists: false,
  text: "",
  deltas: [],
};

const EMPTY_FIELD_EDITOR_STATE: FieldEditorStoreSnapshot = {
  focusBlockId: null,
  activeBlockIds: [],
  isEditing: false,
  isFocused: false,
  isComposing: false,
  inputMode: "none",
  mode: "inactive",
  activeCellCoord: null,
  domSyncVersion: 0,
};

export function useDocumentEmptyState(editor: Editor) {
  return useExternalStore(
    (callback) => editor.on("commit", () => callback()),
    () => editor.documentState.isEmpty,
  );
}

export function useDocumentPlaceholderTarget(editor: Editor) {
  return useExternalStore(
    (callback) => editor.on("commit", () => callback()),
    () => getDocumentPlaceholderTargetBlockId(editor),
  );
}

export function useBlockTextSnapshot(editor: Editor, blockId: string) {
  return useExternalStore(
    (callback) =>
      editor.on("commit", (event) => {
        if (affectedBlockIdsFromSummary(event.summary).includes(blockId)) {
          callback();
        }
      }),
    () => getBlockTextSnapshot(editor, blockId),
    blockTextSnapshotEqual,
  );
}

export function useCellTextSnapshot(
  editor: Editor,
  tableBlockId: string,
  row: number,
  col: number,
) {
  return useExternalStore(
    (callback) =>
      editor.on("commit", (event) => {
        if (affectedBlockIdsFromSummary(event.summary).includes(tableBlockId)) {
          callback();
        }
      }),
    () => getCellTextSnapshot(editor, tableBlockId, row, col),
    blockTextSnapshotEqual,
  );
}

export function useBlockModel(editor: Editor, blockId: string) {
  return useExternalStore(
    (callback) =>
      editor.on("commit", (event) => {
        if (affectedBlockIdsFromSummary(event.summary).includes(blockId)) {
          callback();
        }
      }),
    () => {
      const block = editor.getBlock(blockId);
      if (!block) {
        return {
          exists: false,
          id: blockId,
          type: null,
          props: null,
          revision: 0,
        };
      }

      return {
        exists: true,
        id: block.id,
        type: block.type,
        props: block.props,
        revision: editor.getBlockRevision(blockId),
      };
    },
    blockModelEqual,
  );
}

export function useChildBlockIds(editor: Editor, parentBlockId: string) {
  return useExternalStore(
    (callback) => editor.on("commit", () => callback()),
    () => [...getChildBlockIds(editor, parentBlockId)],
    stringArrayEqual,
  );
}

export function useBlockDecorations(editor: Editor, blockId: string) {
  return useExternalStore(
    (callback) => editor.on("decorationsChange", callback),
    () => editor.getDecorations().forBlock(blockId),
    decorationArrayEqual,
  );
}

export function useFieldEditorState(fieldEditor: FieldEditorStore | null) {
  return useExternalStore(
    (callback) => (fieldEditor ? fieldEditor.subscribe(callback) : () => {}),
    () => fieldEditor?.getSnapshot() ?? EMPTY_FIELD_EDITOR_STATE,
    fieldEditorStateEqual,
  );
}

export function isBlockSelected(
  editor: Editor,
  selection: ReadonlySelectionState,
  blockId: string,
): boolean {
  return isBlockIdInSelection(
    editor.documentState.blockOrder,
    selection,
    blockId,
  );
}

export function resolveExpandedSurfaceRole(
  editor: Editor,
  fieldEditorState: FieldEditorStoreSnapshot,
  blockId: string,
): "editable-inline" | "structural" | "delegated" | null {
  if (fieldEditorState.mode !== "expanded") {
    return null;
  }
  if (!fieldEditorState.activeBlockIds.includes(blockId)) {
    return null;
  }
  return getExpandedBlockRole(editor, blockId);
}

export function resolveNumberedListValue(editor: Editor, blockId: string): number {
  return getNumberedListItemValue(editor.getBlock(blockId)) ?? 1;
}

function getBlockTextSnapshot(editor: Editor, blockId: string): BlockTextSnapshot {
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

function getCellTextSnapshot(
  editor: Editor,
  tableBlockId: string,
  row: number,
  col: number,
): CellTextSnapshot {
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

function blockTextSnapshotEqual(
  left: BlockTextSnapshot,
  right: BlockTextSnapshot,
): boolean {
  if (left.exists !== right.exists || left.text !== right.text) {
    return false;
  }
  if (left.deltas.length !== right.deltas.length) {
    return false;
  }

  for (let index = 0; index < left.deltas.length; index += 1) {
    const previous = left.deltas[index];
    const next = right.deltas[index];
    if (!next || previous.insert !== next.insert) {
      return false;
    }
    if (!shallowEqual(previous.attributes, next.attributes)) {
      return false;
    }
  }

  return true;
}

function blockModelEqual(
  left: BlockModelSnapshot,
  right: BlockModelSnapshot,
): boolean {
  return (
    left.exists === right.exists &&
    left.id === right.id &&
    left.type === right.type &&
    left.revision === right.revision &&
    shallowEqual(left.props, right.props)
  );
}

function stringArrayEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function decorationArrayEqual(
  left: readonly Decoration[],
  right: readonly Decoration[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function fieldEditorStateEqual(
  left: FieldEditorStoreSnapshot,
  right: FieldEditorStoreSnapshot,
): boolean {
  return (
    left.focusBlockId === right.focusBlockId &&
    left.activeBlockIds === right.activeBlockIds &&
    left.isEditing === right.isEditing &&
    left.isFocused === right.isFocused &&
    left.isComposing === right.isComposing &&
    left.inputMode === right.inputMode &&
    left.mode === right.mode &&
    left.activeCellCoord === right.activeCellCoord
  );
}

function shallowEqual(
  left: Readonly<Record<string, unknown>> | undefined | null,
  right: Readonly<Record<string, unknown>> | undefined | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

