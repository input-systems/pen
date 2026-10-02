---
"@input/pen-dom": patch
---

The field editor no longer projects the editor selection into a field while an IME composition is open there; it projects once when the composition completes, so a remote edit during composition no longer produces a `selection-projection-mismatch`. A projection that finds the DOM, focus and EditContext buffer already matching the selection writes nothing, and a divergence that only repeats the read-back of a reported mismatch is not re-projected.

Breaking: no
