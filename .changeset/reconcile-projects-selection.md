---
"@input/pen-dom": minor
"@input/pen-react": patch
"@input/pen-vue": patch
---

A reconcile no longer saves and restores the native selection. `saveSelection`, `restoreSelection` and `SavedSelection` are removed from `@input/pen-dom/field-editor` and `@input/pen-dom/field-editor/reconciler`, and `fullReconcileToDOM` / `fullReconcileDeltasToDOM` drop the `preserveSelection` option. Code that rebuilds a block calls the field editor's new `projectAfterRebuild(blockIds)`, which projects the selection authority in the same turn when a rebuilt block is the projection target (P3), and does nothing while a native control outside the field owns focus (HOST9). The deferred divergence projection that followed an unpreserved reconcile is gone. Table-cell caret restores now go through the selection projector.

Breaking: yes
