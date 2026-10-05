import type {
	Affinity,
	BlockRectEntry,
	GeometryReader,
	LineBox,
	Point,
	Rect,
} from "./types";
import { rectCenterX, rectCenterY } from "./types";

export type VerticalDirection = "up" | "down";

export type VerticalCaretTarget = {
	readonly point: Point;
	readonly goalX: number;
};

type GeometryReaderWithBlocks = GeometryReader & {
	blockIds(): readonly string[];
};

type GeometryReaderWithBlockRects = GeometryReader & {
	blockRects(): readonly BlockRectEntry[];
};

/**
 * G5: vertical caret motion. `pen.caretUp/Down` call this via
 * `measureNow`. `goalX` persists on the resulting selection.
 *
 * `affinity` is the side the caret is drawn on, read from the selection.
 * At a wrap or `\n` boundary the same offset is upstream the end of the
 * line above and downstream the start of the line below, so deriving it
 * from `direction` would measure the caret on the wrong line and skip one.
 */
export function verticalCaretTarget(
	reader: GeometryReader,
	current: Point,
	direction: VerticalDirection,
	goalX?: number | null,
	affinity: Affinity = "downstream",
): VerticalCaretTarget | null {
	const currentRect = reader.caretRect(current, affinity);
	const x = goalX ?? (currentRect ? rectCenterX(currentRect) : 0);

	const currentLines = reader.lineBoxes(current.blockId);
	const currentIndex = findLineIndex(currentLines, current, currentRect);
	const adjacentInBlock =
		currentIndex >= 0
			? adjacentLine(currentLines, currentIndex, direction)
			: null;

	const targetLine =
		adjacentInBlock ??
		adjacentBlockLine(reader, current.blockId, direction);

	if (!targetLine) {
		return { point: current, goalX: x };
	}

	const y = targetLineY(currentRect, targetLine);
	const point = reader.pointAt(x, y) ?? current;
	return { point, goalX: x };
}

function adjacentLine(
	lines: readonly LineBox[],
	index: number,
	direction: VerticalDirection,
): LineBox | null {
	switch (direction) {
		case "down":
			return lines[index + 1] ?? null;
		case "up":
			return lines[index - 1] ?? null;
		default: {
			const _exhaustive: never = direction;
			return _exhaustive;
		}
	}
}

function adjacentBlockLine(
	reader: GeometryReader,
	blockId: string,
	direction: VerticalDirection,
): LineBox | null {
	const neighborId = adjacentBlockId(listBlockRects(reader), blockId, direction);
	if (neighborId === null) {
		return null;
	}

	const lines = reader.lineBoxes(neighborId);
	if (lines.length === 0) {
		return null;
	}

	switch (direction) {
		case "down":
			return lines[0] ?? null;
		case "up":
			return lines[lines.length - 1] ?? null;
		default: {
			const _exhaustive: never = direction;
			return _exhaustive;
		}
	}
}

/**
 * The block next to `blockId` in visual order — by top, then left, then DOM
 * order — found in one pass rather than by sorting every block (SCALE6).
 */
function adjacentBlockId(
	entries: readonly BlockRectEntry[],
	blockId: string,
	direction: VerticalDirection,
): string | null {
	const currentIndex = entries.findIndex((entry) => entry.id === blockId);
	const current = entries[currentIndex];
	if (!current) {
		return null;
	}
	const sign = direction === "down" ? 1 : -1;
	let best: { entry: BlockRectEntry; index: number } | null = null;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (!entry || index === currentIndex) continue;
		// Only blocks past the current one in the motion direction.
		if (sign * compareVisual(entry, index, current, currentIndex) <= 0) continue;
		// The closest of those.
		if (best && sign * compareVisual(entry, index, best.entry, best.index) >= 0) continue;
		best = { entry, index };
	}
	return best?.entry.id ?? null;
}

function compareVisual(
	left: BlockRectEntry,
	leftIndex: number,
	right: BlockRectEntry,
	rightIndex: number,
): number {
	return (
		left.rect.top - right.rect.top ||
		left.rect.left - right.rect.left ||
		leftIndex - rightIndex
	);
}

function listBlockRects(reader: GeometryReader): readonly BlockRectEntry[] {
	if (hasBlockRects(reader)) {
		return reader.blockRects();
	}
	if (!hasBlockIds(reader)) {
		return [];
	}
	return reader.blockIds().flatMap((id) => {
		const rect = reader.blockRect(id);
		return rect ? [{ id, rect }] : [];
	});
}

function hasBlockRects(
	reader: GeometryReader,
): reader is GeometryReaderWithBlockRects {
	return (
		"blockRects" in reader &&
		typeof (reader as GeometryReaderWithBlockRects).blockRects === "function"
	);
}

function hasBlockIds(
	reader: GeometryReader,
): reader is GeometryReaderWithBlocks {
	return (
		"blockIds" in reader &&
		typeof (reader as GeometryReaderWithBlocks).blockIds === "function"
	);
}

function findLineIndex(
	lines: readonly LineBox[],
	current: Point,
	rect: Rect | null,
): number {
	if (lines.length === 0) {
		return -1;
	}

	if (rect) {
		const y = rectCenterY(rect);
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (!line) continue;
			if (y >= line.top - 1 && y <= line.bottom + 1) {
				return index;
			}
		}
	}

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) continue;
		const last = index === lines.length - 1;
		if (
			current.offset >= line.startOffset &&
			(current.offset < line.endOffset ||
				(last && current.offset <= line.endOffset))
		) {
			return index;
		}
	}

	return 0;
}

function targetLineY(currentRect: Rect | null, line: LineBox): number {
	const mid = (line.top + line.bottom) / 2;
	if (!currentRect) {
		return mid;
	}
	const y = rectCenterY(currentRect);
	// G5: the shared edge between adjacent line boxes hit-tests back onto the
	// current block once chrome makes the inline surface full width (HOST6).
	if (y <= line.top || y >= line.bottom) {
		return mid;
	}
	return y;
}
