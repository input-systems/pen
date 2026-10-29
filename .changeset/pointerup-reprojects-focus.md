---
"@input/pen-dom": patch
---

A drag that starts on a link while blocks are selected no longer leaves focus on the link. Chromium focuses a link on press, and a gesture that left the selection unchanged never moved focus back, so the next key went to the link instead of the editor's focus sink (S2). The focus target is now projected again when the pointer is released.

Breaking: no
