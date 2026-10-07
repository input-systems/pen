---
"@input/pen-core": patch
---

Snapshot op payloads for `onBeforeApply` hooks without recursing into cycles, so a cyclic payload is dropped with `PEN_APPLY_004` instead of overflowing the stack, reporting `PEN_APPLY_007`, and skipping the document-profile boundary hook.

Breaking: no
