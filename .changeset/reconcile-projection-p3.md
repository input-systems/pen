---
"@input/pen-dom": patch
---

Withhold the session reconciler's projection while composing. After rebuilding an expanded range's blocks (a remote commit or a decoration change on an active block) or a history rebuild of the focused field, the reconciler projected the record with the P1 `selection-change` trigger, which composition withholding exempts, so the range could be written into the composing host. It now projects as P3 (`target-rebuilt`): withheld while the ime window is open and released once by `compositionend-completed` (W3.R6).

Breaking: no
