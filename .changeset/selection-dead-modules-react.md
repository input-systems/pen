---
"@input/pen-react": patch
---

`Pen.Editor.Content` no longer keeps a `skipNextClick` ref for content gestures; the click after a committed pointer gesture is skipped through the gesture itself.

Breaking: no
