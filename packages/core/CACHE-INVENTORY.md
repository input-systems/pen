# SCALE4 cache inventory

Canonical list of hot-path caches (`spec/rules/scale.md` SCALE4). A cache is in this inventory when it persists across commits and is consulted on the apply / decoration / suggestion / presence path. Listener sets, schema registries, one-shot local `Map`s, and current UI state (search matches, the visible autocomplete suggestion) are not caches.

SCALE4 accepts three bounds: a maximum entry count, a TTL, or a lifetime tied to a document / editor / DOM node (`WeakMap` or an index that only holds live document ids). A cache with none of those is **unbounded**.

No numbers in this file are invented. Named constants are cited only where the code already declares them. Runtime caches in `editor.ts`, `editorLifecycle.ts`, undo, and `@input/pen-ai` are inventoried here. Destroy release lives in `destroyEditor` (`editorApiHelpers.ts`).

`editor.destroy()` releases the editor-held maps below (SCALE4 / CH7). The nightly soak asserts post-teardown heap and the public retention inventory in `@input/pen-bench` `src/soak/destroyRetainsNothing.test.ts`. This file is a snapshot: DIR1 and `@input/pen-dom` geometry rows were added from a later pass without editing those packages.

## Core (`@input/pen-core`)

| Cache | File | Bound or unbounded | Cleared on `editor.destroy()`? |
| --- | --- | --- | --- |
| Decoration block index (`DecorationSetImpl._blockIndex`) | `src/editor/decorations.ts:15` (field), `:20–30` (built in constructor), `:33–34` (`forBlock`). Held as `editor._decorations` (`src/editor/editor.ts:76`); replaced by `_refreshDecorations` (`:367–372`) from `dispatchCRDTEvent` (`src/editor/editorLifecycle.ts`). | **Document-scoped.** One key per unique `decoration.blockId` in that set. No entry cap. Replaced set is GC-eligible if nothing else retains it. | **Yes.** `destroyEditor` replaces `_decorations` with `emptyDecorationSet()` (`editorApiHelpers.ts`). Computation / scoping unchanged. |
| `DocumentState` position index (`_positionIndex`) | `src/editor/documentState.ts:16` (field), `:35` (init), `:65–66` (lookup), `:92–124` (`rebuild` replaces the map). | **Document-scoped.** One entry per top-level `blockOrder` id. No entry cap. | **Yes.** `DocumentStateImpl.clear()` (`:128–133`) empties the map. |
| `DocumentState` parent index (`_parentIndex`) | `src/editor/documentState.ts:17` (field), `:36` (init), `:73–74` (lookup), `:92–124` (`rebuild`). | **Document-scoped.** One entry per parented block (`props.parentId` or a parent's `children`). No entry cap. Full rebuild on structural change (`incrementalUpdate`). | **Yes.** Same `clear()`. |
| `DocumentState` preorder (`_preorder`: ids and id → index) | `src/editor/documentState.ts` (`_preorderCache`, read by `preorderIndexOf` / `preorderBlockIds`). Built lazily on first read; dropped by `rebuild`, `clear`, and `incrementalUpdate` when an affected block has or had a `children` array. | **Document-scoped.** One entry per block in nested document order. No entry cap. | **Yes.** `DocumentStateImpl.clear()` drops it. |
| Change-summary `BlockIndex` (`blocks`, `children`) | `src/changes/blockIndex.ts` snapshot maps. Seeded/applied from `src/changes/install.ts:22–41`. Held at `src/editor/editor.ts:72`. | **Document-scoped.** One `blocks` entry per document block; `children` holds parents that have child ids. Incremental `apply` on each summary. No entry cap. | **Yes.** `destroyEditor` replaces `_blockIndex` with `createEmptyBlockIndex()`. `teardownChangeSummaries` (`install.ts:48–52`) still only unsubscribes. |
| Last change summary (`_lastChangeSummary` / `_pendingSummary`) | `src/editor/editor.ts` fields; written in `dispatchCRDTEvent` (`editorLifecycle.ts`) from the just-built pending summary or a fresh empty summary stamped with that commit id. | **Single-slot.** One pending + one last summary. No ring, no `between`. | **Yes.** `destroyEditor` nulls both. |
| `_blockRevisions` | `src/editor/editor.ts:75`. Written at `src/editor/editorLifecycle.ts:287–288` (one increment per affected block per commit). Read at `src/editor/editorApiHelpers.ts` `getEditorBlockRevision`. | **Unbounded.** One number per ever-touched block id. | **Yes.** `destroyEditor` calls `_blockRevisions.clear()` synchronously, before the queued teardown. |
| `Intl.Segmenter` module cache (`segmenters`) | `src/editor/textSegmentation.ts:23`, `:43–51` (`resolveSegmenter`). Key is `` `${locale}:${granularity}` ``. | **Unbounded.** Process-lifetime module `Map`. No entry cap, TTL, or weak key. Grows with distinct locale/granularity pairs. | **No.** Survives every editor. |
| Direction cache factory (`createDirectionCache`) | `src/direction/cache.ts:50–78`. One `Map` entry per `blockId`, fingerprinted against text/props (`fingerprintDirectionInput` `:37–43`). Has `invalidate` / `clear`. **Not wired** to `EditorImpl` (no caller under `src/editor/`). Arrived after the first inventory pass (DIR1). | **Document-scoped if used** (one entry per block; `clear()` exists). Unused by destroy today. | **N/A.** No editor hook. Nothing to release. |
| Formatter cache factory (`createFormatterCache`) | `src/i18n/formatters.ts:27–64`. Three `Map`s (`pluralRules`, `numberFormats`, `dateTimeFormats`) keyed by `locale` + `JSON.stringify(options)`. **Not wired** to `EditorImpl` (not re-exported from `src/index.ts`). | **Unbounded** if used (no cap, no `clear`). Unused today. | **N/A.** No editor hook. |
| Facet empty-output memo (`emptyOutputs`) | `src/facets/registry.ts:63–66`, `:129–138` (`readUnregistered`). | **Weak-key.** `WeakMap` keyed by `Facet`. | **Weak.** Registry *is* installed (`editor.ts:157` `createFacetRegistry`). No `destroy` on the registry; empty outputs die with the registry / editor. |
| Facet process state (`Symbol.for("@input/pen-core:facetState")`) | `src/facets/defineFacet.ts:12–48`. `globalThis` holder: `providerRecords` WeakMap, `facetSpecs` WeakMap, `specsByName` Map. | **Process-lifetime, not per-editor.** `specsByName` is strong and bounded by module-level facet names (30 keys at soak inspect). WeakMaps cannot keep a provider or facet alive. Walk of every `specsByName` spec found no `Editor` (`inspectRetainers.mjs`). | **N/A.** Nothing editor-scoped to release. Not the 1.159 leftover. |
| Facet slot / provider memos | `src/facets/compute.ts` (`provider.input`, `slot.output`, `resolveSlot`). Slots on `FacetComputeState`, filled at `registry.ts:78–86`. | **Editor-lifetime.** Tracks the live provider list. No entry cap. | **No.** Not walked by `destroyEditor`. Held by `_facetRegistry` until the editor is collected. |
| Inline-completion leases | `src/editor/inlineCompletion.ts:14–17`. | **Weak-key.** `WeakMap` keyed by `Editor`. Last `release()` deletes the lease and calls `controller.destroy()` (`:241–245`). | **Weak.** Not walked by `destroyEditor`. GC when the editor is collected if no lease remains. Nothing extra to clear. |

### Related session maps (not commit-path caches)

| Map | File | Bound or unbounded | Cleared on `editor.destroy()`? |
| --- | --- | --- | --- |
| Document session scope indexes (`_scopes`, `_guidToScopeId`, `_scopeIdsByOwnerKey`, `_listenersByScope`) | `src/editor/documentSession.ts:55–58`. | Live scopes / guids / owners, not a result cache. | **Yes, if the session destroys.** `destroyEditor` calls `_releaseSession` (`editorApiHelpers.ts:212`). Session `destroy()` (`documentSession.ts:305–308`) clears the maps when `destroyWhenIdle` fires or the session is destroyed directly. |
| Apply-pipeline unknown-type dedupe (`_unknownBlockTypesReported`) | `src/editor/applyPipelineRunner.ts:129–134`, written `:139–143`. | **Unbounded.** One entry per distinct unknown block type seen. | **No.** Unbounded and unreleased — the dangerous pair. Not one of the four public retentions. |
| Schema-engine dirty / deferred sets | `src/schema/normalize.ts:91–92`. Cleared / drained during `normalize` (`:133`). | Work queues, not a result cache. Size tracks in-flight dirty blocks. | **No.** |
| Editor slots (`_slots`) | `src/editor/editor.ts:65`. | Registry, not a cache. | **Partial.** `undo:manager` deleted on destroy; other keys kept. |
| Extension registry / state (`_extensions`, `_stateMap`) | `src/editor/extensionManager.ts:15–17`. `_stateMap.clear()` after `deactivateAll` (`:160`). | Registry, not a cache. | **Partial.** `_stateMap` cleared; `_extensions` kept. |
| Event handlers (`_handlers`) | `src/editor/events.ts:6`. | Listener set, not a cache. | **Yes.** `destroyEditor` → `removeAllListeners()` (`events.ts:65`). |

One-shot locals (`pendingBlockTypes` in `applyPipelineRunner.ts:226`, cell-selection indexes in `cellSelection.ts:104–116`, facet topo maps in `registry.ts`) are not retained.

## Sibling packages (noted, not edited)

SCALE4 names the AI suggestion caches and undo stacks. These live outside `@input/pen-core`. This step does not edit them.

| Cache | File | Bound or unbounded | Cleared on destroy? |
| --- | --- | --- | --- |
| AI `analysisCache` | `packages/extensions/ai-suggestions/src/controller.ts:60`, prune `:645–654`, TTL `DEFAULT_CACHE_TTL_MS` (`constants.ts:9`, 5 min). | **TTL only.** Unbounded entry count within TTL. | **Yes.** `controller.destroy()` `:441`. |
| AI `dismissedFingerprints` | `controller.ts:61`, prune `:657–660`, TTL `DEFAULT_DISMISS_MEMORY_MS` (`constants.ts:10`, 10 min). | **TTL only.** Unbounded entry count within TTL. | **Yes.** `controller.destroy()` `:442`. |
| AI scheduler `dirtyBlocks` | `packages/extensions/ai-suggestions/src/scheduler.ts:29`. | **Unbounded** until consume / reset. | **Yes.** `scheduler.destroy()` → `reset()` `:48–51`. |
| AI scheduler `lastRequestedAtByBlock` | `scheduler.ts:30`. Cooldown `DEFAULT_COOLDOWN_MS` (10s) gates *when* a block may be requested; it does not evict. | **Unbounded** until reset / destroy. | **Yes.** Same reset. |
| Undo / redo stacks | `packages/crdt/yjs/src/undo.ts:15` (`DEFAULT_UNDO_MAX_DEPTH = 500`), trim `:36–39`. Also `packages/extensions/undo/src/undoExtension.ts:27`. | **Count-capped** at 500 (CH7). | **Yes.** `UndoManagerImpl.destroy()` (`undo/src/undoManager.ts:154–159`) tears down the CRDT undo manager. |
| GeometryReader per-block cache | `packages/rendering/dom/src/geometry/geometryReader.ts:116`, `dispose()` `:285–289`, `clearCache()` `:320–323`. Standalone; not wired to DomScheduler. Arrived after the first inventory pass. | **Reader-scoped.** No entry cap. Cleared on dispose, commit-id change, resize/font generation. | **Yes, on `dispose()`.** Sibling `blockCommitIds` (`:117`) is still not cleared. Not walked by `editor.destroy()`. |
| `inlineAtomElementData` | `packages/rendering/dom/src/field-editor/inlineAtomDom.ts:22`. | **Weak-key** (`HTMLElement`). | Weak. |
| Field-editor selection authority | `packages/rendering/dom/src/field-editor/selectionAuthority.ts:31–34`. | Count-bounded by the six-source enum. | Not walked by `editor.destroy()`. |
| Yjs awareness wrappers | `packages/crdt/yjs/src/awareness.ts:7`, `:14`. | **Weak-key.** | Weak. |
| Yjs `Doc.store` (`StructStore`) | `yjs` `Doc.js:71` (`this.store = new StructStore()`), `destroy()` at `:325–346`. Pen creates these with `gc: false` (`packages/crdt/yjs/src/document.ts:343`, `packages/tooling/test/src/createTestDocument.ts:91`, `twoPeerHarness.ts` `forkPeer`). | **Document-lifetime, not emptied on `Doc.destroy()`.** Destroy sets `isDestroyed`, emits, and clears observers (`ObservableV2.destroy`). It does not null `store` / `share`. The item graph dies only when the last JS reference to the `Doc` drops. | **No.** `editor.destroy()` does not destroy the Y.Doc when `ownsDocuments` is false (test editors pass an existing document). The soak calls `ydoc.destroy()` and still holds the `Doc` until the editor handle is dropped. |
| Two-peer seed document | `packages/tooling/test/src/twoPeerHarness.ts:34–43`. `createTwoPeerHarness` builds a seed editor, forks two peers, then `seed.destroy()` in `finally` without await and without `seed.ydoc.destroy()`. | One extra `EditorImpl` + `gc: false` `Y.Doc` per harness. Not iteration-scaled (warmup + one session harness). | **Partial.** Seed `destroy()` is fire-and-forget; the seed Y.Doc is never destroyed. Sibling — report, do not edit from this inventory pass. |
| Yjs load reports | `packages/crdt/yjs/src/loadDocument.ts:60`. | **Weak-key** (`Y.Doc`). | Weak. |
| Yjs summary sources | `packages/crdt/yjs/src/summarySource.ts:69`. | **Weak-key** (`Y.Doc`). | Weak. |
| History / multiplayer scope runtimes | `packages/extensions/snapshots/src/scopeRuntime.ts:5`, `packages/extensions/multiplayer/src/scopeRuntime.ts:17`. | Outer `WeakMap` by owner; inner `Map` by scope id. | Weak on the owner. |
| `AuthorLedger.entriesByClientId` | `packages/extensions/multiplayer/src/presence/authorLedger.ts:8`. | **Unbounded** (ever-seen client ids). No delete / cap. | Not cleared. |
| `ClientIdentityMap.map` | `packages/extensions/multiplayer/src/presence/identityMap.ts:36`. | **Unbounded** (ever-seen client ids). | Not cleared. |
| Presence peer cap constant | `packages/extensions/multiplayer/src/presence/constants.ts:23` (`MAX_TRACKED_PEERS = 32`), `:20` (`MAX_PRESENCE_UPDATES_PER_SECOND = 10`). | Cap is declared. No ingest `Map` (`trackedPeers` / `accepted` / `updateStamps`) is present in this tree; `presenceIngest.ts` is absent. | N/A. |
| `ExternalInlineTurnRegistry.results` | `packages/extensions/ai/src/runtime/externalInlineTurnRegistry.ts:14`. | **Unbounded.** No `clear` / `destroy`. | **No.** |

## Still unbounded (no cap, no TTL, no weak/document-scoped drop)

1. **`_blockRevisions`** — one entry per ever-touched block while the editor is live. Cleared on `destroyEditor`.
2. **`SummaryLog.memo`** — no independent cap inside the 256-commit ring.
3. **`segmenters`** — process-lifetime `Intl.Segmenter` map; not editor-scoped.
4. **`createFormatterCache` maps** — unbounded if a caller ever holds one (unused today).
5. **`_unknownBlockTypesReported`** — one entry per distinct unknown type; not cleared on destroy.
6. **AI `analysisCache`** — TTL only; unbounded inside the TTL window. Sibling.
7. **AI `dismissedFingerprints`** — TTL only; unbounded inside the dismiss-memory window. Sibling.
8. **AI `lastRequestedAtByBlock` / `dirtyBlocks`** — no TTL eviction; grow until controller reset / destroy. Sibling.
9. **`AuthorLedger` / `ClientIdentityMap`** — ever-seen peers. Sibling.
10. **`ExternalInlineTurnRegistry.results`** — ever-registered external inline turns. Sibling.

Document-scoped indexes (decoration block index, `DocumentState` position/parent maps, `BlockIndex`) are **not** in this list: their lifetime is the live document / decoration set. They have no numeric cap.

## Destroy

`destroyEditor` (`src/editor/editorApiHelpers.ts`) deactivates extensions, tears down observation, releases the session, clears `_blockRevisions`, replaces `_decorations` / `_blockIndex`, nulls `_pendingSummary` / `_lastChangeSummary`, calls `DocumentStateImpl.clear()`, deletes the `undo:manager` slot, and overrides `undoManagerFacet` to `null` (then `refreshUndoManager` so the public handle is `NOOP_UNDO`). The undo extension already `destroy()`s its manager on deactivate; it leaves the slot *and* the facet override pointing at that instance — `getSlot("undo:manager")` is a facet adapter, so dropping only the map key unmasks the leftover. Core clears both. It does not clear `_slots` as a whole, other `_facetRegistry` memos, `_unknownBlockTypesReported`, or the module-level `segmenters` map. It also does not detach `_crdtDoc` / `_doc` / `_facetRegistry` / `_pipeline` / `_extensions` / `_documentSession`. A host that keeps the `Editor` handle therefore keeps the Y.Doc `StructStore`. AI suggestion maps *are* cleared from `AISuggestionsControllerImpl.destroy` when that extension deactivates. Public pins: `packages/tooling/bench/src/soak/destroyRetainsNothing.test.ts`.

### Nightly 400-iteration leftover

The four public maps above are released; `destroyRetainsNothing.test.ts` is green. The nightly soak still failed at **1.159×** (quiet-machine repeats **1.162 / 1.158**) against the 1.13 bound. That overshoot is **one retainer class**, not several caches, and it is **stable, not load noise**.

Heap snapshots (`src/soak/inspectRetainers.mjs`) while the soak frame still held destroyed editors:

- `queryObjects`: 9 `EditorImpl`, 9 `Y.Doc`.
- Constructor self-size is dominated by `Item` / `YMap` / `YText` inside those docs, not by core cache maps.
- Retainer paths all go to **stack roots**, then the soak locals:

```text
(Stack roots)
  → harness.peerA / harness.peerB / session / baselineEditor / recreated
    → EditorImpl._crdtDoc.ydoc          (or .crdtDoc.ydoc / .editor)
      → Doc.store
        → StructStore.clients
          → Item / YMap / YText
```

`Y.Doc.destroy()` had already run. The store was still there because yjs does not empty it, the docs were created with `gc: false`, and `run()` still rooted the handles. The two-peer harness lives the whole session, so 400 iterations of peer history sat in those stores at the post-teardown sample.

`run.mjs` now samples baseline, session, and recreate in child frames so those handles are gone before `sample("post-teardown-recreate")`. After that change, the same quiet machine measured **1.049 / 1.045 / 1.049** (24) and **1.080 / 1.077 / 1.073** (400). The 1.13 bound was not raised.

Residual ~1.07 at 400 vs ~1.05 at 24 is V8 leftover after a larger allocation plus the two-peer seed docs, not a second named cache. A host that keeps the destroyed `Editor` will still see the `StructStore` path; that detach belongs in `releaseDestroyedEditorCaches` (`editorApiHelpers.ts`), which this lane cannot edit.
