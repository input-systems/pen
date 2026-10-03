---
"@input/pen-dom": patch
"@input/pen-types": patch
---

A selection projection parked on an unmounted block now asks a host mount requester, installed with the new `FieldEditorImpl.setMountRequester(requester)`, to mount that block in the same turn, and projects on the block's mount ack. `selection-target-unmounted` now means what it says: it is emitted once per park, carrying `version`, `blockId` and `mountRequested`, when the scheduler flush after the park ends with the block still unmounted, and the park stays so a later ack still projects. It is no longer emitted when a mounted target refuses the write. `@input/pen-types` adds `BlockScrollAlign`.

Breaking: no
