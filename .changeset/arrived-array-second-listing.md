---
"@input/pen-core": patch
---

Report a block an arrived `children` array lists when the same commit also places it in another array. Concurrent moves of one block into a container with an array and into one whose first child creates its array arrive together on a third peer; the summary walked the new array but skipped any id another array edit had already placed, so the new array's parent never heard about its child and renderers kept it childless. Each array's entry is now reported.

Breaking: no
