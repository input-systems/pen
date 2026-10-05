---
"@input/pen-core": patch
---

Report a deleted container's child that another entry still lists as moved, not removed. A child listed both in a container and elsewhere (COL4, until normalization repairs it) survives the container's delete, but the summary reported it `block-removed` with the container's subtree, so search and other per-block consumers dropped a block that still renders. It now reports `block-moved` to the surviving entry, as a removed duplicate entry already does.

Breaking: no
