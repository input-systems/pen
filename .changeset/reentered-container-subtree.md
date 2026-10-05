---
"@input/pen-core": patch
---

Report a container's `children`-array subtree when the container's order entry comes back. A stored container can lose its entry without being deleted (an orphan until the next pass re-homes it, or an out-of-order delivery whose re-insert lands in a later update); when an entry for it returned, the summary named the container but not its children, so search and other per-block consumers kept the children out (cache property lead seed 21082). Each descendant is now reported `block-inserted` with the container.

Breaking: no
