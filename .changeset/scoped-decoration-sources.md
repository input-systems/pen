---
"@input/pen-types": patch
"@input/pen-core": patch
---

Add scoped decoration sources (SCALE2). `scopedDecorationSource({ interest, decorate })` is a `decorationsFacet` source that declares, per commit, which blocks to recompute: the commit's affected blocks by default, none, or all. It is called with exactly those blocks, and a source with no interest in a commit is not called. Only blocks some source touched are re-merged, in facet order; other blocks keep their decoration list by identity, and the set and its generation are kept when nothing changed. `decorationsChange` now passes `(generation, changedBlockIds)` and fires only on a change. `editor.requestDecorationUpdate({ source?, blockIds })` recomputes scoped sources for named blocks; with no argument it recomputes everything, as before. Decorations a scoped source returns for blocks it was not asked about are dropped with a `decoration-out-of-scope` diagnostic. The unexported `DecorationScopeProvider` and `recomputeDecorations` are removed. The new `pen/no-unscoped-decoration-source` lint rule reports function-form sources outside `scripts/unscoped-decoration-source-allowlist.json`.

Breaking: no
