import type { BlockSelectionRole, Editor } from "@input/pen-types";
import {
	buildTransitionSnapshot,
	getBlockSelectionRoleFromSchema as getSharedBlockSelectionRoleFromSchema,
	getBlockSelectionRoleFromType as getSharedBlockSelectionRoleFromType,
} from "@input/pen-core";
export type { BlockSelectionRole } from "@input/pen-types";

export function getBlockSelectionRoleFromSchema(
	schema: Parameters<typeof getSharedBlockSelectionRoleFromSchema>[0],
): BlockSelectionRole | null {
	return getSharedBlockSelectionRoleFromSchema(schema);
}

export function getBlockSelectionRoleFromType(
	blockType: string | null | undefined,
): BlockSelectionRole {
	return getSharedBlockSelectionRoleFromType(blockType);
}

export function getEditorBlockSelectionRole(
	editor: Editor,
	blockId: string,
): BlockSelectionRole | null {
	const block = editor.getBlock(blockId);
	if (!block) {
		return null;
	}

	return getBlockSelectionRoleFromSchema(editor.schema.resolve(block.type));
}

export function getSelectionLengthForRole(
	role: BlockSelectionRole | null,
	textLength: number,
): number {
	if (role && role !== "editable-inline") {
		return 1;
	}

	return textLength;
}

export function getEditorBlockSelectionLength(
	editor: Editor,
	blockId: string,
): number {
	const block = editor.getBlock(blockId);
	if (!block) {
		return 0;
	}

	return getSelectionLengthForRole(
		getEditorBlockSelectionRole(editor, blockId),
		block.length(),
	);
}

export function isInlineEditableBlock(
	editor: Editor,
	blockId: string,
): boolean {
	return getEditorBlockSelectionRole(editor, blockId) === "editable-inline";
}

/**
 * N2: whether the block has no text positions of its own (a divider, an
 * image, a table), by core's text/structural split, so a code block holds
 * text. A collapse onto such a block selects it rather than placing a caret.
 */
export function isStructuralBlock(editor: Editor, blockId: string): boolean {
	return (
		buildTransitionSnapshot(editor, { blockIds: [blockId] }).blocks[blockId]
			?.kind === "structural"
	);
}
