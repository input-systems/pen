import type {
	Decoration,
	DecorationSet,
	InlineDecoration,
} from "@input/pen-types";

let nextGeneration = 1;

const EMPTY_ARRAY: readonly Decoration[] = Object.freeze([]);

class DecorationSetImpl implements DecorationSet {
	private _decorations: Decoration[];
	readonly generation: number;
	private readonly _blockIndex: Map<string, Decoration[]>;
	private _released = false;

	constructor(
		decorations: Decoration[],
		generation?: number,
		blockIndex?: Map<string, Decoration[]>,
	) {
		this._decorations = decorations;
		this.generation = generation ?? nextGeneration++;
		this._blockIndex = blockIndex ?? buildBlockIndex(decorations);
	}

	get decorations(): readonly Decoration[] {
		return this._decorations;
	}

	get blockIndex(): ReadonlyMap<string, Decoration[]> {
		return this._blockIndex;
	}

	get isReleased(): boolean {
		return this._released;
	}

	forBlock(blockId: string): readonly Decoration[] {
		return this._blockIndex.get(blockId) ?? EMPTY_ARRAY;
	}

	inlineForBlock(blockId: string): readonly InlineDecoration[] {
		const all = this.forBlock(blockId);
		return all.filter((d): d is InlineDecoration => d.type === "inline");
	}

	equals(other: DecorationSet): boolean {
		return this.generation === other.generation;
	}

	replaceAffected(
		affectedBlocks: readonly string[],
		nextAffected: readonly Decoration[],
	): DecorationSet {
		if (this._released) {
			return createDecorationSet(
				nextAffected.filter((dec) =>
					affectedBlocks.includes(dec.blockId),
				),
			);
		}
		if (affectedBlocks.length === 0) return this;

		const affected = new Set(affectedBlocks);
		const grouped = groupDecorationsByAffectedBlock(nextAffected, affected);

		let changed = false;
		for (const blockId of affected) {
			const nextList = grouped.get(blockId) ?? EMPTY_ARRAY;
			if (!decorationsListEqual(this.forBlock(blockId), nextList)) {
				changed = true;
				break;
			}
		}
		if (!changed) return this;

		const nextIndex = new Map(this._blockIndex);
		const nextFlat: Decoration[] = [];
		for (const [blockId, list] of nextIndex) {
			if (!affected.has(blockId)) {
				nextFlat.push(...list);
			}
		}
		for (const blockId of affected) {
			const list = grouped.get(blockId);
			if (!list || list.length === 0) {
				nextIndex.delete(blockId);
				continue;
			}
			nextIndex.set(blockId, list);
			nextFlat.push(...list);
		}

		if (nextFlat.length === 0) return EMPTY_SET;
		return new DecorationSetImpl(nextFlat, undefined, nextIndex);
	}

	release(): void {
		if (this === EMPTY_SET || this._released) return;
		this._released = true;
		for (const list of this._blockIndex.values()) {
			list.length = 0;
		}
		this._blockIndex.clear();
		this._decorations = [];
	}
}

const EMPTY_SET = new DecorationSetImpl([], 0);

export function createDecorationSet(decorations: Decoration[]): DecorationSet {
	if (decorations.length === 0) return EMPTY_SET;
	return new DecorationSetImpl(decorations);
}

export function emptyDecorationSet(): DecorationSet {
	return EMPTY_SET;
}

export function mergeDecorationSets(...sets: DecorationSet[]): DecorationSet {
	const all: Decoration[] = [];
	for (const set of sets) {
		all.push(...set.decorations);
	}
	if (all.length === 0) return EMPTY_SET;
	return new DecorationSetImpl(all);
}

export function updateDecorationsForAffectedBlocks(
	previous: DecorationSet,
	affectedBlocks: readonly string[],
	nextAffected: readonly Decoration[],
): DecorationSet {
	if (affectedBlocks.length === 0) return previous;
	if (previous instanceof DecorationSetImpl) {
		return previous.replaceAffected(affectedBlocks, nextAffected);
	}
	return createDecorationSet(
		nextAffected.filter((dec) => affectedBlocks.includes(dec.blockId)),
	);
}

/** A set over an already grouped block index, taking ownership of it. */
export function decorationSetFromIndex(
	index: Map<string, Decoration[]>,
): DecorationSet {
	if (index.size === 0) return EMPTY_SET;
	return new DecorationSetImpl([...index.values()].flat(), undefined, index);
}

export function releaseDecorationSet(set: DecorationSet): void {
	if (set instanceof DecorationSetImpl) {
		set.release();
	}
}

function buildBlockIndex(
	decorations: readonly Decoration[],
): Map<string, Decoration[]> {
	const index = new Map<string, Decoration[]>();
	for (const dec of decorations) {
		const key = dec.blockId;
		let list = index.get(key);
		if (!list) {
			list = [];
			index.set(key, list);
		}
		list.push(dec);
	}
	return index;
}

function groupDecorationsByAffectedBlock(
	decorations: readonly Decoration[],
	affected: Set<string>,
): Map<string, Decoration[]> {
	const grouped = new Map<string, Decoration[]>();
	for (const dec of decorations) {
		if (!affected.has(dec.blockId)) continue;
		let list = grouped.get(dec.blockId);
		if (!list) {
			list = [];
			grouped.set(dec.blockId, list);
		}
		list.push(dec);
	}
	return grouped;
}

export function decorationsListEqual(
	left: readonly Decoration[],
	right: readonly Decoration[],
): boolean {
	if (left === right) return true;
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) {
		if (!decorationEqual(left[i]!, right[i]!)) return false;
	}
	return true;
}

function decorationEqual(left: Decoration, right: Decoration): boolean {
	if (left === right) return true;
	if (left.type !== right.type || left.blockId !== right.blockId) {
		return false;
	}
	switch (left.type) {
		case "inline": {
			if (right.type !== "inline") return false;
			return (
				left.from === right.from &&
				left.to === right.to &&
				left.virtualText === right.virtualText &&
				left.virtualPlacement === right.virtualPlacement &&
				left.omitFromRender === right.omitFromRender &&
				left.key === right.key &&
				attributesEqual(left.attributes, right.attributes)
			);
		}
		case "block": {
			if (right.type !== "block") return false;
			return (
				left.position === right.position &&
				attributesEqual(left.attributes, right.attributes)
			);
		}
		case "app": {
			if (right.type !== "app") return false;
			return (
				left.offset === right.offset &&
				left.component === right.component &&
				left.key === right.key
			);
		}
		default: {
			const _exhaustive: never = left;
			return _exhaustive;
		}
	}
}

function attributesEqual(
	left: Record<string, string | number | boolean>,
	right: Record<string, string | number | boolean>,
): boolean {
	if (left === right) return true;
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) return false;
	for (const key of leftKeys) {
		if (left[key] !== right[key]) return false;
	}
	return true;
}
