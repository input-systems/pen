# @input/pen-core

## 0.2.0

### Minor Changes

- e9a3129: Map a container's selection around the block when nested children supply the only inline content, and walk visible nested blocks for document-edge caret so Cmd+Down in an opened quote lands in the last nested paragraph instead of selecting the container. A decoration change on an expanded multi-block surface no longer collapses the cross-block selection into each rebuilt block: element-local selection preservation declines when an endpoint lies outside the element, and the selection is projected back from the editor after the rebuild.

### Patch Changes

- e9a3129: A plain ArrowLeft/ArrowRight on a non-collapsed text selection now collapses it to the range's start or end (T7) instead of trying to step the focus. A select-all followed by ArrowRight previously left the whole document selected because the focus already sat at the document end, so the next keystroke replaced everything.
- @input/pen-yjs@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- 7fb7864: Replace, delete, format, and move the caret through text in nested container children, not only top-level `blockOrder`.
- 7fb7864: Add a smooth-stream extension that paces paint of streamed text while the document stays complete.
- @input/pen-yjs@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- cb50239: Copy enumerable own symbol keys when snapshotting ops for onBeforeApply so opaque owner tokens survive the apply pipeline.
- cb50239: Regenerate `validateProps` from the merged `propSchema` when `override()` adds props without an explicit validator, so apply no longer strips the new props.
- cb50239: Match suggestion-menu triggers in the logical offset domain (inline atoms count as length 1) and expose `removeInlineAtom` plus renderer `interaction.remove`.
- Updated dependencies [cb50239]
  - @input/pen-types@0.1.8
  - @input/pen-yjs@0.1.8

## 0.1.7

### Patch Changes

- @input/pen-yjs@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- d6a3b79: Cut and image drop close the undo capture window the same way paste already does. `clipboardFacet` now merges paste-importer tables (last-wins per key) so multiple providers compose, and the starter HTML clipboard contributes through that facet instead of `assignSlot`.
- Updated dependencies [d6a3b79]
  - @input/pen-types@0.1.6
  - @input/pen-yjs@0.1.6

## 0.1.5

### Patch Changes

- c926c5e: Widen `BlockSchema`'s `Content` default from `"inline"` to `ContentType` so nested, `none`, `table`, and `subdocument` blocks are bare `BlockSchema` values and belong in `SchemaRegistry.extend` without a cast (API10). `DefinedBlockSchema.a11y` is now the resolved spec intersected with the AX4 fluent attach, so `defineBlock()` is assignable to `BlockSchema`. Serialize/normalize callbacks on `BlockSchema` use method syntax so a specific `Type` remains assignable to the wide schema.

  This is graded patch, not minor: existing call sites that passed a correct `BlockSchema` still type-check, and hosts that already cast (the previous workaround) can delete the cast. The inference change is that `BlockSchema["content"]` is the `ContentType` union instead of the `"inline"` literal — that is the truthful type, not a break of a documented contract. Same grading as HOST8/HOST9, which shipped a real behavior change as patch with the reason written down; this change is types-only.

- 67bf230: Reject inline-atom schemas that declare a prop named `type`. Y.Text embed records use `type` as the atom discriminator and flatten props onto the same record, so that prop cannot be stored. Registration now throws at schema build time (SCH1). Hosts that declared the prop should rename it. Kept as `patch` so the 0.1.x train stays on `0.1.5`.
- c926c5e: Escalate a geometry-path vertical caret that lands on a non-text block to `BlockSelection`, matching the logical `crossBlock` path and N2. Hosts whose `setVerticalCaretMeasure` mapped the next line onto a textless block previously got a collapsed text caret there (`anchor-target-missing`, DOM focus on `document.body`). A measured collapsed caret on a table stays a text point so table autocomplete stays enabled. An existing host now receives a `BlockSelection` where this path previously wrote a collapsed text caret. Downstream composers that kept a window-level Enter listener alive only because this path left focus on `document.body` can drop that workaround after they bump. Kept as `patch` so the 0.1.x train stays on `0.1.5`.
- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-yjs@0.1.5

## 0.1.4

### Patch Changes

- @input/pen-yjs@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- @input/pen-yjs@0.1.3
  - @input/pen-types@0.1.3

## 0.1.2

### Patch Changes

- e80fedc: Fix silent content loss when an `insert-block` op names a block that already exists.

  Applying `insert-block` with a live block's id replaced that block's text, props, and meta with empty ones, emitted no diagnostic, and left a document that looked structurally intact. Reproduced on a paragraph holding `"user content"` with `origin: "user"`: after the second insert the block read `""` and its props were `{}`, with zero diagnostics.

  Three things combined to make it silent. Validate's block-existence guard explicitly exempts `insert-block`, since an insert is the one op whose target is expected not to exist yet. The executor then calls `initBlockMap`, which builds a fresh block map and sets it unconditionally rather than checking for an occupant. Normalization's duplicate-order rule finally stripped the second `blockOrder` entry, removing the only externally visible trace.

  Validate now claims a block id once per document: an `insert-block` whose id is already live, or already pending earlier in the same batch, is dropped with `diagnostic { code: "PEN_APPLY_010" }` and the existing block keeps its content. Pending-insert validation is unchanged, so a later op in the same batch may still target a block being inserted (`spec/rules/pipeline.md` PR3).

  The tool surfaces were not exposed and are unchanged: `edit_document`'s `insert_blocks` takes markdown plus a placement, and the standalone `insert_block` tool mints its own id, so a model cannot name the id of a block it inserts. The reachable callers were host code choosing its own ids and a `block-insert` stream part, where a server names the id — which is how this surfaced, since a transport that re-delivers one part destroyed a block. `@input/pen-tools` payload validation still accepts an `insert-block` naming a live block; apply is now the backstop that refuses it.

