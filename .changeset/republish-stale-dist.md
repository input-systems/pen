---
"@input/pen": patch
"@input/pen-ai": patch
"@input/pen-assets": patch
"@input/pen-autoformat": patch
"@input/pen-bench": patch
"@input/pen-core": patch
"@input/pen-dom": patch
"@input/pen-ingest": patch
"@input/pen-interop": patch
"@input/pen-markdown": patch
"@input/pen-multiplayer": patch
"@input/pen-react": patch
"@input/pen-schema": patch
"@input/pen-search": patch
"@input/pen-shortcuts": patch
"@input/pen-snapshots": patch
"@input/pen-test": patch
"@input/pen-tools": patch
"@input/pen-transport": patch
"@input/pen-types": patch
"@input/pen-undo": patch
"@input/pen-vue": patch
"@input/pen-yjs": patch
---

Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.
