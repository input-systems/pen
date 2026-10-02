---
"@input/pen-react": patch
"@input/pen-vue": patch
---

The React and Vue inline content renderers ask the field editor to project the selection after they rebuild a block (P3) instead of relying on the reconciler to save and restore the native range.

Breaking: no
