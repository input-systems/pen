---
"@input/pen-core": patch
---

Make `repairAnchor` read the anchor's position from before the commit even when something resolved the anchor after the commit landed. Before, a resolve made before repair replaced the pre-commit target, so a split could move an anchor to the start of the new block instead of its place in the moved text. An anchor that resolved to `null` before a commit now stays dead instead of being revived from an older position when a block with the same id is split, and a merge now carries an `assoc: -1` anchor at the start of the merged-away block into the target instead of losing it.