- e80fedc: Recognize container blocks from the schema and give every surface a children outlet.

  A host-defined container could hold children that no surface rendered. Container-ness was a hardcoded `new Set(["toggle", "callout", "blockquote"])` repeated in the DOM document tree, the DOM navigation utilities, two core command modules, and the React and Vue block renderers, so a host block declaring nested content was recognized by the document model, accepted by `editor.apply`, persisted by the CRDT, and then dropped at render. Nothing reported it: the children existed, `parentOf` resolved, and the block rendered as if empty.

  Containment is now declared. `isContainerBlock` (`@input/pen-core`) treats nested `content` or an explicit `isContainer: true` as containment, `isContainerBlockType` (`@input/pen-core`) resolves it for a block type, and `blockquote`, `callout`, and `toggle` carry the flag rather than being named in the renderers.

  Reading children needed one lookup, because there are two nesting routes and each hid the other. A block's `children` array holds children that are deliberately absent from `blockOrder`; the `parentId` prop holds children that sit in `blockOrder` as siblings. The old helper filtered `blockOrder` on `parentId`, so it could not see children-array children at all. `DocumentState.childrenOf(blockId)` is now the inverse of `parentOf` and covers both, returning children-array order first and `parentId` children in `blockOrder` sequence, backed by an index built in the same `rebuild()` pass that already builds the parent index.

  Each surface exposes one outlet. React gains `Pen.Editor.BlockChildren`, which was the missing half — Vue already passed `ctx.childNodes` to every renderer and the vanilla path already built a children host, so React was the only surface where a custom container renderer had no way to mount its children. Collapse stays the renderer's decision through `shouldRenderContainerChildren`, which reads resolved rather than stored props (`open !== false`), so a container whose `open` defaults to `false` stays collapsed once normalization strips that default from storage — `toggle`'s exact shape, and the reason the predicate cannot read raw storage. DOM navigation calls the same predicate, so keyboard traversal and rendering agree about what is visible.

  Nothing is removed. `@input/pen-dom`'s `getParentIdChildBlockIds` is renamed `getChildBlockIds` on the `./utils/parentIdTree` subpath, since it no longer looks at `parentId`, and the old name stays as a deprecated alias so 0.1.x consumers of that subpath keep working. `@input/pen-vue` picks up children-array support through the same helper with no API change.

  One gap stays stated rather than fixed (`spec/rules/dom.md` RI6): a `parentId` naming a non-container renders nowhere, because `getRootBlockIds` drops every block that has a parent while a non-container is given no children host.

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-types@0.1.2
  - @input/pen-yjs@0.1.2

## 0.1.1

### Patch Changes

