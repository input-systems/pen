---
"@input/pen": minor
"@input/pen-ai": minor
"@input/pen-assets": minor
"@input/pen-autoformat": minor
"@input/pen-bench": minor
"@input/pen-core": minor
"@input/pen-dom": minor
"@input/pen-ingest": minor
"@input/pen-interop": minor
"@input/pen-markdown": minor
"@input/pen-multiplayer": minor
"@input/pen-react": minor
"@input/pen-schema": minor
"@input/pen-search": minor
"@input/pen-shortcuts": minor
"@input/pen-snapshots": minor
"@input/pen-test": minor
"@input/pen-tools": minor
"@input/pen-transport": minor
"@input/pen-types": minor
"@input/pen-undo": minor
"@input/pen-vue": minor
"@input/pen-yjs": minor
---

Raise `engines.node` from `>=22` to `^22.22.2 || ^24.15.0 || >=26.0.0` (HOST3). `@input/pen-interop` sanitizes HTML through `isomorphic-dompurify` 4.3, which builds its Node window with jsdom 30, and jsdom 30 declares that range; `@input/pen`, `@input/pen-react`, and `@input/pen-vue` depend on interop, so the workspace-wide floor moves with it. Node 22 releases before 22.22.2, Node 24 releases before 24.15.0, and Node 23 and 25 are no longer supported.
