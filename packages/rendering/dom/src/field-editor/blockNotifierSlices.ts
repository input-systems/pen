import type { ListItemSemantics } from "@input/pen-core";
import type { Editor, OpOrigin, SelectionState } from "@input/pen-types";

import type {
	BlockCommitSlice,
	BlockFieldSlice,
	BlockListSlice,
	BlockSelectionSlice,
	SurfaceSnapshot,
} from "./blockNotifierTypes";
import { getExpandedBlockRole } from "./crossBlock";
import { arraysEqual } from "../utils/arraysEqual";
import type { FieldEditorStoreSnapshot } from "./store";

/**
 * Slice builders for the block notifier. Each takes the previous slice and
 * returns it unchanged when every field is equal, so a binding that selects
 * one slice re-renders only when that slice changed (SCALE6).
 */

export interface LastCommit {
	readonly origin: OpOrigin;
	readonly commitId: number;
}

function shallowEqual(
	left: Readonly<Record<string, unknown>> | null,
	right: Readonly<Record<string, unknown>> | null,
): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	const leftKeys = Object.keys(left);
	if (leftKeys.length !== Object.keys(right).length) return false;
	return leftKeys.every((key) => Object.is(left[key], right[key]));
}

function keepIfEqual<T extends object>(previous: T | undefined, next: T): T {
	return previous && shallowEqual(previous as Record<string, unknown>, next as Record<string, unknown>)
		? previous
		: next;
}

export function buildCommitSlice(
	editor: Editor,
	blockId: string,
	last: LastCommit | undefined,
	previous: BlockCommitSlice | undefined,
): BlockCommitSlice {
	const block = editor.getBlock(blockId);
	const props = block ? { ...block.props } : null;
	const next: BlockCommitSlice = {
		exists: block != null,
		type: block?.type ?? null,
		props: previous && shallowEqual(previous.props, props) ? previous.props : props,
		revision: editor.getBlockRevision(blockId),
		lastOrigin: last?.origin ?? previous?.lastOrigin ?? null,
		lastCommitId: last?.commitId ?? previous?.lastCommitId ?? 0,
	};
	return keepIfEqual(previous, next);
}

/** The ids `isBlockSelected(documentState.blockOrder, …)` treats as selected, in O(K). */
export function selectedBlockIds(editor: Editor, selection: SelectionState | null): readonly string[] {
	if (!selection) return [];
	switch (selection.type) {
		case "text":
			return textSelectionIds(editor, selection.anchor.blockId, selection.focus.blockId);
		case "block":
			return selection.blockIds;
		case "cell":
			return [selection.blockId];
		case "app":
			return [];
		default: {
			const unhandled: never = selection;
			return unhandled;
		}
	}
}

function textSelectionIds(editor: Editor, anchorId: string, focusId: string): readonly string[] {
	const state = editor.documentState;
	const anchorIndex = state.indexOf(anchorId);
	const focusIndex = state.indexOf(focusId);
	if (anchorIndex < 0 && focusIndex < 0) return [];
	if (anchorIndex < 0) return [focusId];
	if (focusIndex < 0) return [anchorId];
	const ids: string[] = [];
	for (let index = Math.min(anchorIndex, focusIndex); index <= Math.max(anchorIndex, focusIndex); index += 1) {
		const id = state.blockAt(index);
		if (id !== null) ids.push(id);
	}
	return ids;
}

const NO_SELECTION: BlockSelectionSlice = Object.freeze({
	inSelection: false,
	isAnchor: false,
	isFocus: false,
	caretHere: false,
	textRange: null,
	cell: null,
});

export function buildSelectionSlice(
	editor: Editor,
	selection: SelectionState | null,
	selected: ReadonlySet<string>,
	blockId: string,
	previous: BlockSelectionSlice | undefined,
): BlockSelectionSlice {
	const next = selectionSliceFor(editor, selection, selected, blockId);
	if (!previous) return next;
	const sameRange =
		previous.textRange === next.textRange ||
		(previous.textRange !== null &&
			next.textRange !== null &&
			previous.textRange.from === next.textRange.from &&
			previous.textRange.to === next.textRange.to);
	const same =
		previous.inSelection === next.inSelection &&
		previous.isAnchor === next.isAnchor &&
		previous.isFocus === next.isFocus &&
		previous.caretHere === next.caretHere &&
		sameCellGrid(previous.cell, next.cell) &&
		sameRange;
	return same ? previous : next;
}

/**
 * The slice carries grid coordinates; an edited cell's `text` moves with
 * every caret step and is the field editor's, so it does not re-render
 * the table.
 */
