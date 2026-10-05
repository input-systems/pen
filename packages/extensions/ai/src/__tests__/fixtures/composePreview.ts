import { inlineLogicalText } from "@input/pen-core";
import type { BlockHandle, Decoration, Editor } from "@input/pen-types";
import {
	AI_REVIEW_ROLE_ATTRIBUTE,
	FINAL_TEXT_REVIEW_HIDDEN_ATTRIBUTE,
} from "../../review/reviewPresentationState";

/**
 * RS6 composition: what the review preview shows once its hidden ranges are
 * taken out and its virtual inserts are put in, read as lines of text.
 *
 * Deleted text counts as gone whether the presentation strikes it through
 * (`track-changes`) or hides it (`final-text`): the property compares what
 * the preview says accepting leaves behind with what accepting leaves behind.
 */
export interface ComposedPreview {
	/** One string per visible line, in document order; a `\n` in virtual text starts a new line. */
	readonly lines: readonly string[];
	/** Composed text per original block id (single-block comparisons). */
	readonly byBlock: ReadonlyMap<string, string>;
	readonly deleteDecorationsEmitted: number;
	readonly deleteDecorationsConsumed: number;
}

export interface ComposePreviewOptions {
	/**
	 * Whether the composition applies a delete decoration. Always true for the
	 * real composer; the guard test passes a predicate that drops one, so it
	 * can prove a composer that loses a hidden range is caught.
	 */
	readonly consume?: (decoration: Decoration) => boolean;
}

/** Cell separator `toStreamingPreviewText` uses when it flattens a table row. */
const TABLE_CELL_SEPARATOR = "  ";

const INLINE_DELETE_ROLES = new Set(["delete", "delete-hidden"]);
const BLOCK_DELETE_ROLE = "block-delete";

interface BlockComposition {
	readonly removed: Array<{ from: number; to: number }>;
	readonly inserts: Array<{ offset: number; text: string }>;
	removesBlock: boolean;
}

function isInlineDelete(decoration: Decoration): boolean {
	if (decoration.type !== "inline" || decoration.virtualText) {
		return false;
	}
	const attributes = decoration.attributes;
	return (
		INLINE_DELETE_ROLES.has(String(attributes[AI_REVIEW_ROLE_ATTRIBUTE])) ||
		attributes[FINAL_TEXT_REVIEW_HIDDEN_ATTRIBUTE] === true
	);
}

function isBlockDelete(decoration: Decoration): boolean {
	return (
		decoration.type === "block" &&
		decoration.attributes[AI_REVIEW_ROLE_ATTRIBUTE] === BLOCK_DELETE_ROLE
	);
}

function compositionFor(
	compositions: Map<string, BlockComposition>,
	blockId: string,
): BlockComposition {
	let composition = compositions.get(blockId);
	if (!composition) {
		composition = { removed: [], inserts: [], removesBlock: false };
		compositions.set(blockId, composition);
	}
	return composition;
}

/** Text lines a block shows when nothing decorates it. */
export function blockLines(block: BlockHandle): string[] {
	const table = block.as("table");
	if (table) {
		const rows: string[] = [];
		const columnCount = table.tableColumnCount();
		for (let row = 0; row < table.tableRowCount(); row += 1) {
			const cells: string[] = [];
			for (let column = 0; column < columnCount; column += 1) {
				cells.push(table.tableCell(row, column)?.textContent() ?? "");
			}
			rows.push(
				cells
					.filter((cell) => cell.length > 0)
					.join(TABLE_CELL_SEPARATOR),
			);
		}
		return rows;
	}
	return [inlineLogicalText(block)];
}

