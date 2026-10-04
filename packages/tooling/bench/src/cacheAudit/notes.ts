import type { CacheId } from "./caches";

/**
 * Reading notes rendered into CACHE-AUDIT.md. Qualitative on purpose: they
 * explain why rows look the way they do, so they hold across re-runs.
 */
export const CACHE_AUDIT_FINDINGS: readonly string[] = [
	"The clocks come from a shared, loaded machine (see the load average above), so medians carry contention; the interleaving keeps the incremental/naive comparison fair, the min column is the closest to a quiet-machine number, and the counts are durable.",
	"The incremental structural commit is itself O(document) at 10k and 50k: the summary block index re-walks the document (reusing only text lengths), the normalization pass index and `documentState` rebuild after any root-order change, and the notifier and decoration paths sort or scan sibling lists. Those passes are what the structural `Op ms incr` column measures; they are outside the caches' saving and are a separate target from Phase 2.",
	"`Component ms` is the decision input: the time inside the cache's consumer only. `Op ms` adds everything else the operation does, which at 10k and above is dominated by the passes above.",
];

export const CACHE_AUDIT_NOTES: Readonly<Partial<Record<CacheId, string>>> = {
	A: "`incrementalUpdate` already calls `rebuild()` when the root order's length changes (insert-block, delete-block, split) and when a root block's position moves (move-block), so the structural rows are equal by construction. The index pays on text commits and on edits inside `children` arrays: the keystroke row is the deciding one.",
	B: "A structural commit already rebuilds the index shape from the document; the cache only reuses text lengths there, and advances lengths in place on a text commit. Naive `Op ms` includes the discarded reuse build. Touched-id scoping (`summaryTouchedBlockIds`) is the input C–F scope by; its naive cost is in their rows.",
	C: "List work runs only on structural commits, so keystroke and caret move rows are the same both ways. The per-block fan-out (rebuild and notify only the blocks an event names) is not toggled here: its naive form rebuilds every subscribed block's snapshot per event, which is O(document) by construction and a SCALE6 rule, not a cache.",
	D: "The stack's decoration sources are the AI review source (suggestion marks per block), the AI presentation source and the search match source. Naive re-decorates every block with every scoped source.",
	E: "`list()` (sorting suggestion-holding blocks by preorder index) runs in both modes and is inside the component clock.",
	F: "The open query matches one block; the naive cost is the per-block scan, not the match count.",
	G: "Every structural commit drops the pass index already (`notifyStructureChanged`), so the structural rows are equal by construction; the index pays on text commits, whose normalization pass would otherwise rebuild it.",
	H: "Measured headlessly: the contributor is DOM-free (OV1), so it runs against the live editor and a field-state stub with no geometry. After a keystroke the kept contributor misses too (the block's revision moved), so only repaints without a selection or structure change hit the caches: geometry, motion and mount repaints with a D5 range or an O3 block selection held. Structural rows are omitted: the range cache is keyed on `documentState.generation`, so every structural commit misses it in both modes. The two parts read differently: the per-block inline-facts cache saves one block read per paint at every size, while the O3 runs cache (block selection above fifty blocks) is the only row near the budget, and it scales with the selection, not the document.",
};
