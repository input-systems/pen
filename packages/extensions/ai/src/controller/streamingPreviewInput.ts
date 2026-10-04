import type { DocumentRange, Editor } from "@input/pen-types";
import type { EditDocumentPreviewPlacement } from "../runtime/editDocumentPreview";
import { normalizeFlowMarkdownOutput } from "../runtime/flowMarkdown";
import { toStreamingPreviewText } from "../runtime/streamingPreviewText";
import type {
	AIStreamingReviewPreviewInput,
	AIStreamingReviewPreviewTarget,
} from "../types";

/**
 * Display text for a markdown payload still arriving on the review surface.
 *
 * The commit normalizes before parsing, so a preview that skipped
 * normalization would show fences and annotations that accept then drops —
 * the fidelity RS6 measures is between the preview and what accept writes,
 * not between the preview and the raw model output.
 */
function markdownStreamingPreviewText(text: string): string {
	return toStreamingPreviewText(normalizeFlowMarkdownOutput(text));
}

function streamingPreviewDisplayText(
	text: string,
	format: "plain" | "markdown",
): string {
	return format === "markdown" ? markdownStreamingPreviewText(text) : text;
}

/**
 * Which region a streaming markdown block preview covers.
 *
 * The commit chooses between replacing a named span of blocks, replacing the
 * target block, and appending at an offset; the preview has to name the same
 * region or it strikes through text the commit will keep.
 */
function resolveMarkdownPreviewTarget(
	editor: Editor,
	target: {
		blockId: string;
		offset: number;
		replaceTargetBlock: boolean;
		replaceBlockIds?: readonly string[];
	},
): AIStreamingReviewPreviewTarget {
	const replaceBlockIds = target.replaceBlockIds ?? [];
	if (replaceBlockIds.length > 0) {
		const endBlockId = replaceBlockIds[replaceBlockIds.length - 1]!;
		return {
			kind: "block-range",
			start: { blockId: replaceBlockIds[0]!, offset: 0 },
			end: {
				blockId: endBlockId,
				offset: blockTextLength(editor, endBlockId),
			},
			blockIds: [...replaceBlockIds],
		};
	}
	if (target.replaceTargetBlock) {
		return {
			kind: "text-range",
			blockId: target.blockId,
			from: 0,
			to: blockTextLength(editor, target.blockId),
		};
	}
	return {
		kind: "insertion-point",
		blockId: target.blockId,
		offset: target.offset,
	};
}

/**
 * Which region a streaming selection-rewrite preview covers.
 *
 * A rewrite replaces the selection, so the preview strikes exactly the
 * selected text. A selection spanning blocks cannot say that as one text
 * range, and naming only its first block would leave the rest of the
 * selection looking untouched while the replacement grows. Endpoints
 * missing from blockOrder cannot be named either; callers skip the preview.
 */
export function resolveSelectionPreviewTarget(
	editor: Editor,
	range: Pick<DocumentRange, "start" | "end">,
): AIStreamingReviewPreviewTarget | null {
	if (range.start.blockId === range.end.blockId) {
		return {
			kind: "text-range",
			blockId: range.start.blockId,
			from: range.start.offset,
			to: range.end.offset,
		};
	}
	const blockOrder = editor.documentState.blockOrder;
	const startIndex = blockOrder.indexOf(range.start.blockId);
	const endIndex = blockOrder.indexOf(range.end.blockId);
	if (startIndex < 0 || endIndex < 0) {
		return null;
	}
	return {
		kind: "block-range",
		start: { blockId: range.start.blockId, offset: range.start.offset },
		end: { blockId: range.end.blockId, offset: range.end.offset },
		blockIds: blockOrder
			.slice(
				Math.min(startIndex, endIndex),
				Math.max(startIndex, endIndex) + 1,
			)
			.filter((blockId) => editor.getBlock(blockId) != null),
	};
}

export function markdownReviewPreviewInput(
	editor: Editor,
	input: {
		sessionId: string;
		turnId?: string;
		blockId: string;
		offset: number;
		replaceTargetBlock: boolean;
		replaceBlockIds?: readonly string[];
		text: string;
	},
): AIStreamingReviewPreviewInput {
	return {
		sessionId: input.sessionId,
		turnId: input.turnId,
		target: resolveMarkdownPreviewTarget(editor, input),
		text: markdownStreamingPreviewText(input.text),
	};
}

