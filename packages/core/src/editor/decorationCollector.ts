import type {
	ChangeSummary,
	Decoration,
	DecorationSet,
	DecorationUpdateScope,
	DiagnosticEvent,
	Editor,
	OpOrigin,
} from "@input/pen-types";

import {
	decorationsFacet,
	isScopedDecorationSource,
	type DecorationSource,
	type ScopedDecorationSource,
} from "../facets/coreFacets";
import { summaryRemovedBlockIds } from "../changes/affectedBlocks";
import {
	decorationSetFromIndex,
	decorationsListEqual,
	emptyDecorationSet,
} from "./decorations";

/**
 * Why decorations are being recomputed. `full` (first collection, or a
 * changed source list) recomputes every source over every block. `functions`
 * (an argument-less `requestDecorationUpdate()`) recomputes function-form and
 * static sources only: a scoped source names its own blocks, so an unrelated
 * request does not make it re-read the document (SCALE2).
 */
export type DecorationTrigger =
	| { readonly kind: "full" }
	| { readonly kind: "functions" }
	| {
			readonly kind: "commit";
			readonly summary: ChangeSummary;
			readonly origin: OpOrigin;
	  }
	| { readonly kind: "scope"; readonly scope: DecorationUpdateScope };

export interface DecorationRefresh {
	readonly set: DecorationSet;
	/** Blocks whose merged decoration list changed identity. */
	readonly changedBlockIds: readonly string[];
}

type BlockLists = Map<string, readonly Decoration[]>;

const NO_CHANGE: readonly string[] = Object.freeze([]);

/**
 * Collects `decorationsFacet` sources into one set (SCALE2). Each source keeps
 * its own per-block lists. A scoped source recomputes only the blocks it
 * declares interest in; a function-form or static source is recomputed in
 * full, as before. Only blocks some source touched are re-merged, in facet
 * order (R1); every other block keeps its list by identity, and when no list
 * changed the previous set, and its generation, are kept.
 */
export class DecorationCollector {
	private _sources: readonly DecorationSource[] = [];
	private readonly _lists = new Map<DecorationSource, BlockLists>();
	private _set: DecorationSet = emptyDecorationSet();

	constructor(
		private readonly _editor: Editor,
		private readonly _emitDiagnostic: (event: DiagnosticEvent) => void,
	) {}

	/** Drops every source's lists (`editor.destroy()`, through the editor context). */
	// fallow-ignore-next-line unused-class-member
	clear(): void {
		this._sources = [];
		this._lists.clear();
		this._set = emptyDecorationSet();
	}

	refresh(trigger: DecorationTrigger): DecorationRefresh {
		const sources = this._editor.facet(decorationsFacet);
		const touched = new Set<string>();
		const effective = this._syncSources(sources, touched) ? { kind: "full" as const } : trigger;
		if (effective.kind === "commit") {
			this._dropRemovedBlocks(effective.summary, touched);
		}
		for (const source of sources) {
			this._refreshSource(source, effective, touched);
		}
		return this._merge(touched);
	}

	/** Returns true when the source list changed, which forces a full pass. */
	private _syncSources(sources: readonly DecorationSource[], touched: Set<string>): boolean {
		if (sameSources(sources, this._sources)) return false;
		const kept = new Set(sources);
		for (const [source, lists] of this._lists) {
			if (kept.has(source)) continue;
			for (const blockId of lists.keys()) touched.add(blockId);
			this._lists.delete(source);
		}
		this._sources = sources;
		return true;
	}

	private _dropRemovedBlocks(summary: ChangeSummary, touched: Set<string>): void {
		for (const removed of summaryRemovedBlockIds(summary)) {
			for (const lists of this._lists.values()) {
				if (lists.delete(removed)) touched.add(removed);
			}
		}
	}

	private _refreshSource(
		source: DecorationSource,
		trigger: DecorationTrigger,
		touched: Set<string>,
	): void {
		if (isScopedDecorationSource(source)) {
			const ids = this._scopedIds(source, trigger);
			if (ids !== null) this._refreshScoped(source, ids, touched, removedBlockIds(trigger));
			return;
		}
		// A function or static source is recomputed on everything but a scoped request.
		if (trigger.kind === "scope") return;
		this._replaceLists(source, groupByBlock(this._readWhole(source)), touched);
	}

	private _scopedIds(
		source: ScopedDecorationSource,
		trigger: DecorationTrigger,
	): readonly string[] | "all" | null {
		switch (trigger.kind) {
			case "full":
				return "all";
			case "functions":
				return null;
			case "scope": {
				const { scope } = trigger;
				return scope.source === undefined || scope.source === source ? scope.blockIds : null;
			}
			case "commit":
				return this._interest(source, trigger.summary, trigger.origin);
			default: {
				const unhandled: never = trigger;
				return unhandled;
			}
		}
	}

	private _interest(
		source: ScopedDecorationSource,
		summary: ChangeSummary,
		origin: OpOrigin,
	): readonly string[] | "all" | null {
		if (!source.interest) return summary.affectedBlockIds;
		try {
			return source.interest({ summary, origin });
		} catch (error) {
			this._reportThrow(error);
			return null;
		}
	}

