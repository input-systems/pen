import type { Editor } from "@input/pen-types";

/**
 * Test-only instrument for SCALE2/SCALE6 headless counts: how many reads of
 * the document a piece of work performs. Counts are durable where clocks are
 * not (CH8), so a per-keystroke path that scans the whole document shows up
 * as a count that grows with document size. Never import from runtime code.
 */

/** Reads of the document that scale with document size when done in bulk. */
export interface ScanCounts {
	/** `blockOrder` Y.Array: `get` calls plus elements produced by bulk reads and iteration. */
	readonly blockOrderReads: number;
	/** `blocks` Y.Map: `get` and `has` calls. */
	readonly blocksMapReads: number;
	/** `blocks` Y.Map: elements produced by iteration, plus the map size per `size` read. */
	readonly blocksMapIterations: number;
	/** `Y.Text#toString`, `toDelta`, `toJSON` on block content of this document only. */
	readonly textFullReads: number;
	/** Element reads on `editor.documentState.blockOrder`. */
	readonly orderArrayReads: number;
	/** `documentState.allBlocks()` and `documentState.blocks` traversals started. */
	readonly documentWalks: number;
}

export interface ScanProbe {
	snapshot(): ScanCounts;
	reset(): void;
	/** Performs one known read of each kind and throws if any counter did not move. */
	selfTest(): void;
	/** Restores every patched method and accessor. */
	dispose(): void;
}

type Counter = { -readonly [K in keyof ScanCounts]: number };
type AnyFn = (...args: unknown[]) => unknown;
type Patchable = Record<PropertyKey, unknown>;

const EMPTY: ScanCounts = {
	blockOrderReads: 0,
	blocksMapReads: 0,
	blocksMapIterations: 0,
	textFullReads: 0,
	orderArrayReads: 0,
	documentWalks: 0,
};

const ORDER_BULK = ["toArray", "toJSON", "slice", "map"] as const;
const MAP_ITERATORS = ["entries", "keys", "values"] as const;
const TEXT_READS = ["toString", "toDelta", "toJSON"] as const;

function lengthOf(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

/** Wraps an iterator so each produced element counts once. */
function countingIterator<T>(iterator: Iterator<T>, onElement: () => void): IterableIterator<T> {
	return {
		next() {
			const result = iterator.next();
			if (!result.done) onElement();
			return result;
		},
		[Symbol.iterator]() {
			return this;
		},
	};
}

class Patches {
	private readonly restores: Array<() => void> = [];

	/** Shadows `key` on `target` with an own property; restore deletes it. */
	own(target: object, key: PropertyKey, descriptor: PropertyDescriptor): void {
		Object.defineProperty(target, key, { configurable: true, ...descriptor });
		this.restores.push(() => {
			delete (target as Patchable)[key];
		});
	}

	/** Replaces `key` on a shared prototype; restore puts the original back. */
	prototype(target: Patchable, key: PropertyKey, wrap: (original: AnyFn) => AnyFn): void {
		const original = target[key] as AnyFn;
		target[key] = wrap(original);
		this.restores.push(() => {
			target[key] = original;
		});
	}

	restoreAll(): void {
		for (const restore of this.restores.splice(0).reverse()) restore();
	}
}

function patchBlockOrder(patches: Patches, blockOrder: Patchable, counts: Counter): void {
	const call = (key: PropertyKey) => (blockOrder[key] as AnyFn).bind(blockOrder);
	const get = call("get");
	patches.own(blockOrder, "get", {
		value: (index: number) => {
			counts.blockOrderReads += 1;
			return get(index);
		},
	});
	for (const key of ORDER_BULK) {
		const original = call(key);
		patches.own(blockOrder, key, {
			value: (...args: unknown[]) => {
				const result = original(...args);
				counts.blockOrderReads += lengthOf(result);
				return result;
			},
		});
	}
	const forEach = call("forEach");
	patches.own(blockOrder, "forEach", {
		value: (callback: AnyFn) =>
			forEach((...args: unknown[]) => {
				counts.blockOrderReads += 1;
				return callback(...args);
			}),
	});
	const iterate = call(Symbol.iterator);
	patches.own(blockOrder, Symbol.iterator, {
		value: () => countingIterator(iterate() as Iterator<unknown>, () => (counts.blockOrderReads += 1)),
	});
}

function patchBlocksMap(patches: Patches, blocks: Patchable, counts: Counter): void {
	const call = (key: PropertyKey) => (blocks[key] as AnyFn).bind(blocks);
	for (const key of ["get", "has"] as const) {
		const original = call(key);
		patches.own(blocks, key, {
			value: (id: string) => {
				counts.blocksMapReads += 1;
				return original(id);
			},
		});
	}
	const iterate = (onElement: () => void, source: () => unknown) =>
		countingIterator(source() as Iterator<unknown>, onElement);
	for (const key of [...MAP_ITERATORS, Symbol.iterator]) {
		const original = call(key);
		patches.own(blocks, key, {
			value: () => iterate(() => (counts.blocksMapIterations += 1), original),
		});
	}
	const forEach = call("forEach");
	patches.own(blocks, "forEach", {
		value: (callback: AnyFn) =>
			forEach((...args: unknown[]) => {
				counts.blocksMapIterations += 1;
				return callback(...args);
			}),
	});
	const sizeGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(blocks), "size")?.get;
	patches.own(blocks, "size", {
		get: () => {
			const size = sizeGetter?.call(blocks) as number;
			counts.blocksMapIterations += size;
			return size;
		},
	});
}

