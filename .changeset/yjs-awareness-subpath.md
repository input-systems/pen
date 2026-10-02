---
"@input/pen-yjs": minor
---

Awareness moves to the `@input/pen-yjs/awareness` subpath and `y-protocols` becomes an optional peer (API2): an install that does not collaborate no longer needs `y-protocols`. `yjsAdapter()` creates no awareness; the multiplayer extension creates one for its scope when it activates, and `yjsAdapter({ awareness: createYjsAwareness })` is the explicit option. A second yjs copy that opens a transaction on a Pen document (a provider applying updates with its own `applyUpdate`) now emits `diagnostic { code: "YJS_SINGLETON_MISMATCH" }` once per document; `wrapYjsDocument` keeps throwing on a foreign `Y.Doc`.

Breaking: yes — import `createYjsAwareness`, `getYjsAwareness`, `encodeYjsAwarenessUpdate` and `applyYjsAwarenessUpdate` from `@input/pen-yjs/awareness`; hosts that wire a provider without the multiplayer extension pass `yjsAdapter({ awareness: createYjsAwareness })`
