# @input/pen-types

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

- 56b8dfc: AI write attribution, undo grouping and review preview fixes:

  - **Undo grouping (AIB4)**
    - Undo capture is keyed. One AI action stays one undo step even when the user types during it, and the user's typing stays its own steps.
    - `directTransport` and `createSSEHandler` give each request one undo group.
  - **Overlapping calls (AIB3)**
    - Overlapping tool calls and generations keep their own write guard and staged-write binding. A call closing out of order no longer drops another call's guard or unstages its writes.
    - `directTransport`, `createSSEHandler` and `processStream` apply the editor's `confirm` / `unconfirmedDestructive` policy and accept their own overrides. They allow destructive calls by default when no `confirm` is set, so a server reachable by clients should pass `"refuse"` or a `confirm`.
  - **Review preview (RS6):** the `edit_document` streaming preview matches what accept will do: multi-block and nested replaces and deletes, insert placement, empty replacements, and moves and formatting. `EditDocumentPreviewUpdate` gains `blockIds`, `placement` and `complete`. `AIStreamingReviewPreviewInput` gains `complete`, `deletesBlocks` and `replacesBlocks`.
  - **Undo drift anchors:** undo reuses the selection authority's anchors through `editor.internals.selectionAnchors()` and `selectionAnchorRepair()` (AN14). This stops spurious `anchor-target-missing` for ranges that end on dividers or tables, and halves `anchor-budget` churn.
  - **Anchor repair (AN2, AN14):** `repairAnchor` reads an anchor's position from before the commit even when something resolved it after the commit landed, so a split no longer moves an anchor to the start of the new block. An anchor that resolved to `null` before a commit stays dead instead of being revived from an older position, and a merge carries an `assoc: -1` anchor at the start of the merged-away block into the target instead of losing it.
  - **React AI chrome:** the AI suggestions popover is scoped to its own editor. `Pen.AI.ContextualPromptComposer` no longer throws a hook-order error when a session opens.

  Breaking: no

