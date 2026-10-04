---
"@input/pen-dom": patch
---

Selection scroll-into-view (W3.R15) runs once per projection burst: a record projected twice before the next flush (a keyboard move onto another block projects on `selection-change` and again on the new field's `activation`) no longer measures twice against the same layout and scrolls by double the delta, and a scroll scheduled from a write phase (a `target-rebuilt` projection) queues its write from its own measure instead of running an empty write first and dropping the scroll.

Breaking: no