- 2f9bbe2: Stop the commit path from re-reading the whole document on every apply.

  Held Backspace felt slow because each keystroke cost time proportional to document size, not to the change (`spec/rules/scale.md` SCALE2). On the SCALE3 realistic-stack bench a keystroke took 0.48ms at 100 blocks and 3.76ms at 1000 — a 7.8× rise for 10× the blocks, so a held key on a large document fell behind auto-repeat. CPU profiling of a 2000-block backspace burst attributed the time to three whole-document passes, all on the per-commit path.

  `createBlockIndexSnapshotFromDocument` (36.6% of profiled time) rebuilt the block index from storage on every Yjs transaction, calling `toString()` on every block's `Y.Text` to recover lengths the commit already knew. The index now advances in place for a text-only commit, applying the splice lengths the change summary carries, and only re-reads the document when a commit changes structure — where the shape genuinely has to come from storage rather than from replayed summaries. The unused `apply(summary)` entry point that tried to replay structure into the index is gone rather than fixed; nothing called it, and reconstructing document shape from a summary is the thing this split is avoiding.

  The normalizer's pass index (40.2%) was discarded and rebuilt from `blockOrder` and every `children` array once per dirty block, then once more at the end of the pass. It is now invalidated where structure actually changes: `SchemaEngineImpl.notifyStructureChanged()`, called by the apply pipeline when it executes an `insert-block`, `delete-block`, or `move-block`, and by the change-summary installer when a remote or undo transaction moves `blockOrder` or a `children` array. That second caller is the one the engine cannot see for itself — normalization runs only inside a local apply, so a peer's structural edit would otherwise be invisible to the next pass's cached index.

  `reportUnknownBlocksInDocument` (8.3%) scanned every block and linearly compared its type against the registry to satisfy `spec/rules/durability.md` DUR3. Validation (PEN_APPLY_002) already rejects a local op carrying an unregistered type, so only a remote update or a load can introduce one, and either changes the block count. The scan is now gated on that count and skipped when it has not moved.

  Also short-circuits `affectedBlockIdsFromSummary`, which built a document-order rank map to sort a list that, on the common commit, holds one id.

  After the fix the same bench reads 0.04ms at 100 blocks and 0.06ms at 1000, and the direct backspace probe is 18.7× faster at 2000 blocks with per-block cost falling rather than flat. Every SCALE3 median now sits below the 0.5ms attribution floor, so a ratio between two of these points would be timer noise. The recorded baselines move and the gate becomes a flat 2ms, which is 4× the floor and below the 3.58–3.76ms the 1000-block rungs cost before the fix; the old 25–50ms slack was wide enough that a full return to per-document commit work would have passed. That leaves 33–50× headroom on this machine class, in the same range as the 10–52× the previous gates carried. The 100-block rung takes the same 2ms rather than something tighter: it cost 0.48ms before the fix, so any gate able to catch a regression there would sit under the attribution floor.

  `@input/pen-core` gains three regression tests that each fail when their own fix is reverted — incremental block lengths (observed through a merge's `joinOffset`), a remote structural change reaching the next local normalization, and an unknown type arriving by remote commit still raising DUR3's diagnostic.

- d67b176: Fix the slash menu inserting the wrong block type.

  `Pen.SlashMenu.List` in auto mode regrouped `items` by `display.group` and handed each option a counter that restarted from the grouped order, while `confirm(index)`, `select(index)`, and `selectedIndex` all index the flat `items` array from `useSlashMenu`. Any schema whose groups are not contiguous in registration order made the two orders disagree, and the default schema is one: it registers `bulletListItem`, `numberedListItem`, and `checkListItem` between `heading` and `codeBlock`, so `basic` resumes after `lists` has started. Choosing Code Block inserted a bullet list, Divider inserted a numbered list, and Quote inserted an image. Arrow-key navigation moved the active option through the flat order too, so the highlight jumped around the rendered list and `aria-activedescendant` named an option other than the visible one, against AX3.

  `useSlashMenu` now returns items already partitioned by group, so the order the menu navigates is the order it renders, and the query path groups after its relevance sort so the closest match stays at index 0. The list builds group headings by breaking consecutive runs instead of regrouping, which means every option carries its real index in `items` and a list that ever saw an ungrouped array would repeat a heading rather than resolve the wrong block.

  The ordering itself is DOM-free and now ships from `@input/pen-core` as `orderSlashMenuItemsByGroup` and `slashMenuGroupOf`, next to `shouldShowBlockInDefaultMenus` and the `allBlockDisplays()` registry it reorders, so a second renderer's slash menu inherits the invariant instead of reimplementing it (API6).

- d67b176: Fix Cmd+Backspace clearing a line visually while the document kept the text.

  On macOS, `Cmd+Backspace` cleared the field and the next keystroke brought the deleted text back. Two gaps lined up. The default keymap bound `Cmd-ArrowLeft` to line motion but never bound `Cmd-Backspace` to the matching delete, so the key fell through to the browser; and the EditContext backend listened only for `textupdate`, so nothing else was watching. Chromium does not route line-granularity deletes through an attached EditContext — it runs them as plain DOM edits against the editing host — so the field emptied while the document still held all eleven characters. The next reconcile repainted the model over the DOM, and the text reappeared.

  The keymap now binds `Cmd-Backspace` (delete to line start) and `Ctrl-k` (delete to line end) on macOS, matching that platform's line motion. Windows and Linux are unchanged; they have no line-delete convention.

  The EditContext backend now runs the B1 `beforeinput` policy as a floor, so an editing intent the EditContext never reports is still claimed by the document rather than left to rewrite the field. The rows Chromium does deliver as `textupdate` — `insertText`, `insertReplacementText`, and the composition types — stay allowed there and only there, because preventing their default cancels the `textupdate` with it and loses the keystroke. Anything unrecognised is prevented and reported as `unhandled-input-type` instead of silently editing the DOM.

  `deleteSoftLineForward` and `deleteHardLineForward` were missing from the shared `beforeinput` table and are now mapped alongside their backward counterparts, so `Ctrl-k` is handled on the contenteditable and expanded backends too.

- Updated dependencies [f4220b9]
  - @input/pen-yjs@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. The headless, extension-first editor engine for human-AI co-authoring: the `editor.apply(ops, { origin })` mutation pipeline, validation, normalization, selection, the extension manager, and the event surface. Runs without a DOM via `createHeadlessEditor`.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- f4e78f9: Index blockOrder membership and child-to-parent links for each normalize pass so `normalizeAll` on envelope-sized documents stays linear instead of scanning the document per block.
- Updated dependencies [e88ceeb]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-types@0.1.0
  - @input/pen-yjs@0.1.0
