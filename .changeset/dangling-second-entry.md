---
"@input/pen-core": patch
---

Report a second order entry for a deleted block as removed, not moved. When peers move a block another peer deleted, each move re-inserts an entry for it (COL4); the first was reported `block-removed` where it sat, but a later one read as a move of the already-listed id, so renderers put the dead block back into their root list. Any inserted entry whose block map is neither stored nor arriving now reports `block-removed`, as OB1 states.

Breaking: no
