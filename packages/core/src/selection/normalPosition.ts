/**
 * N1–N3 normal caret positions (`spec/rules/selection.md` §3).
 *
 * Pure functions over a fake doc snapshot. Not wired to the
 * manager, commands, or reader.
 */

import type { Point } from "@input/pen-types";
import {
	nextGraphemeBoundary,
	previousGraphemeBoundary,
} from "../editor/textSegmentation";

/** UAX #29 grapheme clusters; locale does not change the boundaries. */
const GRAPHEME_LOCALE = "und";

export type NormalPositionDirection = -1 | 1;

export type { Point };

export interface BlockBoundary {
	readonly blockBoundary: string;
}

export type NextNormalPositionResult = Point | BlockBoundary | null;

export interface AtomExtent {
	readonly start: number;
	readonly end: number;
}

export type NormalPositionBlockKind = "text" | "structural";

export interface NormalPositionBlock {
	readonly kind: NormalPositionBlockKind;
	readonly text: string;
	readonly atoms?: readonly AtomExtent[];
}

/**
 * A document-shaped view sufficient to decide whether a point is a normal position.
 *
 * Deliberately not the live document: normal-position checks run on the DOM read
 * path, and walking the CRDT there couples reading to document mutation. Build one
 * with `buildNormalPositionSnapshot`.
 */
export interface NormalPositionSnapshot {
	readonly blockOrder: readonly string[];
	readonly blocks: Readonly<Record<string, NormalPositionBlock>>;
	/**
	 * Whether `blockId` is in `blockOrder`, answered without materialising it.
	 * A lazy snapshot provides it so a per-keystroke check reads O(1) blocks
	 * (SCALE2); without it, `blockOrder.includes` is used.
	 */
	readonly has?: (blockId: string) => boolean;
}

export function isNormalPosition(
	doc: NormalPositionSnapshot,
	point: Point,
): boolean {
	const block = resolveTextBlock(doc, point.blockId);
	if (!block) {
		return false;
	}
	if (point.offset < 0 || point.offset > block.text.length) {
		return false;
	}
	return atomContaining(block, point.offset) === null;
}

/**
 * Snap a point onto a normal position without stepping.
 * Interior atom offsets go to the start (`-1`) or end (`1`).
 * Non-text blocks yield `{ blockBoundary }` (N2).
 */
export function snapToNormalPosition(
	doc: NormalPositionSnapshot,
	point: Point,
	direction: NormalPositionDirection,
): NextNormalPositionResult {
	const resolved = resolveBlock(doc, point.blockId);
	if (resolved === null) {
		return null;
	}
	if (resolved === "structural") {
		return { blockBoundary: point.blockId };
	}

	const offset = clampOffset(resolved.text.length, point.offset);
	const atom = atomContaining(resolved, offset);
	if (!atom) {
		return { blockId: point.blockId, offset };
	}

	switch (direction) {
		case 1:
			return { blockId: point.blockId, offset: atom.end };
		case -1:
			return { blockId: point.blockId, offset: atom.start };
		default: {
			const _exhaustive: never = direction;
			return _exhaustive;
		}
	}
}

export function nextNormalPosition(
	doc: NormalPositionSnapshot,
	point: Point,
	direction: NormalPositionDirection,
): NextNormalPositionResult {
	const resolved = resolveBlock(doc, point.blockId);
	if (resolved === null) {
		return null;
	}
	if (resolved === "structural") {
		return { blockBoundary: point.blockId };
	}

	switch (direction) {
		case 1:
			return stepForward(point.blockId, resolved, point.offset);
		case -1:
			return stepBackward(point.blockId, resolved, point.offset);
		default: {
			const _exhaustive: never = direction;
			return _exhaustive;
		}
	}
}

function resolveBlock(
	doc: NormalPositionSnapshot,
	blockId: string,
): NormalPositionBlock | "structural" | null {
	if (!(doc.has ? doc.has(blockId) : doc.blockOrder.includes(blockId))) {
		return null;
	}
	const block = doc.blocks[blockId];
	if (!block) {
		return null;
	}
	if (block.kind === "structural") {
		return "structural";
	}
	return block;
}

function resolveTextBlock(
	doc: NormalPositionSnapshot,
	blockId: string,
): NormalPositionBlock | null {
	const resolved = resolveBlock(doc, blockId);
	if (resolved === null || resolved === "structural") {
		return null;
	}
	return resolved;
}

function stepForward(
	blockId: string,
	block: NormalPositionBlock,
	offset: number,
): NextNormalPositionResult {
	const clamped = clampOffset(block.text.length, offset);
	if (atomContaining(block, clamped)) {
		return {
			blockId,
			offset: skipAtomInterior(block, clamped, 1),
		};
	}
	if (clamped >= block.text.length) {
		return { blockBoundary: blockId };
	}

	const stepped = skipAtomInterior(
		block,
		nextGraphemeBoundary(block.text, clamped, GRAPHEME_LOCALE),
		1,
	);
	return { blockId, offset: stepped };
}

function stepBackward(
	blockId: string,
	block: NormalPositionBlock,
	offset: number,
): NextNormalPositionResult {
	const clamped = clampOffset(block.text.length, offset);
	if (atomContaining(block, clamped)) {
		return {
			blockId,
			offset: skipAtomInterior(block, clamped, -1),
		};
	}
	if (clamped <= 0) {
		return { blockBoundary: blockId };
	}

	const stepped = skipAtomInterior(
		block,
		previousGraphemeBoundary(block.text, clamped, GRAPHEME_LOCALE),
		-1,
	);
	return { blockId, offset: stepped };
}

function skipAtomInterior(
	block: NormalPositionBlock,
	offset: number,
	direction: NormalPositionDirection,
): number {
	let current = offset;
	for (;;) {
		const atom = atomContaining(block, current);
		if (!atom) {
			return current;
		}
		const next = direction === 1 ? atom.end : atom.start;
		if (next === current) {
			return current;
		}
		current = next;
	}
}

function atomContaining(
	block: NormalPositionBlock,
	offset: number,
): AtomExtent | null {
	for (const atom of block.atoms ?? []) {
		if (offset > atom.start && offset < atom.end) {
			return atom;
		}
	}
	return null;
}

function clampOffset(max: number, offset: number): number {
	if (offset <= 0) {
		return 0;
	}
	if (offset >= max) {
		return max;
	}
	return offset;
}
