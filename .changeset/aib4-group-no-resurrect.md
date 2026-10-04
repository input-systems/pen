---
"@input/pen-yjs": patch
---

Keep keyed undo in order when a user deletes text an AI group inserted (AIB4). A later write of the same group used to merge into the group's step and move it above the user's deletion, so undoing everything brought the deleted AI text back. The group's step now closes when a step above it deleted its insertions, and the write starts the group's next step; typing elsewhere still joins the one step.

Breaking: no
