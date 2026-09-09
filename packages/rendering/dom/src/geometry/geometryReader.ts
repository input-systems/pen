import {
	attachBidiRunsToLines,
	caretRectAtBidiBoundary,
	rangeRectsFromLineBoxes,
} from "./bidiRunGeometry";
import {
	measureBlockRect,
	measureCaretRect,
	measureRangeRects,
	measureRangeSlice,
} from "./geometryMeasure";
import { listDomBlockIds, measurePointAt } from "./geometryHitTest";
import { measureLineBoxes } from "./lineBoxMeasure";
import type { Affinity, GeometryReader, LineBox, Point, Rect } from "./types";

export type { Affinity, GeometryReader, LineBox, Point, Rect } from "./types";
export { verticalCaretTarget } from "./verticalCaretTarget";
export type {
	VerticalCaretTarget,
	VerticalDirection,
} from "./verticalCaretTarget";

export type GeometryMeasureAdapter = {
	caretRect?(point: Point, affinity: Affinity): Rect | null;
	rangeRects?(range: { anchor: Point; focus: Point }): readonly Rect[];
	lineBoxes?(blockId: string): readonly LineBox[];
	pointAt?(x: number, y: number): Point | null;
	blockRect?(blockId: string): Rect | null;
	blockIds?(): readonly string[];
};

export type GeometryReaderOptions = {
	root: HTMLElement;
	/** Last document commit id; per-block ids override this in the G2 key. */
	commitId?: number;
	getBlockCommitId?: (blockId: string) => number;
	measure?: GeometryMeasureAdapter;
	observeResize?: boolean;
	observeFonts?: boolean;
	observeScroll?: boolean;
};

export type GeometryReaderHost = GeometryReader & {
	setCommitId(commitId: number): void;
	setBlockCommitId(blockId: string, commitId: number): void;
	/** Read-phase invalidation: drop named blocks, plus any cached neighbor whose live box moved. */
	invalidateBlocks(blockIds: readonly string[], commitId?: number): void;
	invalidateAll(): void;
	bumpResizeGeneration(): void;
	bumpFontGeneration(): void;
	bumpScrollGeneration(): void;
	blockIds(): readonly string[];
	dispose(): void;
};

type BlockCacheKey = {
	commitId: number;
	resizeGeneration: number;
	fontGeneration: number;
	scrollGeneration: number;
};

type BlockCacheEntry = {
	key: BlockCacheKey;
	lineBoxes?: readonly LineBox[];
	/** live box at measure time; the per-read validity probe, not a cached value */
	blockRect: Rect | null;
	caretRects: Map<string, Rect | null>;
	rangeRects: Map<string, readonly Rect[]>;
};

/**
 * Standalone GeometryReader. Not wired to DomScheduler or overlays.
 */
export function createGeometryReader(
	options: GeometryReaderOptions,
): GeometryReaderHost {
	return new GeometryReaderImpl(options);
}

class GeometryReaderImpl implements GeometryReaderHost {
	private readonly root: HTMLElement;
	private readonly getBlockCommitId?: (blockId: string) => number;
	private readonly measure?: GeometryMeasureAdapter;
	private readonly cache = new Map<string, BlockCacheEntry>();
	private readonly blockCommitIds = new Map<string, number>();
	private readonly resizeObserver: ResizeObserver | null = null;
	private readonly detachScroll: (() => void) | null = null;
	private commitId: number;
	private resizeGeneration = 0;
	private fontGeneration = 0;
	private scrollGeneration = 0;
	private _generation = 0;
	private disposed = false;

	constructor(options: GeometryReaderOptions) {
		this.root = options.root;
		this.commitId = options.commitId ?? 0;
		this.getBlockCommitId = options.getBlockCommitId;
		this.measure = options.measure;

		const observeResize = options.observeResize ?? true;
		if (observeResize && typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(() => {
				if (!this.disposed) {
					this.bumpResizeGeneration();
				}
			});
			this.resizeObserver.observe(this.root);
		}

		const observeFonts = options.observeFonts ?? true;
		const fonts = this.root.ownerDocument.fonts;
		if (observeFonts && fonts?.ready) {
			void fonts.ready.then(() => {
				if (!this.disposed) {
					this.bumpFontGeneration();
				}
			});
		}

		const observeScroll = options.observeScroll ?? true;
		if (observeScroll) {
			this.detachScroll = this.listenForScroll();
		}
	}

