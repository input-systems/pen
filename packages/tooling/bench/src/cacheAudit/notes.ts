import type { CacheId } from "./caches";

/**
 * Reading notes rendered into CACHE-AUDIT.md. Qualitative on purpose: they
 * explain why rows look the way they do, so they hold across re-runs.
 */
export const CACHE_AUDIT_FINDINGS: readonly string[] = [
	"The clocks come from a shared, loaded machine (see the load average above), so medians carry contention; the interleaving keeps the incremental/naive comparison fair, the min column is the closest to a quiet-machine number, and the counts are durable.",
	"Since Phase 2b the four indexes a structural commit used to rebuild advance by what it touched: the summary block index and the normalization pass index by the commit's array deltas and named block maps, `documentState`'s root order and nested preorder by the `blockOrder` delta. What still grows with the document on a structural commit is the block notifier (the root id list it re-reads, `_cachedParentOf` and `_dropUnsubscribed` over every subscribed block, and the sibling-list patch) and, on a delete, normalization Rule 10 (`handleDeletedBlock` reads every block's `parentId`). Those are what the structural `Op ms incr` column measures at 50k.",
	"`Component ms` is the decision input: the time inside the cache's consumer only. `Op ms` adds everything else the operation does, which at 10k and above is dominated by the passes above.",
];

export const CACHE_AUDIT_NOTES: Readonly<Partial<Record<CacheId, string>>> = {
	A: "Each transaction's `blockOrder` delta advances the root order and its lazily re-indexed positions, a removed block leaves the parent and child indexes, a root placed under a `parentId` joins its parent's children, and the nested preorder is patched span by span; naive calls `rebuild()` on every commit, so the structural rows now show the rebuild the index used to pay.",
	B: "A text commit advances lengths in place; a structural commit advances the roots, the touched `children` arrays and the named blocks' types and lengths (`applyStructure`), and replaces the index from the document only for an id listed twice (COL4). Touched-id scoping (`summaryTouchedBlockIds`) is the input C–F scope by; its naive cost is in their rows.",
	C: "List work runs only on structural commits, so keystroke and caret move rows are the same both ways. The per-block fan-out (rebuild and notify only the blocks an event names) is not toggled here: its naive form rebuilds every subscribed block's snapshot per event, which is O(document) by construction and a SCALE6 rule, not a cache.",
	D: "The stack's decoration sources are the AI review source (suggestion marks per block), the AI presentation source and the search match source. Naive re-decorates every block with every scoped source.",
	E: "`list()` (sorting suggestion-holding blocks by preorder index) runs in both modes and is inside the component clock.",
	F: "The open query matches one block; the naive cost is the per-block scan, not the match count.",
	G: "The block executors and the pass's repairs advance the index at each structural write, and a remote or undo commit advances it by its delta, so it survives structural commits; naive drops it before every pass, which also sends the executors' position lookups through a rebuild.",
	H: "Measured headlessly: the contributor is DOM-free (OV1), so it runs against the live editor and a field-state stub with no geometry. After a keystroke the kept contributor misses too (the block's revision moved), so only repaints without a selection or structure change hit the caches: geometry, motion and mount repaints with a D5 range or an O3 block selection held. Structural rows are omitted: the range cache is keyed on `documentState.generation`, so every structural commit misses it in both modes. The two parts read differently: the per-block inline-facts cache saves one block read per paint at every size, while the O3 runs cache (block selection above fifty blocks) is the only row near the budget, and it scales with the selection, not the document.",
};