export function selectionReviewPreviewInput(
	editor: Editor,
	input: {
		sessionId: string;
		turnId?: string;
		range: Pick<DocumentRange, "start" | "end">;
		text: string;
		format: "plain" | "markdown";
	},
): AIStreamingReviewPreviewInput | null {
	const target = resolveSelectionPreviewTarget(editor, input.range);
	if (!target) {
		return null;
	}
	return {
		sessionId: input.sessionId,
		turnId: input.turnId,
		target,
		text: streamingPreviewDisplayText(input.text, input.format),
	};
}

export interface EditDocumentReviewPreviewSource {
	sessionId: string;
	turnId?: string;
	operationIndex: number;
	blockIds: readonly string[];
	placement: EditDocumentPreviewPlacement | null;
	operation: string | null;
	text: string;
	complete: boolean;
}

/**
 * The review preview for one arriving `edit_document` operation, mapped to
 * what that operation changes (RS6): a replace or delete covers every block
 * it names, an insert previews on the side its placement names, and an
 * operation that changes no text — a move, a format, a prop change, or one
 * not yet named — returns `null` so it previews nothing.
 *
 * Offsets are logical (`block.length()`), so a block holding an inline atom
 * is covered to its end (N6).
 */
export function editDocumentReviewPreviewInput(
	editor: Editor,
	input: EditDocumentReviewPreviewSource,
): AIStreamingReviewPreviewInput | null {
	const blockIds = input.blockIds.filter(
		(blockId) => editor.getBlock(blockId) != null,
	);
	const target = editDocumentPreviewTarget(
		editor,
		input.operation,
		blockIds,
		input.placement,
	);
	if (target == null) {
		return null;
	}
	const isDelete = input.operation === "delete_blocks";
	return {
		sessionId: input.sessionId,
		turnId: input.turnId,
		operationIndex: input.operationIndex,
		target,
		text: isDelete
			? ""
			: editDocumentPreviewText(
					input.operation,
					input.text,
					input.placement,
				),
		complete: input.complete,
		...(isDelete ? { deletesBlocks: true } : {}),
		...(input.operation === "replace_blocks" ? { replacesBlocks: true } : {}),
	};
}

function editDocumentPreviewTarget(
	editor: Editor,
	operation: string | null,
	blockIds: readonly string[],
	placement: EditDocumentPreviewPlacement | null,
): AIStreamingReviewPreviewTarget | null {
	const first = blockIds[0];
	if (first == null) {
		return null;
	}
	switch (operation) {
		case "replace_block_text":
			return {
				kind: "text-range",
				blockId: first,
				from: 0,
				to: logicalBlockLength(editor, first),
			};
		case "replace_blocks":
		case "delete_blocks":
			return namedBlocksRange(editor, blockIds);
		case "insert_blocks":
			return {
				kind: "insertion-point",
				blockId: first,
				offset:
					placement === "before"
						? 0
						: logicalBlockLength(editor, first),
			};
		default:
			return null;
	}
}

/**
 * Every named block, first to last in nested document order, so a block
 * inside a container is named like a top-level one. A block-range covers
 * whole blocks, so the preview hides each one the commit replaces or deletes
 * rather than only the first.
 */
function namedBlocksRange(
	editor: Editor,
	blockIds: readonly string[],
): AIStreamingReviewPreviewTarget {
	const state = editor.documentState;
	const ordered = [...new Set(blockIds)]
		.filter((blockId) => state.preorderIndexOf(blockId) >= 0)
		.sort(
			(left, right) =>
				state.preorderIndexOf(left) - state.preorderIndexOf(right),
		);
	const start = ordered[0] ?? blockIds[0]!;
	const end = ordered[ordered.length - 1] ?? start;
	return {
		kind: "block-range",
		start: { blockId: start, offset: 0 },
		end: { blockId: end, offset: logicalBlockLength(editor, end) },
		blockIds: ordered.length > 0 ? ordered : [start],
	};
}

/**
 * Inserted blocks are lines of their own: one placed before a block ends in a
 * line break, one placed after starts with one. A trailing line break in the
 * payload ends the markdown, not a block, so it is not shown.
 */
function editDocumentPreviewText(
	operation: string | null,
	text: string,
	placement: EditDocumentPreviewPlacement | null,
): string {
	if (operation === "replace_block_text") {
		return text;
	}
	const lines = text.replace(/\n+$/, "");
	if (operation !== "insert_blocks" || lines.length === 0) {
		return lines;
	}
	return placement === "before" ? `${lines}\n` : `\n${lines}`;
}

function logicalBlockLength(editor: Editor, blockId: string): number {
	return editor.getBlock(blockId)?.length() ?? 0;
}

function blockTextLength(editor: Editor, blockId: string): number {
	return editor.getBlock(blockId)?.textContent().length ?? 0;
}
