---
"@input/pen-types": patch
"@input/pen-core": patch
"@input/pen-multiplayer": patch
---

`DocumentSession.ensureAwareness(scopeId, factory)` creates a scope's awareness once when the adapter created none, and `editor.internals.awareness` reads the scope's awareness live. The multiplayer extension uses it to create its own awareness on activation, so hosts that install `@input/pen-multiplayer` change nothing; it now depends on `@input/pen-yjs` and peers on `yjs` and `y-protocols`, which those hosts already install.

Breaking: no
