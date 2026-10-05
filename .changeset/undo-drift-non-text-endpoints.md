---
"@input/pen-undo": patch
"@input/pen-core": patch
"@input/pen-types": patch
"@input/pen-bench": patch
---

Stop the undo extension from logging `anchor-target-missing` when a text range ends on a divider or table. Undo used to mint its own drift anchors on every selection change, and it did not skip an endpoint with no text the way the selection authority does (AS1). It now reuses the authority's anchors, read through the new `editor.internals.selectionAnchors()`. As a result undo mints no anchors per selection change, which halves the churn that trips the `anchor-budget` diagnostic (AN9) and removes two blocks-map reads from each selection write. Restoring a range that ends on a divider or table uses the stored snapshot.

In bundled builds, the `anchor-budget` diagnostic's `site` now names the code that minted the anchor. Before, it named an internal helper, because frames from the bundle's `dist/index.mjs` don't carry the `anchors.ts` file name.

`bench:caches` now fails on any diagnostic except `anchor-budget`, which churn is allowed to trip (AN9).

Breaking: no
