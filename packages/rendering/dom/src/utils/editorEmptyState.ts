import { getBlockContentRole } from "@input/pen-core";
import type { Editor } from "@input/pen-types";

interface InlineDeltaLike {
	insert: string | object;
}

export function computeDocumentEmpty(editor: Editor): boolean {
	return editor.documentState.isEmpty;
}

/**
 * The empty-document placeholder's block, or `null` when the document is not
 * eligible. Chrome (`getBlockContentRole` === `"chrome"`) is not content.
 *
 * @param editor - Live editor whose root `blockOrder` is read.
 * @returns The sole empty inline content block, or `null`.
 * @throws Never.
 */
export function getDocumentPlaceholderTargetBlockId(
	editor: Editor,
): string | null {
	// Stop at the second content block: the answer is already null, and a
	// commit must not scan the document to learn that (SCALE2).
	let blockId: string | null = null;
	for (const candidate of editor.documentState.blockOrder) {
		if (isChromeBlock(editor, candidate)) continue;
		if (blockId !== null) return null;
		blockId = candidate;
	}
	if (blockId === null) return null;
	const block = editor.getBlock(blockId);
	if (!block) return null;
	const schema = editor.schema.resolve(block.type);
	if (
		!schema ||
		schema.content !== "inline" ||
		schema.fieldEditor === "none"
	) {
		return null;
	}
	return isInlineContentEmpty(block.inlineDeltas()) ? blockId : null;
}

function isChromeBlock(editor: Editor, blockId: string): boolean {
	const block = editor.getBlock(blockId);
	if (!block) return false;
	const schema = editor.schema.resolve(block.type);
	return getBlockContentRole(schema) === "chrome";
}

export function isInlineContentEmpty(
	deltas: readonly InlineDeltaLike[],
): boolean {
	if (deltas.some((delta) => typeof delta.insert !== "string")) {
		return false;
	}
	const stored = deltas
		.map((delta) => (typeof delta.insert === "string" ? delta.insert : ""))
		.join("");
	return stored === "";
}