	get generation(): number {
		return this._generation;
	}

	caretRect(point: Point, affinity: Affinity): Rect | null {
		const entry = this.entryFor(point.blockId);
		const cacheKey = `${point.offset}:${affinity}`;
		if (entry.caretRects.has(cacheKey)) {
			return entry.caretRects.get(cacheKey) ?? null;
		}
		if (this.measure?.caretRect) {
			const rect = this.measure.caretRect(point, affinity);
			entry.caretRects.set(cacheKey, rect);
			return rect;
		}
		const fromRuns = caretRectAtBidiBoundary(
			this.lineBoxes(point.blockId),
			point.offset,
			affinity,
		);
		const rect = fromRuns ?? measureCaretRect(this.root, point, affinity);
		entry.caretRects.set(cacheKey, rect);
		return rect;
	}

	rangeRects(range: { anchor: Point; focus: Point }): readonly Rect[] {
		if (range.anchor.blockId !== range.focus.blockId) {
			return this.measure?.rangeRects
				? this.measure.rangeRects(range)
				: measureRangeRects(this.root, range);
		}
		const entry = this.entryFor(range.anchor.blockId);
		const cacheKey = `${range.anchor.offset}>${range.focus.offset}`;
		const cached = entry.rangeRects.get(cacheKey);
		if (cached) {
			return cached;
		}
		if (this.measure?.rangeRects) {
			const rects = this.measure.rangeRects(range);
			entry.rangeRects.set(cacheKey, rects);
			return rects;
		}
		const rects = rangeRectsFromLineBoxes(
			this.lineBoxes(range.anchor.blockId),
			range.anchor.offset,
			range.focus.offset,
			(start, end) =>
				measureRangeSlice(this.root, range.anchor.blockId, start, end),
		);
		entry.rangeRects.set(cacheKey, rects);
		return rects;
	}

	lineBoxes(blockId: string): readonly LineBox[] {
		const entry = this.entryFor(blockId);
		if (entry.lineBoxes) {
			return entry.lineBoxes;
		}
		const boxes = this.measure?.lineBoxes
			? this.measure.lineBoxes(blockId)
			: measureLineBoxes(this.root, blockId);
		entry.lineBoxes = boxes;
		return boxes;
	}

	pointAt(x: number, y: number): Point | null {
		if (this.measure?.pointAt) {
			return this.measure.pointAt(x, y);
		}
		return measurePointAt(this.root, x, y);
	}

	blockRect(blockId: string): Rect | null {
		return this.entryFor(blockId).blockRect;
	}

	blockIds(): readonly string[] {
		if (this.measure?.blockIds) {
			return this.measure.blockIds();
		}
		return listDomBlockIds(this.root);
	}

	setCommitId(commitId: number): void {
		if (this.commitId === commitId) {
			return;
		}
		this.commitId = commitId;
		this.clearCache();
	}

	setBlockCommitId(blockId: string, commitId: number): void {
		if (this.blockCommitIds.get(blockId) === commitId) {
			return;
		}
		this.blockCommitIds.set(blockId, commitId);
		this.cache.delete(blockId);
		this._generation += 1;
	}

	invalidateBlocks(blockIds: readonly string[], commitId?: number): void {
		// Drop named blocks always, and any other cached block whose live
		// box no longer matches the one recorded at last measure.
		const named = new Set(blockIds);
		for (const blockId of named) {
			if (commitId !== undefined) {
				this.blockCommitIds.set(blockId, commitId);
			}
			this.cache.delete(blockId);
		}
		for (const [blockId, entry] of this.cache) {
			if (!boxStillValid(entry.blockRect, this.liveBlockRect(blockId))) {
				this.cache.delete(blockId);
			}
		}
		this._generation += 1;
	}

	invalidateAll(): void {
		this.clearCache();
	}

