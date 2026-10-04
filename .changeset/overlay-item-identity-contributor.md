---
"@input/pen-dom": patch
---

Overlay items are now painted by contributor and key, not key alone, so a host contributor whose request reuses a built-in key (for example `range:first`) gets its own node instead of sharing, restyling, or removing the built-in item's.

Breaking: no
