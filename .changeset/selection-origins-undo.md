---
"@input/pen-undo": minor
---

Undo and redo restore the selection with origin `restore` instead of `programmatic` (S3), so the restored selection scrolls into view.

Breaking: yes — hosts that read `selectionChange` origins see `restore` for history restores and drop any `programmatic` check they used to detect them
