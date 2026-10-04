---
"@input/pen-dom": patch
---

The overlay's D5 block-surface range and O3 block-span runs are now cached on the document state as well as the selection record version. Core keeps the version when a commit leaves the mapped selection equal, so a collaborator appending to, deleting, or inserting blocks inside a held range used to leave a stale or missing highlight until the selection itself changed.

Breaking: no
