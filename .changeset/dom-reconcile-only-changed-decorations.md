---
"@input/pen-dom": patch
---

`SessionReconciler` compares the decoration set it last saw against the one a `decorationsChange` carries and only rebuilds the active blocks whose own `forBlock` list changed identity. A paced reveal or a suggestion mark landing on another block no longer rebuilds the editing surface and bumps `domSyncVersion` for every block subscriber. Relies on core's stable decoration identity (SCALE2).