	bumpResizeGeneration(): void {
		this.resizeGeneration += 1;
		this.clearCache();
	}

	bumpFontGeneration(): void {
		this.fontGeneration += 1;
		this.clearCache();
	}

	bumpScrollGeneration(): void {
		this.scrollGeneration += 1;
		this.clearCache();
	}

	dispose(): void {
		this.disposed = true;
		this.resizeObserver?.disconnect();
		this.detachScroll?.();
		this.cache.clear();
	}

	/**
	 * Cached rects are viewport-relative, so any scroll that moves the root
	 * invalidates them (G2). `scroll` does not bubble; capture on the document
	 * is the only listener that sees every scroller, including nested ones.
	 *
	 * The document outlives the root and nothing calls `dispose()` in
	 * production (FIELD-EDITOR-TEARDOWN.md), so the listener drops itself once
	 * the root leaves the tree rather than pinning it here forever. A root that
	 * came back would be re-measured off the ResizeObserver anyway.
	 */
	private listenForScroll(): () => void {
		const ownerDocument = this.root.ownerDocument;
		const handleScroll = (event: Event): void => {
			if (this.disposed || !this.root.isConnected) {
				ownerDocument.removeEventListener("scroll", handleScroll, true);
				return;
			}
			if (!this.movesRoot(event.target)) {
				return;
			}
			this.bumpScrollGeneration();
		};
		ownerDocument.addEventListener("scroll", handleScroll, true);
		return () => {
			ownerDocument.removeEventListener("scroll", handleScroll, true);
		};
	}

	private movesRoot(target: EventTarget | null): boolean {
		if (!(target instanceof Node)) {
			return true;
		}
		return target.contains(this.root) || this.root.contains(target);
	}

	/**
	 * Cached rects are viewport-relative, and the generations only see what
	 * resizes the root, loads a font, or scrolls (G2). A layout change outside
	 * the root that moves it without resizing it — a re-centred max-width
	 * column on window resize, a sidebar collapsing, a banner above — bumps
	 * nothing, so a hit is checked against the block's live box before it is
	 * trusted. Every read costs one block `getBoundingClientRect`; the text
	 * range measurements the cache exists for stay cached.
	 */
	private entryFor(blockId: string): BlockCacheEntry {
		const key = this.keyFor(blockId);
		const existing = this.cache.get(blockId);
		const liveBlockRect = this.liveBlockRect(blockId);
		if (
			existing &&
			cacheKeysEqual(existing.key, key) &&
			boxStillValid(existing.blockRect, liveBlockRect)
		) {
			return existing;
		}
		if (existing) {
			this._generation += 1;
		}
		const next: BlockCacheEntry = {
			key,
			caretRects: new Map(),
			rangeRects: new Map(),
			blockRect: liveBlockRect,
		};
		this.cache.set(blockId, next);
		return next;
	}

	private liveBlockRect(blockId: string): Rect | null {
		return this.measure?.blockRect
			? this.measure.blockRect(blockId)
			: measureBlockRect(this.root, blockId);
	}

	private keyFor(blockId: string): BlockCacheKey {
		return {
			commitId:
				this.blockCommitIds.get(blockId) ??
				this.getBlockCommitId?.(blockId) ??
				this.commitId,
			resizeGeneration: this.resizeGeneration,
			fontGeneration: this.fontGeneration,
			scrollGeneration: this.scrollGeneration,
		};
	}

	private clearCache(): void {
		this.cache.clear();
		this._generation += 1;
	}
}

function cacheKeysEqual(left: BlockCacheKey, right: BlockCacheKey): boolean {
	return (
		left.commitId === right.commitId &&
		left.resizeGeneration === right.resizeGeneration &&
		left.fontGeneration === right.fontGeneration &&
		left.scrollGeneration === right.scrollGeneration
	);
}

function boxStillValid(cached: Rect | null, live: Rect | null): boolean {
	if (cached == null || live == null) {
		return cached == null && live == null;
	}
	return (
		cached.left === live.left &&
		cached.top === live.top &&
		cached.width === live.width &&
		cached.height === live.height
	);
}
