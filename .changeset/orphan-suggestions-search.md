---
"@input/pen-ai": patch
"@input/pen-search": patch
---

Leave stored blocks the document order does not reach out of the AI suggestion list and the search matches, as their full walks do (SCALE2). A COL4 orphan, such as a block whose parent a peer deleted while an undo restored it, is rendered nowhere until the next local pass re-homes it, and a commit naming it no longer adds its suggestions or matches.

Breaking: no
