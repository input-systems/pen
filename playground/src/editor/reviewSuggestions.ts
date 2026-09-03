import type { PersistentSuggestion } from "@input/pen-ai";
import type { Editor } from "@input/pen-types";

/**
 * Reads a pending suggestion back against the document so the review bar can
 * name it: which block, what kind of change, and a glimpse of the text.
 * Nothing here writes; accept and reject stay on the AI controller.
 */

interface CellPosition {
	row: number;
	col: number;
}

const PREVIEW_MAX_LENGTH = 56;

const ACTION_LABELS = {
	insert: "Insert",
	delete: "Delete",
	"insert-block": "Insert",
	"delete-block": "Delete",
	"move-block": "Move",
	"convert-block": "Convert",
	"split-block": "Split",
	"format-text": "Format",
} as const satisfies Record<PersistentSuggestion["action"], string>;

export function suggestionActionLabel(
	suggestion: PersistentSuggestion,
): string {
	return ACTION_LABELS[suggestion.action];
}

export function isDeletion(suggestion: PersistentSuggestion): boolean {
	return (
		suggestion.action === "delete" || suggestion.action === "delete-block"
	);
}

/** Document order, then cell order, then offset within the text. */
export function sortSuggestionsByDocumentOrder(
	editor: Editor,
	suggestions: readonly PersistentSuggestion[],
): PersistentSuggestion[] {
	const blockIndex = new Map(
		editor.documentState.blockOrder.map((blockId, index) => [
			blockId,
			index,
		]),
	);

	return [...suggestions].sort((left, right) => {
		const leftIndex =
			blockIndex.get(left.blockId) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex =
			blockIndex.get(right.blockId) ?? Number.MAX_SAFE_INTEGER;
		if (leftIndex !== rightIndex) {
			return leftIndex - rightIndex;
		}

		const cellOrder = compareCells(cellOf(left), cellOf(right));
		if (cellOrder !== 0) {
			return cellOrder;
		}

		return offsetOf(left) - offsetOf(right);
	});
}

/** `paragraph · first words…`, or the cell coordinate for a table edit. */
export function describeSuggestionLocation(
	editor: Editor,
	suggestion: PersistentSuggestion,
): string {
	const block = editor.getBlock(suggestion.blockId);
	if (!block) {
		return "Unknown block";
	}

	const cell = cellOf(suggestion);
	if (cell) {
		const cellText = block
			.as("table")
			?.tableCell(cell.row, cell.col)
			?.textContent()
			.trim();
		const coordinate = `r${cell.row + 1}c${cell.col + 1}`;
		return cellText
			? `table · ${coordinate} · ${truncate(cellText)}`
			: `table · ${coordinate}`;
	}

	const preview = truncate(block.textContent().trim());
	return preview ? `${block.type} · ${preview}` : block.type;
}

/** The text a suggestion touches, or a sentence about the block change. */
export function describeSuggestionChange(
	editor: Editor,
	suggestion: PersistentSuggestion,
): string {
	const block = editor.getBlock(suggestion.blockId);
	const blockType = block?.type ?? "block";

	if (suggestion.kind === "text") {
		const source = suggestion.cell
			? (block
					?.as("table")
					?.tableCell(suggestion.cell.row, suggestion.cell.col)
					?.textContent() ?? "")
			: (block?.textContent() ?? "");
		const text = source
			.slice(suggestion.offset, suggestion.offset + suggestion.length)
			.trim();
		if (text) {
			return truncate(text);
		}
		return suggestion.action === "delete"
			? "Deleted text"
			: "Inserted text";
	}

	switch (suggestion.action) {
		case "insert-block":
			return `Insert ${blockType}`;
		case "delete-block":
			return `Delete ${blockType}`;
		case "move-block":
			return `Move ${blockType}`;
		case "split-block":
			return `Split ${blockType}`;
		// A pending attribute change leaves the block as it was, so the block
		// only tells you the half that is not changing; the proposal rides on
		// the suggestion.
		case "convert-block": {
			const proposedType = suggestion.previousState?.type;
			return proposedType
				? `Convert ${blockType} to ${proposedType}`
				: `Convert ${blockType}`;
		}
		case "format-text": {
			const marks = Object.keys(
				suggestion.previousState?.format?.marks ?? {},
			);
			return marks.length > 0
				? `Format ${marks.join(", ")}`
				: `Format ${blockType}`;
		}
	}
}

function cellOf(suggestion: PersistentSuggestion): CellPosition | undefined {
	return suggestion.kind === "text" ? suggestion.cell : undefined;
}

function offsetOf(suggestion: PersistentSuggestion): number {
	return suggestion.kind === "text" ? suggestion.offset : 0;
}

/** Block-level suggestions sort before any cell inside the same block. */
function compareCells(
	left: CellPosition | undefined,
	right: CellPosition | undefined,
): number {
	if (left && right) {
		return left.row - right.row || left.col - right.col;
	}
	if (left) {
		return 1;
	}
	if (right) {
		return -1;
	}
	return 0;
}

function truncate(value: string): string {
	if (value.length <= PREVIEW_MAX_LENGTH) {
		return value;
	}
	return `${value.slice(0, PREVIEW_MAX_LENGTH)}…`;
}
