# @input/pen-core

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
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
