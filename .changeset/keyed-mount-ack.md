---
"@input/pen-dom": minor
---

A parked selection projection now resolves only on the mount ack of the block it is parked on, in the ack's turn; an ack for any other block does nothing (P4). The vanilla `mountEditor` document tree acks every block element it creates. `DomScheduler` no longer calls a selection projector or keeps a parked selection record between flushes: `DomSchedulerOptions.onProjectSelection`, `DomScheduler.setProjector`, `DomScheduler.projectedThisFlush` and the `SelectionProjector` type are removed, and a flush collects the selection record once.

Breaking: yes — hosts that passed `onProjectSelection`, called `setProjector` or read `projectedThisFlush` on a `DomScheduler` drop those calls; selection projection runs in the field editor.
