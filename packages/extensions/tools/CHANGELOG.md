# @input/pen-tools

## 0.3.0

### Minor Changes

- 56b8dfc: AI tool calls are attributed, classified and undone per call (AIB3, AIB4).

  - `openAIToolCall()` returns the call's own `context`. `executeAITool()` and both transports run handlers with it. Every write path books a write to the call that issued it, and refuses a read-only call's write.
  - The user's typing while a call is open is no call's write.
  - `StreamingTarget.disableActiveWriter()` is replaced by the `activeWriter` getter.
  - `ToolDefinition.destructive` may be a resolver `(input, { staged }) => boolean` (`ToolDestructiveResolver`, `ToolAuthorityContext`).
  - `edit_document` consults `confirm` only for direct calls that remove or replace content: direct replaces, deletes of non-empty blocks, and content-kind changes. `authorizeAIToolCall` and `isDestructiveAITool` take the call's context.
  - New `unconfirmedDestructive: "refuse"` (on `aiExtension`, `AIToolGrant`, `AIToolTurnOptions` and `AgenticLoopOptions`) blocks destructive calls when no resolver is installed. Use it in production if you expose `delete_block` or `write_document`.
  - A host that used `confirm` as an "every AI edit" hook moves to `onBeforeApply` or the commit event.
  - `UndoManager.syncExplicitUndoGroup` is replaced by `withCapture(origin, groupId, run)`. `CRDTUndoManager` gains an optional `setCaptureKey` (`CRDTUndoCaptureKey`).

  Host migration:

  - Tool handlers that compared `ctx.editor === editor` compare `ctx.editor.internals.adapter` (or the document) instead, because `ctx.editor` is now a per-call view.
  - Code that called `StreamingTarget.disableActiveWriter()` reads `activeWriter`.
  - Code that reads `ToolDefinition.destructive` as a boolean must handle a function.
  - Hosts that implement `UndoManager` replace `syncExplicitUndoGroup` with `withCapture`.

  Breaking: yes — tool handlers compare `ctx.editor.internals.adapter` instead of `ctx.editor === editor`, read `activeWriter` instead of `disableActiveWriter()`, handle a function-valued `ToolDefinition.destructive`, and `UndoManager` implementations replace `syncExplicitUndoGroup` with `withCapture`

- c921845: Raise `engines.node` from `>=22` to `^22.22.2 || ^24.15.0 || >=26.0.0` (HOST3). `@input/pen-interop` sanitizes HTML through `isomorphic-dompurify` 4.3, which builds its Node window with jsdom 30, and jsdom 30 declares that range; `@input/pen`, `@input/pen-react`, and `@input/pen-vue` depend on interop, so the workspace-wide floor moves with it. Node 22 releases before 22.22.2, Node 24 releases before 24.15.0, and Node 23 and 25 are no longer supported.

  Breaking: yes — hosts running Node below 22.22.2, 24.0–24.14, or 23/25 must move to a supported Node line (^22.22.2, ^24.15.0 or >=26.0.0)

### Patch Changes

- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [c921845]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
  - @input/pen-types@0.3.0
  - @input/pen-core@0.3.0
  - @input/pen-ingest@0.3.0
  - @input/pen-markdown@0.3.0

## 0.2.14

### Patch Changes

- @input/pen-core@0.2.14
  - @input/pen-ingest@0.2.14
  - @input/pen-markdown@0.2.14
  - @input/pen-types@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies [8e2654b]
  - @input/pen-core@0.2.13
  - @input/pen-ingest@0.2.13
  - @input/pen-markdown@0.2.13
  - @input/pen-types@0.2.13

## 0.2.12

### Patch Changes

- eeb5eb2: Preserve rich formatting and block structure when AI rewrites selections.
- Updated dependencies [eeb5eb2]
  - @input/pen-ingest@0.2.12
  - @input/pen-core@0.2.12
  - @input/pen-markdown@0.2.12
  - @input/pen-types@0.2.12

## 0.2.11

### Patch Changes

