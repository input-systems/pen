import { getSelectionBlockRange, isMultiBlock } from "@input/pen-core";
import type { Editor, FieldEditor, SelectionState } from "@input/pen-types";
import { BLOCK_SURFACE_MODE_THRESHOLD } from "../constants/selection";
import { getBlockSelectionRoleFromSchema } from "../utils/blockSelectionSemantics";

/**
 * Cross-block expansion and contraction.
 *
 * Handles expanding the contenteditable scope across multiple blocks
 * and managing shared Y.Text observation.
 */

export type FieldEditorSurfaceMode =
	| "inactive"
	| "single"
	| "expanded"
	| "block";

export type ExpandedBlockRole = "editable-inline" | "structural" | "delegated";

export interface FieldEditorSurfaceState {
	mode: FieldEditorSurfaceMode;
	blockIds: string[];
}

/**
 * Expand the field editor range from the current block to the target block.
 * Called on shift-click or drag gestures.
 */
export function expandFieldEditorRange(
	fieldEditor: Pick<FieldEditor, "expandTo">,
	targetBlockId: string,
): void {
	fieldEditor.expandTo(targetBlockId);
}

/**
 * Contract back to a single block (the focused one).
 */
export function contractFieldEditorRange(
	fieldEditor: Pick<FieldEditor, "contractToFocused">,
): void {
	fieldEditor.contractToFocused();
}

/**
 * Surface heuristic: a text range over >50 blocks skips contenteditable
 * expansion (`mode: "block"`). This is not an authority-type change.
 * T3: pointer reads never flip to BlockSelection by count. D5: the range is
 * shown by the `block-surface-range` substitute state (S2).
 */
export function shouldUseBlockSelection(
	_editor: Editor,
	blockCount: number,
): boolean {
	return blockCount > BLOCK_SURFACE_MODE_THRESHOLD;
}

/** D5: whether a text selection is a block-surface range (more than the threshold of blocks). */
export function isBlockSurfaceTextRange(
	editor: Editor,
	selection: SelectionState,
): boolean {
	if (selection?.type !== "text" || !isMultiBlock(selection)) {
		return false;
	}
	return shouldUseBlockSelection(
		editor,
		getSelectionBlockRange(editor.documentState, selection).length,
	);
}

export function getExpandedBlockRole(
	editor: Editor,
	blockId: string,
): ExpandedBlockRole | null {
	const block = editor.getBlock(blockId);
	if (!block) return null;

	return getBlockSelectionRoleFromSchema(editor.schema.resolve(block.type));
}

export function classifySelectionSurface(
	editor: Editor,
	selection: SelectionState | null,
	focusBlockId: string | null,
	isEditing: boolean,
): FieldEditorSurfaceState {
	if (!isEditing) {
		return { mode: "inactive", blockIds: [] };
	}

	if (selection?.type === "text") {
		const blockRange = getSelectionBlockRange(editor.documentState, selection);
		if (isMultiBlock(selection)) {
			return {
				mode: shouldUseBlockSelection(editor, blockRange.length)
					? "block"
					: "expanded",
				blockIds: [...blockRange],
			};
		}

		if (!focusBlockId) {
			return { mode: "inactive", blockIds: [] };
		}

		if (!blockRange.includes(focusBlockId)) {
			return { mode: "single", blockIds: [focusBlockId] };
		}

		return { mode: "single", blockIds: [focusBlockId] };
	}

	if (!focusBlockId) {
		return { mode: "inactive", blockIds: [] };
	}

	if (selection?.type === "block") {
		if (selection.blockIds.includes(focusBlockId)) {
			return { mode: "block", blockIds: [...selection.blockIds] };
		}
	}

	if (selection?.type === "cell" && selection.blockId === focusBlockId) {
		return { mode: "inactive", blockIds: [] };
	}

	return { mode: "single", blockIds: [focusBlockId] };
}
