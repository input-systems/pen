---
"@input/pen-dom": patch
---

Defer collaborator edits that arrive during IME composition (C2, COL1). The field-editor backends compared the Yjs transaction origin to the strings `"remote"` and `"collaborator"`, but the adapter stamps structured origins and providers pass their own origin objects, so nothing was ever deferred: a remote insert before the composition shifted where the composed text landed (`"XHello worlnid"` instead of `"XHello worldni"`), and the EditContext buffer missed the remote text after composition. Remote edits are now recognised by `transaction.local === false` or a structured `collaborator` origin. The caret after the composition is mapped through the deferred remote edits too, so it lands after the composed text.

Breaking: no
