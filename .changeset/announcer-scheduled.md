---
"@input/pen-dom": patch
---

AX2: live-region announcements are written in the editor root's scheduler write phase instead of synchronously in the commit or selection turn, so they land one frame later and no longer write outside the flush contract. The region is still created synchronously, and the per-key rate limit is unchanged.

Breaking: no
