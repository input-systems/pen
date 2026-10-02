---
"@input/pen-test": patch
---

Add `createScanProbe(editor)`, a test-only instrument that counts document reads which scale with document size (block order and block map reads and iterations, full text reads, document-state order reads, and whole-document walks), with a self-test that fails when a counter is miswired. Headless SCALE2 and SCALE6 counts read through it.

Breaking: no
