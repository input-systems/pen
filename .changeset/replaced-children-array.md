---
"@input/pen-core": patch
---

Report the children a replaced `children` array dropped. Two peers inserting the first child of a container concurrently each create its `children` array and Yjs keeps one; the losing array's children vanished from the document with no `block-removed` in the summary, so per-block indexes, search and renderers kept them, and normalization only re-homed them on the other peer. The summary now diffs the replaced array against the surviving one and reports each dropped child removed, the change-summary block index re-reads the container, and every peer's next local pass re-homes the dropped children at the end of the root order (COL4).

Breaking: no
