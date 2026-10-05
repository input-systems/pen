---
"@input/pen-core": minor
"@input/pen-yjs": minor
"@input/pen-multiplayer": minor
---

Structural commits report and revision only the blocks they touched (SCALE2). Awareness moves to its own subpath (API2), and peer colours pass a closed grammar (COL2).

- `CRDTEvent.affectedBlocks` on remote and undo transactions that touch `blockOrder` lists only the blocks inserted, removed or moved.
- `editor.getBlockRevision()` advances only for blocks a commit changed.
- An `insert-block` / `move-block` into a `{ parent }` that does not exist is dropped with `PEN_APPLY_003` (PR5).
- Awareness lives at `@input/pen-yjs/awareness`, and `y-protocols` becomes an optional peer. `yjsAdapter()` creates no awareness: the multiplayer extension creates its own. A second yjs copy writing to a Pen document emits `YJS_SINGLETON_MISMATCH`.
- `normalizeMultiplayerColor` accepts only hex, named, `rgb`/`rgba` and `hsl`/`hsla` colours with plain numeric arguments. A colour such as `rgb(0,0,0) url(…)` could make every viewer fetch a URL.

Host migration:

- Code that read `CRDTEvent.affectedBlocks` on a remote or undo structural transaction as "every block" treats it as the touched blocks only.
- Hosts that used a revision bump on every block as a "something structural happened" signal listen to `commit` events.
- Hosts that inserted or moved blocks into a missing parent handle the `PEN_APPLY_003` drop.
- Import `createYjsAwareness`, `getYjsAwareness`, `encodeYjsAwarenessUpdate` and `applyYjsAwarenessUpdate` from `@input/pen-yjs/awareness`. Hosts that wire a provider without the multiplayer extension pass `yjsAdapter({ awareness: createYjsAwareness })`.
- A host that set `user.color` to `var(--…)`, `inherit`, `color-mix(…)`, `oklch(…)` or another colour function passes a hex, named, `rgb` or `hsl` colour instead. Other values fall back to the palette colour.

Breaking: yes — hosts treat `affectedBlocks`/`getBlockRevision` as touched-blocks-only, handle `PEN_APPLY_003` for missing parents, import awareness helpers from `@input/pen-yjs/awareness` (or pass `yjsAdapter({ awareness: createYjsAwareness })`), and use hex/named/`rgb`/`hsl` peer colours
