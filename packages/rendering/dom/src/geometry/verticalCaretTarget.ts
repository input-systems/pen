import type { Affinity, GeometryReader, LineBox, Point, Rect } from "./types";
import { rectCenterX, rectCenterY } from "./types";

export type VerticalDirection = "up" | "down";

export type VerticalCaretTarget = {
	readonly point: Point;
	readonly goalX: number;
};

type GeometryReaderWithBlocks = GeometryReader & {
	blockIds(): readonly string[];
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
	const ids = listBlockIds(reader);
	if (ids.length === 0) {
		return null;
	}

	const ranked = ids
		.map((id) => ({ id, rect: reader.blockRect(id) }))
		.filter(
			(entry): entry is { id: string; rect: Rect } => entry.rect != null,
		)
		.sort((left, right) => {
			const top = left.rect.top - right.rect.top;
			return top !== 0 ? top : left.rect.left - right.rect.left;
		});

	const index = ranked.findIndex((entry) => entry.id === blockId);
	if (index < 0) {
		return null;
	}

	const neighbor =
		direction === "down" ? ranked[index + 1] : ranked[index - 1];
	if (!neighbor) {
		return null;
	}

	const lines = reader.lineBoxes(neighbor.id);
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

function listBlockIds(reader: GeometryReader): readonly string[] {
	if (hasBlockIds(reader)) {
		return reader.blockIds();
	}
	return [];
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
