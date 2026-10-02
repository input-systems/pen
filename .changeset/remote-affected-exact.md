---
"@input/pen-yjs": minor
---

Remote and undo transactions that touch `blockOrder` report only the blocks they inserted, removed or moved in `CRDTEvent.affectedBlocks`, read from the array's own event, instead of every id in the order (SCALE2).

Breaking: yes — code that read `CRDTEvent.affectedBlocks` on a remote or undo structural transaction as "every block" must treat it as the touched blocks only.
