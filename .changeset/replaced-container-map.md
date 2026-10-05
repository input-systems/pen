---
"@input/pen-core": patch
---

Report the children a replaced container map dropped. An undo of a container's delete stores a whole new map for it; a child a peer had meanwhile inserted into the old map's `children` array vanished with that map, and the summary reported nothing for it. Such children are now reported `block-removed` and reach the next local pass, which re-homes them (COL4).

Breaking: no
