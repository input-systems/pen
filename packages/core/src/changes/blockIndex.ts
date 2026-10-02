import type { BlockTextChange, TextSplice } from "./types";

export interface BlockIndexSnapshot {
	readonly lengthById: ReadonlyMap<string, number>;
	readonly typeById: ReadonlyMap<string, string>;
	readonly parentById: ReadonlyMap<string, string | null>;
	readonly childrenByParentId: ReadonlyMap<string | null, readonly string[]>;
	readonly order: readonly string[];
	readonly roots: readonly string[];
}

export interface BlockIndex {
	snapshot(): BlockIndexSnapshot;
	/**
	 * Advance block lengths for a commit that changed text only. Structural
	 * commits re-read the document through `replace` instead, so the index
	 * still resolves its shape from storage rather than from summary replay.
	 */
	applyTextLengths(blockText: readonly BlockTextChange[]): void;
	/** Takes ownership of a freshly built snapshot; the caller must not keep it. */
	replace(snapshot: BlockIndexSnapshot): void;
}

/** The clone the index holds; `snapshot()` hands it out read-only. */
interface OwnedBlockIndexSnapshot extends BlockIndexSnapshot {
	readonly lengthById: Map<string, number>;
}

export function emptyBlockIndexSnapshot(): BlockIndexSnapshot {
	return {
		lengthById: new Map(),
		typeById: new Map(),
		parentById: new Map(),
		childrenByParentId: new Map([[null, []]]),
		order: [],
		roots: [],
	};
}

export function createBlockIndexSnapshot(input: {
	readonly roots: readonly string[];
	readonly lengthById?:
		| ReadonlyMap<string, number>
		| Readonly<Record<string, number>>;
	readonly typeById?:
		| ReadonlyMap<string, string>
		| Readonly<Record<string, string>>;
	readonly childrenByParentId?: ReadonlyMap<string | null, readonly string[]>;
}): BlockIndexSnapshot {
	const lengthById = toNumberMap(input.lengthById);
	const typeById = toStringMap(input.typeById);
	const childrenByParentId = new Map<string | null, readonly string[]>(
		input.childrenByParentId ?? [[null, input.roots]],
	);
	if (!childrenByParentId.has(null)) {
		childrenByParentId.set(null, input.roots);
	}
	const parentById = new Map<string, string | null>();
	for (const [parentId, children] of childrenByParentId) {
		for (const childId of children) {
			parentById.set(childId, parentId);
		}
	}
	const roots = [...(childrenByParentId.get(null) ?? input.roots)];
	return {
		lengthById,
		typeById,
		parentById,
		childrenByParentId,
		order: flattenOrder(roots, childrenByParentId),
		roots,
	};
}

export function createEmptyBlockIndex(): BlockIndex {
	return createBlockIndex(emptyBlockIndexSnapshot());
}

export function createBlockIndex(initial: BlockIndexSnapshot): BlockIndex {
	let current = cloneSnapshot(initial);
	return {
		snapshot() {
			return current;
		},
		applyTextLengths(blockText) {
			for (const change of blockText) {
				const previous = current.lengthById.get(change.blockId) ?? 0;
				current.lengthById.set(
					change.blockId,
					lengthAfterSplices(previous, change.splices),
				);
			}
		},
		replace(snapshot) {
			// Fresh from createBlockIndexSnapshot, which already built new maps;
			// cloning again would copy every entry a second time.
			current = snapshot as OwnedBlockIndexSnapshot;
		},
	};
}

function lengthAfterSplices(
	length: number,
	splices: readonly TextSplice[],
): number {
	let next = length;
	for (const splice of splices) {
		next += splice.insertLength - (splice.to - splice.from);
	}
	return Math.max(0, next);
}

function cloneSnapshot(
	snapshot: BlockIndexSnapshot,
): OwnedBlockIndexSnapshot {
	return {
		lengthById: new Map(snapshot.lengthById),
		typeById: new Map(snapshot.typeById),
		parentById: new Map(snapshot.parentById),
		childrenByParentId: cloneChildren(snapshot.childrenByParentId),
		order: [...snapshot.order],
		roots: [...snapshot.roots],
	};
}

function flattenOrder(
	roots: readonly string[],
	childrenByParentId: ReadonlyMap<string | null, readonly string[]>,
): string[] {
	const order: string[] = [];
	const visit = (id: string) => {
		order.push(id);
		for (const child of childrenByParentId.get(id) ?? []) {
			visit(child);
		}
	};
	for (const root of roots) visit(root);
	return order;
}

function cloneChildren(
	childrenByParentId: ReadonlyMap<string | null, readonly string[]>,
): Map<string | null, string[]> {
	const next = new Map<string | null, string[]>();
	for (const [parentId, children] of childrenByParentId) {
		next.set(parentId, [...children]);
	}
	return next;
}

function toNumberMap(
	value:
		| ReadonlyMap<string, number>
		| Readonly<Record<string, number>>
		| undefined,
): Map<string, number> {
	if (!value) return new Map();
	if (value instanceof Map) return new Map(value);
	return new Map(Object.entries(value));
}

function toStringMap(
	value:
		| ReadonlyMap<string, string>
		| Readonly<Record<string, string>>
		| undefined,
): Map<string, string> {
	if (!value) return new Map();
	if (value instanceof Map) return new Map(value);
	return new Map(Object.entries(value));
}