function patchTextPrototype(patches: Patches, sample: unknown, ydoc: unknown, counts: Counter): void {
	if (sample == null || typeof sample !== "object") return;
	const prototype = Object.getPrototypeOf(sample) as Patchable;
	for (const key of TEXT_READS) {
		patches.prototype(prototype, key, (original) =>
			function (this: { doc?: unknown }, ...args: unknown[]) {
				if (this.doc === ydoc) counts.textFullReads += 1;
				return original.apply(this, args);
			},
		);
	}
}

function patchDocumentState(patches: Patches, editor: Editor, counts: Counter): void {
	const state = editor.documentState as unknown as Patchable;
	const orderGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(state), "blockOrder")?.get;
	const proxies = new WeakMap<object, readonly string[]>();
	patches.own(state, "blockOrder", {
		get: () => {
			const order = orderGetter?.call(state) as readonly string[];
			let proxy = proxies.get(order);
			if (!proxy) {
				proxy = new Proxy(order, {
					get(target, key, receiver) {
						if (typeof key === "string" && /^\d+$/.test(key)) counts.orderArrayReads += 1;
						return Reflect.get(target, key, receiver);
					},
				});
				proxies.set(order, proxy);
			}
			return proxy;
		},
	});
	const allBlocks = (state.allBlocks as AnyFn).bind(state);
	patches.own(state, "allBlocks", {
		value: (...args: unknown[]) => {
			counts.documentWalks += 1;
			return allBlocks(...args);
		},
	});
}

/** Instruments `editor` for scan counting. Never import from runtime code. */
export function createScanProbe(editor: Editor): ScanProbe {
	const counts: Counter = { ...EMPTY };
	const patches = new Patches();
	const doc = editor.internals.doc as unknown as { blockOrder: Patchable; blocks: Patchable };
	const firstId = editor.documentState.blockOrder[0];
	const ydoc = (doc.blockOrder as { doc?: unknown }).doc;
	patchBlockOrder(patches, doc.blockOrder, counts);
	patchBlocksMap(patches, doc.blocks, counts);
	patchTextPrototype(patches, firstId ? editor.internals.getBlockText(firstId) : null, ydoc, counts);
	patchDocumentState(patches, editor, counts);
	// Installing reads the document once (the Y.Text sample); start from zero.
	Object.assign(counts, EMPTY);

	const snapshot = (): ScanCounts => ({ ...counts });
	return {
		snapshot,
		reset() {
			Object.assign(counts, EMPTY);
		},
		selfTest() {
			const before = snapshot();
			const id = editor.documentState.blockOrder[0];
			if (!id) throw new Error("scan probe self-test needs a non-empty document");
			(doc.blockOrder.get as AnyFn)(0);
			(doc.blocks.get as AnyFn)(id);
			void doc.blocks.size;
			String(editor.internals.getBlockText(id));
			for (const _block of editor.documentState.allBlocks()) break;
			const after = snapshot();
			const stuck = (Object.keys(EMPTY) as (keyof ScanCounts)[]).filter(
				(key) => after[key] <= before[key],
			);
			Object.assign(counts, before);
			if (stuck.length > 0) {
				throw new Error(`scan probe is miswired; counters did not move: ${stuck.join(", ")}`);
			}
		},
		dispose() {
			patches.restoreAll();
		},
	};
}
