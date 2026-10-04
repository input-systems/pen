---
"@input/pen-dom": patch
---

An edit that arrives during an IME composition without being produced by it (an AI insert, an extension or programmatic apply) is now deferred and the composition rebased over it, like a collaborator's, on the contenteditable backend; it no longer lands the composed text at its pre-edit offset (C2).

Breaking: no
