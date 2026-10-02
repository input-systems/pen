---
"@input/pen-dom": patch
---

The field editor exposes a per-block notifier, `fieldEditor.blockNotifier` (types on `./field-editor/store`), for renderers (SCALE6). It holds one subscription each on the editor's commit, selection and decoration events, the field-editor store and the inline completion controller, and fans them out by block id to per-block snapshots whose slices keep their identity while unchanged. A text commit notifies only the edited block, and a caret move only the blocks it entered or left. `notifyDomReconciled(blockId)` now bumps that block's own DOM-sync version as well as the global one. Geometry invalidation no longer measures every cached block on each flush; a block that moved without being named is re-measured on the read that finds it (G2). The empty-document placeholder lookup stops at the second content block.

Breaking: no
