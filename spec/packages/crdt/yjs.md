# @input/pen-yjs

## Purpose

Yjs CRDT adapter for Pen

## Public Role

Bridge Pen contracts to a specific CRDT implementation.

## Key Exports / Entrypoints

- Export map: `.` and `./awareness`
- CRDT adapter and document helpers such as `yjsAdapter()`, `wrapYjsDocument()`, `initBlockMap()`, and `getYjsDoc()`
- `PenDocumentUnreadableError`, thrown by `loadDocument` when `minReader` is too new or a shared type has the wrong Yjs constructor
- Collaboration helpers such as `createYjsProviderSession()`; awareness lives on `@input/pen-yjs/awareness` (`createYjsAwareness()`, `getYjsAwareness()`, `encodeYjsAwarenessUpdate()`, `applyYjsAwarenessUpdate()`). `yjsAdapter()` creates no awareness: the multiplayer extension ensures one per scope when it activates, and `yjsAdapter({ awareness: createYjsAwareness })` is the explicit option for a host that wires a provider without it
- State-vector helpers such as `encodeYjsStateVectorBase64()`, `compareYjsStateVectors()`, and `isYjsStateVectorBase64Satisfied()`
- Generic field adapters such as `createYTextFieldAdapter()` and `createYArrayFieldAdapter()`
- Extension-root helpers such as `ensureExtensionRoot()` and `readExtensionRoot()`
- Anchor methods `createRelativePosition(doc, target, assoc)` and `resolveRelativePosition(doc, encoded, options?)` live on the `CRDTAdapter` object returned by `yjsAdapter()`, not on the package barrel. `editor.anchors` is the host surface; these methods are the CRDT implementation behind it. `loadDocument()` is adapter-scoped the same way.
- Summary and origin plumbing: `createSummarySource()`, `STRUCTURAL_ORIGIN_META_KEY`, `createRemoteUpdateOrigin()`, `originToOpOrigin()`
- Document lifecycle: `validateDocument()`, `createYjsSubdocument()`, `getDocumentProfile()` / `setDocumentProfile()`, `getDocumentLoadReport()`, `readFormatStamp()` / `refreshFormatStamp()`
- Format stamp helpers; new documents stamp `PEN_DOCUMENT_FORMAT` (`3`)
- The adapter's own metadata writes (format stamp, `setDocumentProfile()`, load repairs) run in a `"system"`-origin transaction, so constructing an editor over a fresh document emits no `ORIGIN_UNKNOWN` diagnostic
- Workspace scripts: `build`, `clean`, `dev`, `lint`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-types`
- Peer dependencies: `yjs`; `y-protocols` (optional, needed only by `./awareness`)
- Boundary: Adapters must respect the editor authority boundary while exposing persistence and sync integration points.

## Undo Origin Matching

The apply pipeline passes a freshly built structured origin object into `adapter.transact` so `groupId` / `requestId` survive on the Yjs transaction. `Y.UndoManager` matches `trackedOrigins` by identity, so neither the bare type string (`"user"`) nor an interned canonical object is the same reference as that transaction origin.

`createYjsUndoManager()` therefore installs a `TrackedOriginSet` (`packages/crdt/yjs/src/undo.ts`) that extends `Set` and overrides `has()`: identity still wins, and a structured object also matches when its `type` string is in the set. Default tracked types are `"user"` and `"ai"`. The class is adapter-local, not a public export.

Capture is keyed (AIB4): `Y.UndoManager` runs with `captureTimeout: 0`, and the adapter merges stack items per key (`setCaptureKey`, or a key derived from the transaction's structured origin: `group:<groupId>` when it carries one, `origin:<type>` otherwise). An explicit group's item collects every write of its key and moves to the top, unless a step above it deleted content the item inserted, in which case the key's item closes and the write starts a new one; an origin key joins only the item directly beneath the new one within the capture window. Undo and redo close every key, `stopCapturing()` closes the origin keys, and `maxDepth` trimming drops the keys of trimmed items.

## Data Flow / Runtime Model

CRDT adapter packages in Pen should stay package-first and explicit about ownership. Use this package when a host app adopts the matching CRDT backend.

State-vector helpers are the generic synchronization primitive for host-owned workflow barriers. A host can capture a Yjs state vector before enqueueing work and later ask whether a synced document satisfies that barrier without duplicating Yjs clock comparison logic.

Field adapters cover host-owned non-body fields that live next to Pen document roots, such as titles, labels, tags, or app-specific structured arrays. They are storage helpers only: hosts provide normalization and stable IDs, while Pen provides deterministic Yjs text/array operations.

Extension-root helpers reserve namespaced Yjs maps under the document `apps` root. They provide version checks and deterministic field initialization for app-owned collaboration data without teaching Pen product-specific schema.

Empty text-capable `Y.Text` is `""`. Relative-position mint and resolve walk `penDocument.blocks` (and nested table cells) for the resolved `Y.Text`; a missing or deleted type is `null`. The adapter never throws on hostile or stale encoded positions.

`createSummarySource` reports a block that arrives carrying content as an insert of that content. Yjs leaves a type created inside a transaction out of `txn.changed`, so a block whose text was written at construction — a split's tail block, an import, a paste — emits no text delta of its own, and every observer downstream would otherwise see the block appear and its text arrive from nowhere. The gate is the block's entry changing on the `blocks` map, so a reorder, which only touches order arrays, never restates existing text as an insert. This is what gives AN14's remote delete/insert pairing an insert to pair against when a peer splits a block.

A write made while another transaction is being observed — a commit listener applying ops during a remote delivery or an undo — is queued by Yjs, and its observers run only after the earlier transactions' cleanup. That cleanup merges structs: a deleted run with the struct beside it the queued write deleted, and, from an earlier queued transaction whose state vector is read only when its cleanup starts (Yjs opens an empty one whenever a text delta is read from an observer), the queued write's new struct with the one the same client wrote just before. The queued write's own events then miss that delete or insert. `createSummarySource` therefore reads each transaction queued behind the one it just reported before that one's cleanup runs, and reports those deltas when the queued transaction is observed, so a listener write's summary names everything it changed.

## Integration Notes

- Path in workspace: `packages/crdt/yjs`
- Spec path mirrors workspace path: `packages/crdt/yjs.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.
- Keep app semantics out of the adapters. For example, a recipient list should be implemented as a host-specific array adapter configuration, not as an email-aware Pen primitive.
- Prefer extension roots over ad hoc top-level shared types for new app-owned CRDT data.

## Current Maturity / Intended Usage

Workspace package at version `0.3.0`; intended usage is current-state but still evolving.

## Non-goals

- Do not let the adapter redefine the Pen document model or renderer behavior.
- Do not make Durable Streams, WebSocket providers, or app-owned sync state part of this package.
- Do not encode product-specific validation in field adapters.