- 56b8dfc: Document integrity fixes for concurrent, out-of-order and malformed edits:

  - **Encodable ops (OPB1):** `editor.apply` drops an op whose payload the CRDT cannot encode, with `PEN_APPLY_004`. Examples are a `set-meta` without a namespace, cyclic or non-plain prop, meta and app values, and non-finite mark values. Before, such an op could stop the document from syncing or persisting, or leave a partial write.
  - **Missing parents:** a `parentId` that names no live block, and an insert or move into a parent deleted earlier in the same batch, are dropped with `PEN_APPLY_003` (PR5).
  - **Dangling entries (COL4)**
    - Normalization removes `blockOrder` / `children` entries whose block was deleted (`dangling-block-reference`). Entries whose block map has not arrived yet are kept (new optional `CRDTAdapter.isBlockDeleted`).
    - Iteration APIs skip dangling entries instead of throwing `Block not found`.
  - **Structural repairs on the next commit (COL4):** after a remote or undo commit, the next local commit repairs cycles, duplicates and cross-array membership. Orphans are re-homed with `orphan-block-rehomed`.
  - **One nesting route (RI6):** deleting a container deletes its `children` descendants. A conflicting `parentId` is cleared with `nesting-route-conflict`.
  - **Change summaries:** summaries now report the right `block-inserted` / `block-removed` / `block-moved` for concurrent delete-and-move, duplicate entries, replaced `children` arrays and container maps, re-entered containers, and deleted subtrees. Renderers, search and AI indexes no longer keep dead blocks or miss live ones (OB1, COL4). This adds `RawCommitDelta.absentBlockIds` and `arrivedChildArrays`. A block that loses one of two order entries while its map is deleted or not stored is reported `block-removed`, and a block whose map a commit replaced whole reports `block-props-changed` (`"type"` when it changed, plus the arrived map's prop and meta keys). A write a commit listener makes while a remote delivery or undo is being committed now has a summary naming every insert and delete it made; before, a block it moved could be reported removed and some deletes went missing.
  - **Loading (DUR2):** load repair no longer copies nested children into the root order, and no longer removes an entry whose map is in flight.
  - **System-origin writes:** normalization outside an apply runs in one `"system"`-origin transaction, so its repairs leave the undo stack. `setDocumentProfile()` no longer emits `ORIGIN_UNKNOWN`.
  - **Awareness:** `DocumentSession.ensureAwareness(scopeId, factory)` lets the multiplayer extension create its own awareness. The extension now depends on `@input/pen-yjs` and peers on `yjs` and `y-protocols`.

  Breaking: no

- 56b8dfc: Keystrokes, caret moves and structural edits cost in proportion to what they touch, not to document size (SCALE2, SCALE6).

  - **Indexes:**
    - `DocumentState` gains `preorderIndexOf`, `preorderBlockIds`, `rootBlockIds` and `rootBlockIndexOf`.
    - Root and `children` edits advance the position, parent, child and preorder indexes in place instead of rebuilding them.
    - The change-summary index and the normalization pass index advance by each commit's delta.
    - Measured at 50,000 blocks: an insert inside a container drops from about 41 ms to 0.15 ms, and a delete from about 11 ms to 0.3 ms.
  - **Selection reads:** selection validation, anchor resolution, `buildLazyNormalPositionSnapshot` and vertical caret motion no longer read every block.
  - **Scoped decorations:** new `scopedDecorationSource({ interest, decorate })` recomputes only the blocks a commit names. `decorationsChange` passes `(generation, changedBlockIds)`. `requestDecorationUpdate({ source?, blockIds })` targets sources, and with no argument it recomputes only function-form and static sources. AI suggestions and search use scoped sources, so typing with either installed no longer reads the whole document.
  - **Block notifier:** new `fieldEditor.blockNotifier` fans editor events out per block. React (`EditorBlock`, `InlineContent`), Vue (`PenBlock`, `PenInlineContent`) and the vanilla `mountEditor` tree re-render only the blocks whose state changed. Each block acknowledges its own mount. `blocks-merged` carries `sourceParentId` / `sourceIndex`. Its list slices are rebuilt after a commit that moves the document index without a structural change, such as a duplicate-entry repair.
  - **Multiplayer:** remote selection ranges look up positions in O(1).
  - **Normalization:** the structural rules treat the lowest parent id as the container of a block listed in several arrays. Normalized documents are unchanged.

  Breaking: no

- 56b8dfc: Selection, focus and pointer fixes across React, Vue and vanilla `mountEditor`:

  - **Reading and writing the selection**
    - One `selectionchange` reader per root and one projector are the only code that reads or writes the DOM selection (S1).
    - Input edits the editor selection instead of re-reading the DOM.
    - `focus()` on a field with no caret commits one to the record.
    - Every projection reads the selection back. A mismatch emits `selection-projection-mismatch` once and is not rewritten (W3.R1).
    - The backend selection stamps (`FieldEditorSelectionSource`) are gone.
  - **Focus and projection timing**
    - Projections are withheld while an IME composes, while editor chrome holds focus, and while a host control holds focus (HOST9).
    - Undo/redo rebuilds and passive attaches no longer write the native range or steal focus.
  - **New APIs**
    - The selection convenience setters take an optional `SelectionWriteOptions` with `origin` (S3).
    - `FieldEditorImpl.scrollIntoView` and `FieldEditorImpl.setMountRequester` are new. A projection parked on an unmounted block asks the mount requester to mount it. `selection-target-unmounted` is emitted once per park, and `BlockScrollAlign` is added.
    - `FieldEditorImpl.connect()` keeps the field editor live under React Strict Mode.
    - `focusTextSelection` and `useFocusController` run in the calling turn (S4).
  - **Undo, redo and scrolling:** undo and redo scroll the restored selection into view even when the caret did not move. Scroll deltas round to whole pixels.
  - **Ranges over more than 50 blocks (S2):** these ranges, and ranges the engine confines to one field, show a substitute state with the focus sink revealed (`getSubstituteState()`, `pen.a11y.textRangeSelected`). Typing, deleting, IME input and clipboard actions work there.
  - **Fuzzer findings:** S2 cross-block projections now handle code blocks, tables, unit-block gaps, unmounted endpoints and WebKit drags.
  - **Gesture windows:**
    - Gesture windows survive a field switch.
    - `pointercancel` ends a pointer gesture, and drag and context-menu windows close properly (R1).
    - Touch selection handles keep their range (`native-range` window).
    - An EditContext keystroke after `editor.selectText` lands at the new caret (FE9).
  - **Clicks and arrows around atoms and blocks:**
    - A shift-click into another block extends to the offset under the pointer on every binding, including from a block or cell selection and over dividers.
    - Clicking an inline atom puts the caret on the clicked side, following the atom's bidi run (O1, T5).
    - `pen.caretUp` / `pen.caretDown` into a table select its edge cell (T5).
    - A click in a table cell during a text range selects the cell.
  - **Atom layout:** atoms share the text line, and a caret beside a chip takes the line's height. Compositions beside atoms no longer insert U+FFFC.
  - **Table cells:**
    - `CellSelection.text` is in `@input/pen-types`, and an edited cell keeps DOM focus (W3.R18).
    - `Mod-b`/`i`/`u` in a cell fail closed on keydown in every browser (FE6).
    - A table props/meta change no longer resets an edited cell.
    - Backspace and Delete in an edited cell delete the range or one character instead of clearing the cell. `editor.deleteSelection()` on a `CellSelection` with `text` deletes only that range (A1, T6).
  - **Positioned chrome:** the selection toolbar, AI prompt and slash/suggestion menus position from the editor selection, not the live DOM range. `DomScheduler.measureNow` drops geometry stale since the last commit (SCH2).
  - **Focus and activation:**
    - Shift+Tab out of the editor works in Firefox.
    - Overlay focus follows window blur (`bindEditorRootFocus`).
    - The toggle empty state, block-type select and slash-menu table insert activate in the same turn.

  Breaking: no

## 0.2.14

## 0.2.13

## 0.2.12

## 0.2.11

## 0.2.10

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

### Patch Changes

- dcd1573: Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.

## 0.2.5

## 0.2.4

### Patch Changes

- 4ea7542: Count content blocks, not root blocks, when deciding document placeholder eligibility (RI8). A block schema can now declare `authoring.contentRole: "chrome"` for furniture the host puts in the document — an email signature, a quoted message — and such a block no longer suppresses the empty-document placeholder or pulls a click below the blocks into itself. `getBlockContentRole` (`@input/pen-core`) is the canonical reader; `contentRole` defaults to `"content"`, so existing hosts are unaffected.

  Eligibility names its block. `getDocumentPlaceholderTargetBlockId` (`@input/pen-dom`) returns the one block the hint paints on and the click-below caret lands in, or null when there is no target. The React and Vue bindings paint on the target instead of on the first root block, so a document that opens with chrome now shows the hint on its body. `InlinePlaceholderVisibilityOptions` replaces its `isFirstBlock` and `isDocumentEmpty` fields with a single `isDocumentPlaceholderTarget`.

## 0.2.3

## 0.2.2

## 0.2.1

## 0.2.0

## 0.1.9

## 0.1.8

### Patch Changes

- cb50239: Declare BlockSchema serialize, normalize, and validateProps as methods with `this: void` so hosts can detach them without an unbound-method lint error, without breaking BlockSchema assignability.

## 0.1.7

## 0.1.6

### Patch Changes

- d6a3b79: Widen `BlockSuggestion` to the runtime review-item action set and re-export the remaining class vocabulary from `@input/pen-ai`.

  `split-block` and `format-text` are host-reachable suggestions. The published `BlockSuggestion` now matches `PersistentBlockSuggestion`, so an exhaustive host switch cannot miss them. A host that already wrote an exhaustive `switch` over the old four-member union must handle those two members to keep type-checking. `REVIEW_SURFACE_BLOCK_SUGGESTION_CLASSES` is re-exported from `@input/pen-ai` with the other RS4 tokens. `PEN_REVIEW_STYLESHEET` stays on `@input/pen-dom` (API1).

## 0.1.5

### Patch Changes

- c926c5e: Widen `BlockSchema`'s `Content` default from `"inline"` to `ContentType` so nested, `none`, `table`, and `subdocument` blocks are bare `BlockSchema` values and belong in `SchemaRegistry.extend` without a cast (API10). `DefinedBlockSchema.a11y` is now the resolved spec intersected with the AX4 fluent attach, so `defineBlock()` is assignable to `BlockSchema`. Serialize/normalize callbacks on `BlockSchema` use method syntax so a specific `Type` remains assignable to the wide schema.

  This is graded patch, not minor: existing call sites that passed a correct `BlockSchema` still type-check, and hosts that already cast (the previous workaround) can delete the cast. The inference change is that `BlockSchema["content"]` is the `ContentType` union instead of the `"inline"` literal — that is the truthful type, not a break of a documented contract. Same grading as HOST8/HOST9, which shipped a real behavior change as patch with the reason written down; this change is types-only.

- c926c5e: Keep inline atoms in sliced Pen JSON clipboard deltas and rebuild them on paste (IOP7). Add optional `InlineSchema.serialize.toText` and emit atom interchange text through the existing `toMarkdown` / `toHTML` hooks, defaulting to skip when none are set (IOP8).

  Copy now writes embed inserts into the Pen JSON flavor and paste rebuilds them, so an existing host that read or wrote that flavor sees a different clipboard payload. `toText` on `@input/pen-types` is an optional hook. Kept as `patch` so the 0.1.x train stays on `0.1.5`.

## 0.1.4

## 0.1.3

## 0.1.2

### Patch Changes

- e80fedc: Recognize container blocks from the schema and give every surface a children outlet.

  A host-defined container could hold children that no surface rendered. Container-ness was a hardcoded `new Set(["toggle", "callout", "blockquote"])` repeated in the DOM document tree, the DOM navigation utilities, two core command modules, and the React and Vue block renderers, so a host block declaring nested content was recognized by the document model, accepted by `editor.apply`, persisted by the CRDT, and then dropped at render. Nothing reported it: the children existed, `parentOf` resolved, and the block rendered as if empty.

  Containment is now declared. `isContainerBlock` (`@input/pen-core`) treats nested `content` or an explicit `isContainer: true` as containment, `isContainerBlockType` (`@input/pen-core`) resolves it for a block type, and `blockquote`, `callout`, and `toggle` carry the flag rather than being named in the renderers.

  Reading children needed one lookup, because there are two nesting routes and each hid the other. A block's `children` array holds children that are deliberately absent from `blockOrder`; the `parentId` prop holds children that sit in `blockOrder` as siblings. The old helper filtered `blockOrder` on `parentId`, so it could not see children-array children at all. `DocumentState.childrenOf(blockId)` is now the inverse of `parentOf` and covers both, returning children-array order first and `parentId` children in `blockOrder` sequence, backed by an index built in the same `rebuild()` pass that already builds the parent index.

  Each surface exposes one outlet. React gains `Pen.Editor.BlockChildren`, which was the missing half — Vue already passed `ctx.childNodes` to every renderer and the vanilla path already built a children host, so React was the only surface where a custom container renderer had no way to mount its children. Collapse stays the renderer's decision through `shouldRenderContainerChildren`, which reads resolved rather than stored props (`open !== false`), so a container whose `open` defaults to `false` stays collapsed once normalization strips that default from storage — `toggle`'s exact shape, and the reason the predicate cannot read raw storage. DOM navigation calls the same predicate, so keyboard traversal and rendering agree about what is visible.

  Nothing is removed. `@input/pen-dom`'s `getParentIdChildBlockIds` is renamed `getChildBlockIds` on the `./utils/parentIdTree` subpath, since it no longer looks at `parentId`, and the old name stays as a deprecated alias so 0.1.x consumers of that subpath keep working. `@input/pen-vue` picks up children-array support through the same helper with no API change.

  One gap stays stated rather than fixed (`spec/rules/dom.md` RI6): a `parentId` naming a non-container renders nowhere, because `getRootBlockIds` drops every block that has a parent while a non-container is given no children host.

- 3f82c15: Updated playground hosting & docs

## 0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. The shared contract layer for Pen: type definitions, constants, and guards used across the runtime, renderers, and extensions.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