	private _refreshScoped(
		source: ScopedDecorationSource,
		ids: readonly string[] | "all",
		touched: Set<string>,
		removed: ReadonlySet<string>,
	): void {
		const all = ids === "all";
		// A removed block's stored map can outlive it (a `children`-array
		// descendant of a deleted block), so a source must not re-read it.
		const blockIds = all
			? this._editor.documentState.preorderBlockIds()
			: removed.size > 0
				? ids.filter((blockId) => !removed.has(blockId))
				: ids;
		if (blockIds.length === 0) {
			if (all) this._replaceLists(source, new Map(), touched);
			return;
		}
		const grouped = groupByBlock(this._decorate(source, blockIds));
		this._dropOutOfScope(grouped, blockIds);
		if (all) {
			this._replaceLists(source, grouped, touched);
			return;
		}
		const lists = this._listsFor(source);
		for (const blockId of blockIds) {
			const next = grouped.get(blockId);
			if (next) lists.set(blockId, next);
			else lists.delete(blockId);
			touched.add(blockId);
		}
	}

	private _decorate(source: ScopedDecorationSource, blockIds: readonly string[]): readonly Decoration[] {
		try {
			return source.decorate(blockIds, this._editor);
		} catch (error) {
			this._reportThrow(error);
			return [];
		}
	}

	private _dropOutOfScope(grouped: BlockLists, blockIds: readonly string[]): void {
		if (grouped.size === 0) return;
		const scope = new Set(blockIds);
		const outside = [...grouped.keys()].filter((blockId) => !scope.has(blockId));
		if (outside.length === 0) return;
		for (const blockId of outside) grouped.delete(blockId);
		this._emitDiagnostic({
			code: "decoration-out-of-scope",
			level: "warn",
			source: "extension",
			message: `A scoped decoration source returned decorations for blocks it was not asked for: ${outside.join(", ")}`,
			remediation:
				"Return decorations only for the block ids passed to `decorate(blockIds)`; " +
				"widen `interest` to name any other block that needs recomputing.",
		});
	}

	private _readWhole(source: Exclude<DecorationSource, ScopedDecorationSource>): readonly Decoration[] {
		try {
			const set =
				typeof source === "function"
					? source(this._editor.documentState, this._editor)
					: source;
			return set?.decorations ?? [];
		} catch (error) {
			this._reportThrow(error);
			return [];
		}
	}

	private _replaceLists(source: DecorationSource, next: BlockLists, touched: Set<string>): void {
		const previous = this._lists.get(source);
		if (previous) for (const blockId of previous.keys()) touched.add(blockId);
		for (const blockId of next.keys()) touched.add(blockId);
		this._lists.set(source, next);
	}

	private _listsFor(source: DecorationSource): BlockLists {
		let lists = this._lists.get(source);
		if (!lists) {
			lists = new Map();
			this._lists.set(source, lists);
		}
		return lists;
	}

	/** Re-merges only `touched` blocks, in facet order, keeping unchanged lists. */
	private _merge(touched: ReadonlySet<string>): DecorationRefresh {
		const previous = this._set;
		const changed: string[] = [];
		const updates = new Map<string, readonly Decoration[] | null>();
		for (const blockId of touched) {
			const merged = this._mergedFor(blockId);
			const before = previous.forBlock(blockId);
			if (decorationsListEqual(before, merged)) continue;
			updates.set(blockId, merged.length === 0 ? null : merged);
			changed.push(blockId);
		}
		if (changed.length === 0) return { set: previous, changedBlockIds: NO_CHANGE };
		const index = new Map(blockIndexOf(previous)) as Map<string, Decoration[]>;
		for (const [blockId, list] of updates) {
			if (list === null) index.delete(blockId);
			else index.set(blockId, list as Decoration[]);
		}
		this._set = decorationSetFromIndex(index);
		return { set: this._set, changedBlockIds: changed };
	}

	private _mergedFor(blockId: string): readonly Decoration[] {
		const parts: (readonly Decoration[])[] = [];
		for (const source of this._sources) {
			const list = this._lists.get(source)?.get(blockId);
			if (list && list.length > 0) parts.push(list);
		}
		if (parts.length === 0) return [];
		return parts.length === 1 ? (parts[0] as readonly Decoration[]) : parts.flat();
	}

	private _reportThrow(error: unknown): void {
		this._emitDiagnostic({
			code: "PEN_EXT_003",
			level: "error",
			source: "extension",
			message: "A decorations facet source threw",
			remediation:
				"Fix the decorations facet provider to return a valid decoration set " +
				"for the current document state.",
			error,
		});
	}
}

function sameSources(
	left: readonly DecorationSource[],
	right: readonly DecorationSource[],
): boolean {
	return left.length === right.length && left.every((source, index) => source === right[index]);
}

function groupByBlock(decorations: readonly Decoration[]): BlockLists {
	const grouped = new Map<string, Decoration[]>();
	for (const decoration of decorations) {
		let list = grouped.get(decoration.blockId);
		if (!list) {
			list = [];
			grouped.set(decoration.blockId, list);
		}
		list.push(decoration);
	}
	return grouped;
}

function blockIndexOf(set: DecorationSet): ReadonlyMap<string, readonly Decoration[]> {
	const index = (set as { blockIndex?: ReadonlyMap<string, readonly Decoration[]> }).blockIndex;
	return index ?? groupByBlock(set.decorations);
}

const NO_REMOVED: ReadonlySet<string> = new Set();

/** Blocks a commit removed; a scoped source never re-reads them. */
function removedBlockIds(trigger: DecorationTrigger): ReadonlySet<string> {
	if (trigger.kind !== "commit") return NO_REMOVED;
	const removed = summaryRemovedBlockIds(trigger.summary);
	return removed.length > 0 ? new Set(removed) : NO_REMOVED;
}