function composeBlockText(text: string, composition: BlockComposition): string {
	const removed = new Array<boolean>(text.length).fill(false);
	for (const range of composition.removed) {
		for (
			let index = Math.max(0, range.from);
			index < Math.min(text.length, range.to);
			index += 1
		) {
			removed[index] = true;
		}
	}
	// Stable by offset: two inserts at one offset render in decoration order,
	// as `applyInlineDecorationsToDeltas` places them.
	const inserts = composition.inserts
		.map((insert, order) => ({ ...insert, order }))
		.sort(
			(left, right) =>
				left.offset - right.offset || left.order - right.order,
		);
	let output = "";
	let insertIndex = 0;
	for (let offset = 0; offset <= text.length; offset += 1) {
		while (
			insertIndex < inserts.length &&
			(inserts[insertIndex]!.offset <= offset || offset === text.length)
		) {
			output += inserts[insertIndex]!.text;
			insertIndex += 1;
		}
		if (offset < text.length && !removed[offset]) {
			output += text[offset];
		}
	}
	return output;
}

/**
 * Composes the visible document from the live blocks and the preview's
 * decorations. A delete decoration counts as consumed when its range was
 * applied to a block that exists.
 */
export function composePreview(
	editor: Editor,
	decorations: readonly Decoration[],
	options: ComposePreviewOptions = {},
): ComposedPreview {
	const consume = options.consume ?? (() => true);
	const compositions = new Map<string, BlockComposition>();
	let deleteDecorationsEmitted = 0;
	let deleteDecorationsConsumed = 0;
	for (const decoration of decorations) {
		const outcome = recordDecoration(
			editor,
			compositions,
			decoration,
			consume,
		);
		if (outcome !== "not-a-delete") {
			deleteDecorationsEmitted += 1;
		}
		if (outcome === "consumed") {
			deleteDecorationsConsumed += 1;
		}
	}

	const lines: string[] = [];
	const byBlock = new Map<string, string>();
	for (const blockId of editor.documentState.blockOrder) {
		const block = editor.getBlock(blockId);
		if (!block) {
			continue;
		}
		const shown = composedBlockLines(block, compositions.get(blockId));
		byBlock.set(blockId, shown.join("\n"));
		lines.push(...shown);
	}
	return {
		lines,
		byBlock,
		deleteDecorationsEmitted,
		deleteDecorationsConsumed,
	};
}

type DecorationOutcome = "not-a-delete" | "emitted" | "consumed";

/** Files one decoration under its block and says whether it hid anything. */
function recordDecoration(
	editor: Editor,
	compositions: Map<string, BlockComposition>,
	decoration: Decoration,
	consume: (decoration: Decoration) => boolean,
): DecorationOutcome {
	const isDelete = isBlockDelete(decoration) || isInlineDelete(decoration);
	if (editor.getBlock(decoration.blockId) == null) {
		return isDelete ? "emitted" : "not-a-delete";
	}
	const composition = compositionFor(compositions, decoration.blockId);
	if (!isDelete) {
		recordInsert(composition, decoration);
		return "not-a-delete";
	}
	if (!consume(decoration)) {
		return "emitted";
	}
	if (decoration.type !== "inline") {
		composition.removesBlock = true;
		return "consumed";
	}
	if (decoration.to <= decoration.from) {
		return "emitted";
	}
	composition.removed.push({ from: decoration.from, to: decoration.to });
	return "consumed";
}

function recordInsert(
	composition: BlockComposition,
	decoration: Decoration,
): void {
	if (decoration.type !== "inline" || !decoration.virtualText) {
		return;
	}
	composition.inserts.push({
		offset:
			decoration.virtualPlacement === "before"
				? decoration.from
				: decoration.to,
		text: decoration.virtualText,
	});
}

function composedBlockLines(
	block: BlockHandle,
	composition: BlockComposition | undefined,
): string[] {
	if (composition?.removesBlock) {
		return [];
	}
	if (!composition || block.as("table")) {
		return blockLines(block);
	}
	return composeBlockText(inlineLogicalText(block), composition).split("\n");
}

/** The accepted document read the way {@link composePreview} reads a preview. */
export function projectAccepted(editor: Editor): readonly string[] {
	return editor.documentState.blockOrder.flatMap((blockId) => {
		const block = editor.getBlock(blockId);
		return block ? blockLines(block) : [];
	});
}
