---
"@input/pen-core": patch
---

Repair parent cycles, duplicate entries, and cross-array membership that a remote or undo commit creates on the next local commit's normalization pass, not only on `normalizeAll` or reload (COL4). The pass checks only the ids the external commit touched; a live block such a commit leaves in no array is re-homed at the end of the root order with an `orphan-block-rehomed` diagnostic, and a cycle owned twice by one block breaks on the lower child id so concurrent repairs converge.

Breaking: no
