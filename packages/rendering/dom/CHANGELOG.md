# @input/pen-dom

## 0.1.8

### Patch Changes

- d4246d2: Skip selection projection while a native text input outside the editor owns focus so host fields like composer To keep the caret.
- 15a7820: Target the adjacent line's vertical midpoint for caret up/down so ArrowUp in a full-width RTL field does not stay on the current block.
- ff491c2: Fix the a11y focus sink drawing a visible focus ring when a block or cell selection is active.
- cb50239: Match suggestion-menu triggers in the logical offset domain (inline atoms count as length 1) and expose `removeInlineAtom` plus renderer `interaction.remove`.
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-types@0.1.8
  - @input/pen-shortcuts@0.1.8

## 0.1.7

### Patch Changes

- 56a7f6e: Adopt a default editor chrome stylesheet from PenEditor, EditorRoot, and mountEditor so an empty field fills its block and focus stays visible without host CSS. Opt out with chrome={false}.
- @input/pen-core@0.1.7
  - @input/pen-shortcuts@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- d6a3b79: Cut and image drop close the undo capture window the same way paste already does. `clipboardFacet` now merges paste-importer tables (last-wins per key) so multiple providers compose, and the starter HTML clipboard contributes through that facet instead of `assignSlot`.
- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
  - @input/pen-core@0.1.6
  - @input/pen-types@0.1.6
  - @input/pen-shortcuts@0.1.6

## 0.1.5

### Patch Changes

- c926c5e: Keep inline atoms in sliced Pen JSON clipboard deltas and rebuild them on paste (IOP7). Add optional `InlineSchema.serialize.toText` and emit atom interchange text through the existing `toMarkdown` / `toHTML` hooks, defaulting to skip when none are set (IOP8).

  Copy now writes embed inserts into the Pen JSON flavor and paste rebuilds them, so an existing host that read or wrote that flavor sees a different clipboard payload. `toText` on `@input/pen-types` is an optional hook. Kept as `patch` so the 0.1.x train stays on `0.1.5`.

- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5
  - @input/pen-shortcuts@0.1.5

## 0.1.4

### Patch Changes

- 9fdb74d: Yield block-selection Enter to the host (HOST8) and keep DOM focus on the editor sink while a block or cell is selected (HOST9). Enter is now a bubbling default like Escape, so a listener on the editor element can preventDefault first; hosts that relied on document-capture Enter will see the key reach the subtree. Focus is parked on the sink in the same selectionChange turn so two composers in one document no longer race for a body-targeted Enter.
- 9fdb74d: Start a pointer selection from host chrome (FE10). A drag whose mousedown lands beside the column — the content element's padding, or the editor root next to it — now anchors at the nearest block edge (G4) and selects, across blocks or within one, instead of leaving a collapsed caret. Within one block it resolves the range itself, because a drag that never entered a field has no native range to inherit. Clicks are unchanged: a host-chrome gesture that never reached a block still finishes on the click path, so the click-outside affordance keeps owning insert-or-focus. A host asserting that a drag from the background leaves the selection untouched will now see a text selection; a marquee still requires the region-selector primitive and still respects `blockSelection={false}`.
- @input/pen-core@0.1.4
  - @input/pen-shortcuts@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- 7ee119d: Render all three colour marks (`textColor`, `backgroundColor`, `highlight`) through a `var()` fallback and `data-color`, so on-screen colour paints by default and hosts can remap opaque tokens without `!important` (RI7). `textColor` and `backgroundColor` previously fell through to the unknown-mark span and dropped the stored colour entirely.

  The paint is an inline style: a host rule that set `color` or `background-color` on the mark itself used to apply and no longer does. Set `--pen-text-color`, `--pen-background-color`, or `--pen-highlight-color` on the mark instead — see `STYLING.md`. Export and clipboard HTML are unaffected; both come from `schema.serialize.toHTML` and still carry the stored value. Kept as `patch` so the 0.1.x train stays on `0.1.3`.

- 15ffd4e: On A5 mapped `selectionChange` after `editor.apply`, drop leftover `edit-context-textupdate` authority and project the remapped caret into EditContext (FE9), so the next keystroke inserts at the remapped offset instead of clamping or landing in the wrong place.
- 15ffd4e: Yield the document Escape selection ladder to capture-phase overlays (HOST7). The ladder is now a bubbling default, so a later-mounted menu or host chrome can preventDefault first instead of leaving trigger text behind as a block selection.
- @input/pen-core@0.1.3
  - @input/pen-shortcuts@0.1.3
  - @input/pen-types@0.1.3

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
- Updated dependencies [e80fedc]
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-core@0.1.2
  - @input/pen-types@0.1.2
  - @input/pen-shortcuts@0.1.2

