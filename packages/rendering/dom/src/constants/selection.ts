/**
 * T3, D5: a text range over more than this many blocks skips contenteditable
 * expansion (surface mode `block`) and is one of the two declared S2
 * exceptions (`block-surface-range`, `spec/rules/selection.md` S2). The
 * overlay's O3 outline limit matches it on purpose.
 */
export const BLOCK_SURFACE_MODE_THRESHOLD = 50;
