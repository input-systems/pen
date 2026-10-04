---
"@input/pen-react": patch
---

`useReducedMotion` keeps one subscribe function per editor root, so it no longer resubscribes on every render; as the root signal's sole holder it used to dispose the signal and re-add its `matchMedia` listener each time (AX6).

Breaking: no