## 0.1.1

### Patch Changes

- d67b176: Fix collaborator carets staying pinned in place while the document scrolls.

  `GeometryReader` caches caret and range rects per block, keyed by the block's commit id plus the viewport-resize and font-load generations (G2). Those rects come from `Range.getClientRects()` and `getBoundingClientRect()`, so they are viewport-relative — and scrolling changed none of the three key parts. After a scroll the reader kept returning the coordinates measured before it, and overlays that paint at those coordinates stayed where they were. `Pen.Multiplayer.CaretOverlay` showed this most clearly: a peer's caret and name label sat at a fixed spot on screen while their block moved away underneath. `Pen.Editor.CaretOverlay` and the selection-rect overlay read through the same cache and drifted the same way.

  The G2 key now carries a scroll generation, bumped by a capture-phase `scroll` listener on the root's document — capture because `scroll` does not bubble, and a scroller nested inside the editor moves cached rects just as an ancestor one does. A scroll in a container that neither contains nor is contained by the root cannot move the root, so it leaves the cache warm. `GeometryReaderOptions.observeScroll` opts out, alongside the existing `observeResize` and `observeFonts`.

  `dispose()` removes the listener, and because nothing calls `dispose()` in production today the listener also drops itself the first time it fires with a disconnected root. A document-level listener that only waited for `dispose()` would keep every unmounted editor root and its cache reachable.

- d67b176: Show collaborators inside tables.

  A peer editing a table was invisible. `buildLocalAwarenessState` only recognised text and block selections, so a `CellSelection` fell through to `{ cursor: null, selection: null }` and nothing was published — and nothing downstream knew cells existed either, since `RemoteSelectionState` had no cell member.

  Cell selections now travel as `{ kind: "cell", blockId, anchor, head, clock }` with `{ row, col }` endpoints and no cursor: a grid cell is the smallest region this presence names, so there is no caret to place, and coordinates rather than anchors match AS3's structural treatment of the local cell selection. COL2 validates them against the live grid — a cell on a block that holds no grid, or a row or column outside it, is rejected at ingest with the new `out-of-range-cell` reason — and resolve re-reads the grid on every commit so a peer whose rows were deleted under them clamps onto a live cell instead of vanishing.

  `@input/pen-react`'s table renderer marks the occupied cells with `data-pen-multiplayer-cell-selection`, the peer's head cell with `data-pen-multiplayer-cell-head`, and sets the caret overlay's `--pen-peer-color` on each. Because these come from the renderer rather than a presence decoration, they can carry a colour at all: SEC2 drops `style` from decoration attributes, so presence decorations emit none and every other surface is coloured from `data-user-id`. Hosts rendering their own grid can resolve the same mapping with `resolveRemoteCellPresence`, new on `@input/pen-dom/utils/remoteCellSelection` and re-exported from `@input/pen-react`.

  Both `RemoteSelectionState` and `PresenceRejectionReason` gain a member, so an exhaustive `switch` over either needs a new arm.

- 2f9bbe2: Fix the caret briefly showing at its previous position after a mouse click in Chromium.

  Clicking inside the block that already held the caret moved the caret to the old position for the whole time the button was held, then jumped it to the click point on release. Measured on a 90ms hold, the caret rendered at the stale position for 10 of the 11 frames. Clicking into a different block, or into a document with no caret yet, was unaffected — which is why it read as intermittent.

  `EditContextBackend` treats a collapsed DOM selection that disagrees with the authority as a stale echo of its own `updateSelection` write and restores the authority caret. That is the right reading of a divergence nobody asked for, but it was applied unconditionally, including to the `selectionchange` the browser fires when the user clicks — the pointer window is open, the authority still holds the pre-click caret, and the two look identical to the guard. The restore beat the reader's proposal, so the DOM was dragged back to the old caret and only the pointer-settled projection put it right.

  The guard now defers to gesture-window admissibility, matching `spec/rules/selection.md` R3 and the reader algorithm's step 4/5 split: with a window open the proposal is user intent and the reader owns it, so the guard stands down. It consults `isAdmissibleGestureRead()`, the same predicate the reader uses to choose between accepting and diverging, rather than approximating that decision a second time — and the same check `reconcilerFull` already uses to hold off divergence projection during a gesture. `@input/pen-react` gains a regression test covering the same-block click.

  This narrows the guard to the closed-window case; it does not make that case correct. A backend that answers divergence by writing the DOM selection itself still sidesteps the projector, which S1 makes the only component allowed to write it and which P2 routes divergence through so the write is verified and a mismatch is reported. Closing that properly means replacing the restore with a divergence-projection request and folding this predicate onto the stamp-based one the projection controller already owns, which is left to the bridge redesign that `spec/rules/selection.md` and `spec/packages/rendering/dom.md` already flag.

