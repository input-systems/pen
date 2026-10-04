---
"@input/pen-yjs": patch
---

Write the document profile in a `"system"`-origin transaction. `setDocumentProfile()` wrote the metadata map outside a transaction, so Yjs opened one with no origin and `createHeadlessEditor` over `yjsAdapter()` emitted an `ORIGIN_UNKNOWN` ("absent") diagnostic during construction, before any load.

Breaking: no
