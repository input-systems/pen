---
"@input/pen-core": patch
---

Report a block removed when one commit both deletes it and moves its entry. A peer that had already merged a delete with a concurrent move forwards both together; the receiving summary reported only the move, because a moved entry skipped the deleted-map check, so renderers kept drawing the dead block. Such an entry now reports `block-removed` where the block sat.

Breaking: no
