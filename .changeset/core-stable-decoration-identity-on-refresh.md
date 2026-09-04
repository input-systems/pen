---
"@input/pen-core": patch
---

`requestDecorationUpdate` and the commit-path refresh now reconcile the freshly collected decorations against the previous set: blocks whose decorations are structurally unchanged keep their `forBlock` list by identity, and a refresh that changes nothing keeps the set (and its generation) and emits no `decorationsChange`. Providers rebuild every decoration object on each pass, so before this a single-block change — one revealed word in a paced stream, one suggestion mark — re-rendered every block subscriber in the document. This is the SCALE2 identity contract applied to the explicit-request path.