- @input/pen-core@0.2.11
  - @input/pen-ingest@0.2.11
  - @input/pen-markdown@0.2.11
  - @input/pen-types@0.2.11

## 0.2.10

### Patch Changes

- @input/pen-core@0.2.10
  - @input/pen-ingest@0.2.10
  - @input/pen-markdown@0.2.10
  - @input/pen-types@0.2.10

## 0.2.9

### Patch Changes

- @input/pen-core@0.2.9
  - @input/pen-ingest@0.2.9
  - @input/pen-markdown@0.2.9
  - @input/pen-types@0.2.9

## 0.2.8

### Patch Changes

- @input/pen-core@0.2.8
  - @input/pen-ingest@0.2.8
  - @input/pen-markdown@0.2.8
  - @input/pen-types@0.2.8

## 0.2.7

### Patch Changes

- @input/pen-core@0.2.7
  - @input/pen-ingest@0.2.7
  - @input/pen-markdown@0.2.7
  - @input/pen-types@0.2.7

## 0.2.6

### Patch Changes

- dcd1573: Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.
- Updated dependencies [dcd1573]
  - @input/pen-core@0.2.6
  - @input/pen-ingest@0.2.6
  - @input/pen-markdown@0.2.6
  - @input/pen-types@0.2.6

## 0.2.5

### Patch Changes

- @input/pen-core@0.2.5
  - @input/pen-ingest@0.2.5
  - @input/pen-markdown@0.2.5
  - @input/pen-types@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies [4ea7542]
  - @input/pen-types@0.2.4
  - @input/pen-core@0.2.4
  - @input/pen-ingest@0.2.4
  - @input/pen-markdown@0.2.4

## 0.2.3

### Patch Changes

- @input/pen-core@0.2.3
  - @input/pen-ingest@0.2.3
  - @input/pen-markdown@0.2.3
  - @input/pen-types@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [b359f9a]
  - @input/pen-core@0.2.2
  - @input/pen-ingest@0.2.2
  - @input/pen-markdown@0.2.2
  - @input/pen-types@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [ab64f16]
  - @input/pen-core@0.2.1
  - @input/pen-ingest@0.2.1
  - @input/pen-markdown@0.2.1
  - @input/pen-types@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
  - @input/pen-core@0.2.0
  - @input/pen-ingest@0.2.0
  - @input/pen-markdown@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- Updated dependencies [7fb7864]
- Updated dependencies [7fb7864]
  - @input/pen-core@0.1.9
  - @input/pen-ingest@0.1.9
  - @input/pen-markdown@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- cb50239: Export planEditDocument, executeEditDocument, and editDocumentTool so hosts can reuse the edit_document compiler with a custom apply origin. Applied results follow opaque compiled-op owner tokens through direct and suggestion-mode transforms, not string fingerprints.
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-types@0.1.8
  - @input/pen-ingest@0.1.8
  - @input/pen-markdown@0.1.8

## 0.1.7

### Patch Changes

- @input/pen-core@0.1.7
  - @input/pen-ingest@0.1.7
  - @input/pen-markdown@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
  - @input/pen-core@0.1.6
  - @input/pen-types@0.1.6
  - @input/pen-ingest@0.1.6
  - @input/pen-markdown@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5
  - @input/pen-ingest@0.1.5
  - @input/pen-markdown@0.1.5

## 0.1.4

### Patch Changes

- @input/pen-core@0.1.4
  - @input/pen-ingest@0.1.4
  - @input/pen-markdown@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- @input/pen-core@0.1.3
  - @input/pen-ingest@0.1.3
  - @input/pen-markdown@0.1.3
  - @input/pen-types@0.1.3

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [e80fedc]
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-core@0.1.2
  - @input/pen-types@0.1.2
  - @input/pen-ingest@0.1.2
  - @input/pen-markdown@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-ingest@0.1.1
  - @input/pen-markdown@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. Block CRUD and generation-zone extension for Pen.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
  - @input/pen-markdown@0.1.0
  - @input/pen-ingest@0.1.0