- 2f9bbe2: Fix soft breaks rendering as spaces, so a `\n` in a block's text shows up as a line break.

  `pen.insertLineBreak` (Shift+Enter) stores a `\n` in the block's own text, and the markdown ingest keeps single newlines inside a paragraph. Nothing rendered them: text entry surfaces inherited CSS's initial `white-space: normal`, so the browser collapsed every stored newline — and every run of repeated spaces — into a single space. The character was still in the document, still counted by undo and delete, and still exported, but it was invisible on screen and the caret would not move onto it. AI writing showed this most sharply, because the streaming preview renders on a surface that already set `pre-wrap`: text appeared with its line breaks while it streamed and lost them the moment it was applied.

  `white-space: pre-wrap` is now a library-authored inline style on the inline content host and on every table cell content host, in all three renderers, alongside RI1's `unicode-bidi: isolate` and for the same reason. This is correctness rather than taste and is deliberately not overridable by host CSS: a surface that renders its own stored characters incorrectly is not a theme, and HOST6 requires an editor with no host stylesheet to be functional.

  `pre-wrap` honors an interior newline but gives a trailing one no line box, so a field whose text ends with `\n` also gets a trailing `<br>`, maintained by both reconcile paths. Like the empty-block placeholder it is marked (`data-pen-trailing-break`) and contributes no logical length and no logical text, so offset mapping and the DOM/`Y.Text` watchdog read straight through it and it never becomes document content.

  Two consequences for hosts. Ordinary host CSS setting `white-space` on `[data-pen-inline-content]` or a cell content host no longer wins, because an inline style beats a stylesheet rule; a host that genuinely needs another value — a code block wanting `white-space: pre` with horizontal scroll is the real case — needs `!important`. And a field whose text ends with `\n` now has one more child element, which host selectors like `:last-child` or `> *` and any host code walking the surface's children will see.

- 49ff006: Fix the slash menu leaving its trigger text in the document.

  Confirming an entry only deleted the trigger when the block held a lone `/`. Any query took the sibling-insert branch instead, so picking Table after typing `/ta` left a `/ta` paragraph above the new table — the block the author was converting survived as litter. It was also AX3-visible: `getSlashTarget` matches any block whose text starts with `/`, so the listbox reopened as soon as selection returned to the leftover paragraph.

  `confirm` now deletes the whole trigger range — `/` and query together, read from the live document — in the same undo group that installs the chosen block, and decides its shape from what is left over: nothing left means the trigger was the whole block, so the block is converted in place; text left over (a caret parked mid-word, or a confirm with no trigger, which is how a host-supplied `SlashMenu.Input` drives the hook) keeps its block and inserts the chosen type as a sibling.

- d67b176: Fix Cmd+Backspace clearing a line visually while the document kept the text.

  On macOS, `Cmd+Backspace` cleared the field and the next keystroke brought the deleted text back. Two gaps lined up. The default keymap bound `Cmd-ArrowLeft` to line motion but never bound `Cmd-Backspace` to the matching delete, so the key fell through to the browser; and the EditContext backend listened only for `textupdate`, so nothing else was watching. Chromium does not route line-granularity deletes through an attached EditContext — it runs them as plain DOM edits against the editing host — so the field emptied while the document still held all eleven characters. The next reconcile repainted the model over the DOM, and the text reappeared.

  The keymap now binds `Cmd-Backspace` (delete to line start) and `Ctrl-k` (delete to line end) on macOS, matching that platform's line motion. Windows and Linux are unchanged; they have no line-delete convention.

  The EditContext backend now runs the B1 `beforeinput` policy as a floor, so an editing intent the EditContext never reports is still claimed by the document rather than left to rewrite the field. The rows Chromium does deliver as `textupdate` — `insertText`, `insertReplacementText`, and the composition types — stay allowed there and only there, because preventing their default cancels the `textupdate` with it and loses the keystroke. Anything unrecognised is prevented and reported as `unhandled-input-type` instead of silently editing the DOM.

  `deleteSoftLineForward` and `deleteHardLineForward` were missing from the shared `beforeinput` table and are now mapped alongside their backward counterparts, so `Ctrl-k` is handled on the contenteditable and expanded backends too.

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-shortcuts@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. The framework-free DOM engine for Pen: field editors (EditContext and contenteditable backends), the selection bridge, key handling, clipboard and transfer, reconciliation, and overlays.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
  - @input/pen-shortcuts@0.1.0