function sameCellGrid(
	previous: BlockSelectionSlice["cell"],
	next: BlockSelectionSlice["cell"],
): boolean {
	if (previous === null || next === null) {
		return previous === next;
	}
	return (
		previous.blockId === next.blockId &&
		previous.anchor.row === next.anchor.row &&
		previous.anchor.col === next.anchor.col &&
		previous.head.row === next.head.row &&
		previous.head.col === next.head.col
	);
}

function selectionSliceFor(
	editor: Editor,
	selection: SelectionState | null,
	selected: ReadonlySet<string>,
	blockId: string,
): BlockSelectionSlice {
	const inSelection = selected.has(blockId);
	switch (selection?.type) {
		case "text":
			return textSelectionSlice(editor, selection, inSelection, blockId);
		case "block":
			return inSelection ? { ...NO_SELECTION, inSelection, isFocus: selection.head === blockId } : NO_SELECTION;
		case "cell":
			return inSelection ? { ...NO_SELECTION, inSelection, cell: selection } : NO_SELECTION;
		default:
			return NO_SELECTION;
	}
}

function textSelectionSlice(
	editor: Editor,
	selection: Extract<SelectionState, { type: "text" }>,
	inSelection: boolean,
	blockId: string,
): BlockSelectionSlice {
	const isAnchor = selection.anchor.blockId === blockId;
	const isFocus = selection.focus.blockId === blockId;
	if (!inSelection && !isAnchor && !isFocus) return NO_SELECTION;
	const collapsed = isAnchor && isFocus && selection.anchor.offset === selection.focus.offset;
	return {
		inSelection,
		isAnchor,
		isFocus,
		caretHere: collapsed,
		textRange: inSelection ? textRangeFor(editor, selection, blockId) : null,
		cell: null,
	};
}

function textRangeFor(
	editor: Editor,
	selection: Extract<SelectionState, { type: "text" }>,
	blockId: string,
): { from: number; to: number | "end" } {
	const { anchor, focus } = selection;
	if (anchor.blockId === focus.blockId) {
		return { from: Math.min(anchor.offset, focus.offset), to: Math.max(anchor.offset, focus.offset) };
	}
	const state = editor.documentState;
	const forward = state.indexOf(anchor.blockId) <= state.indexOf(focus.blockId);
	const start = forward ? anchor : focus;
	const end = forward ? focus : anchor;
	if (blockId === start.blockId) return { from: start.offset, to: "end" };
	if (blockId === end.blockId) return { from: 0, to: end.offset };
	return { from: 0, to: "end" };
}

export function buildFieldSlice(
	editor: Editor,
	store: FieldEditorStoreSnapshot | null,
	blockId: string,
	domSyncVersion: number,
	previous: BlockFieldSlice | undefined,
): BlockFieldSlice {
	const isFieldFocus = store?.focusBlockId === blockId;
	const cell = store?.activeCellCoord?.blockId === blockId ? store.activeCellCoord : null;
	const expanded = store?.mode === "expanded" && store.activeBlockIds.includes(blockId);
	const next: BlockFieldSlice = {
		isFieldFocus,
		isEditing: isFieldFocus && (store?.isEditing ?? false),
		isComposing: isFieldFocus && (store?.isComposing ?? false),
		expandedRole: expanded ? getExpandedBlockRole(editor, blockId) : null,
		domSyncVersion,
		activeCell:
			cell === null
				? null
				: previous?.activeCell &&
					  previous.activeCell.row === cell.row &&
					  previous.activeCell.col === cell.col
					? previous.activeCell
					: { row: cell.row, col: cell.col },
	};
	return keepIfEqual(previous, next);
}

export function buildListSlice(
	ordinal: number | null,
	semantics: ListItemSemantics | null,
	previous: BlockListSlice | null | undefined,
): BlockListSlice | null {
	if (semantics === null) return null;
	const { level, posinset, setsize, groupKey } = semantics;
	return keepIfEqual(previous ?? undefined, { ordinal, level, posinset, setsize, groupKey });
}

export function buildSurfaceSnapshot(
	store: FieldEditorStoreSnapshot | null,
	previous: SurfaceSnapshot | undefined,
): SurfaceSnapshot {
	const next: SurfaceSnapshot = {
		mode: store?.mode ?? "inactive",
		activeBlockIds: store?.activeBlockIds ?? [],
		focusBlockId: store?.focusBlockId ?? null,
		isFocused: store?.isFocused ?? false,
		isEditing: store?.isEditing ?? false,
		isComposing: store?.isComposing ?? false,
	};
	if (!previous) return next;
	const same =
		previous.mode === next.mode &&
		arraysEqual(previous.activeBlockIds, next.activeBlockIds) &&
		previous.focusBlockId === next.focusBlockId &&
		previous.isFocused === next.isFocused &&
		previous.isEditing === next.isEditing &&
		previous.isComposing === next.isComposing;
	return same ? previous : next;
}
