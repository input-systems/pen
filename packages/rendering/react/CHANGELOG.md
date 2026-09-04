# @input/pen-react

## 0.2.1

### Patch Changes

- Updated dependencies [879773c]
- Updated dependencies [ab64f16]
- Updated dependencies [1c57d72]
- Updated dependencies [879773c]
  - @input/pen-ai@0.2.1
  - @input/pen-core@0.2.1
  - @input/pen-dom@0.2.1
  - @input/pen-multiplayer@0.2.1
  - @input/pen-search@0.2.1
  - @input/pen-interop@0.2.1
  - @input/pen-shortcuts@0.2.1
  - @input/pen-snapshots@0.2.1
  - @input/pen-schema@0.2.1
  - @input/pen-types@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
  - @input/pen-core@0.2.0
  - @input/pen-ai@0.2.0
  - @input/pen-dom@0.2.0
  - @input/pen-interop@0.2.0
  - @input/pen-multiplayer@0.2.0
  - @input/pen-search@0.2.0
  - @input/pen-shortcuts@0.2.0
  - @input/pen-snapshots@0.2.0
  - @input/pen-schema@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- Updated dependencies [7fb7864]
- Updated dependencies [46a28ab]
- Updated dependencies [7fb7864]
  - @input/pen-core@0.1.9
  - @input/pen-dom@0.1.9
  - @input/pen-ai@0.1.9
  - @input/pen-multiplayer@0.1.9
  - @input/pen-search@0.1.9
  - @input/pen-interop@0.1.9
  - @input/pen-shortcuts@0.1.9
  - @input/pen-snapshots@0.1.9
  - @input/pen-schema@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- cb50239: Match suggestion-menu triggers in the logical offset domain (inline atoms count as length 1) and expose `removeInlineAtom` plus renderer `interaction.remove`.
- Updated dependencies [cb50239]
- Updated dependencies [d4246d2]
- Updated dependencies [cb50239]
- Updated dependencies [15a7820]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [ff491c2]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-dom@0.1.8
  - @input/pen-ai@0.1.8
  - @input/pen-interop@0.1.8
  - @input/pen-types@0.1.8
  - @input/pen-multiplayer@0.1.8
  - @input/pen-search@0.1.8
  - @input/pen-shortcuts@0.1.8
  - @input/pen-snapshots@0.1.8
  - @input/pen-schema@0.1.8

## 0.1.7

### Patch Changes

- 56a7f6e: Adopt a default editor chrome stylesheet from PenEditor, EditorRoot, and mountEditor so an empty field fills its block and focus stays visible without host CSS. Opt out with chrome={false}.
- Updated dependencies [56a7f6e]
  - @input/pen-dom@0.1.7
  - @input/pen-core@0.1.7
  - @input/pen-ai@0.1.7
  - @input/pen-interop@0.1.7
  - @input/pen-multiplayer@0.1.7
  - @input/pen-search@0.1.7
  - @input/pen-shortcuts@0.1.7
  - @input/pen-snapshots@0.1.7
  - @input/pen-schema@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
  - @input/pen-interop@0.1.6
  - @input/pen-core@0.1.6
  - @input/pen-dom@0.1.6
  - @input/pen-ai@0.1.6
  - @input/pen-types@0.1.6
  - @input/pen-multiplayer@0.1.6
  - @input/pen-search@0.1.6
  - @input/pen-shortcuts@0.1.6
  - @input/pen-snapshots@0.1.6
  - @input/pen-schema@0.1.6

## 0.1.5

### Patch Changes

- 67bf230: Keep `InlineAtomRenderInteractionProps` imported in the published `@input/pen-react` declarations so `InlineAtomRenderProps.interaction` type-checks with `skipLibCheck: false`.
- c926c5e: Mount inline-atom portal renderers with `createElement` so host renderers that call hooks keep a stable hook order when an atom appears after the first paint.
- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5
  - @input/pen-schema@0.1.5
  - @input/pen-dom@0.1.5
  - @input/pen-ai@0.1.5
  - @input/pen-multiplayer@0.1.5
  - @input/pen-search@0.1.5
  - @input/pen-shortcuts@0.1.5
  - @input/pen-snapshots@0.1.5
  - @input/pen-interop@0.1.5

## 0.1.4

### Patch Changes

- 9fdb74d: Yield block-selection Enter to the host (HOST8) and keep DOM focus on the editor sink while a block or cell is selected (HOST9). Enter is now a bubbling default like Escape, so a listener on the editor element can preventDefault first; hosts that relied on document-capture Enter will see the key reach the subtree. Focus is parked on the sink in the same selectionChange turn so two composers in one document no longer race for a body-targeted Enter.
- Updated dependencies [9fdb74d]
- Updated dependencies [9fdb74d]
  - @input/pen-dom@0.1.4
  - @input/pen-core@0.1.4
  - @input/pen-ai@0.1.4
  - @input/pen-interop@0.1.4
  - @input/pen-multiplayer@0.1.4
  - @input/pen-search@0.1.4
  - @input/pen-shortcuts@0.1.4
  - @input/pen-snapshots@0.1.4
  - @input/pen-schema@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- 15ffd4e: Yield the document Escape selection ladder to capture-phase overlays (HOST7). The ladder is now a bubbling default, so a later-mounted menu or host chrome can preventDefault first instead of leaving trigger text behind as a block selection.
- 7ee119d: Forward host `extraAttributes` and `data-*` through numbered list items onto `ListItemLayout` so composed renderers can paint alignment and other attributes without dropping the ordered-list marker or `start` (HB8). Export `ListItemHostAttributes` as the host-facing shape for cloning a default list-item renderer.

  `ListItemLayout` now writes host attributes before its own, so a host can no longer overwrite `data-block-type`, `data-indent`, `data-selected`, `data-pen-list-item-layout`, `data-counter`, or `data-checked`. This also fixes check list items, where a host `extraAttributes` replaced the renderer's prop wholesale and silently dropped `data-checked`.

- Updated dependencies [7ee119d]
- Updated dependencies [15ffd4e]
- Updated dependencies [15ffd4e]
  - @input/pen-dom@0.1.3
  - @input/pen-core@0.1.3
  - @input/pen-ai@0.1.3
  - @input/pen-interop@0.1.3
  - @input/pen-multiplayer@0.1.3
  - @input/pen-search@0.1.3
  - @input/pen-shortcuts@0.1.3
  - @input/pen-snapshots@0.1.3
  - @input/pen-schema@0.1.3
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
  - @input/pen-schema@0.1.2
  - @input/pen-dom@0.1.2
  - @input/pen-ai@0.1.2
  - @input/pen-interop@0.1.2
  - @input/pen-multiplayer@0.1.2
  - @input/pen-search@0.1.2
  - @input/pen-shortcuts@0.1.2
  - @input/pen-snapshots@0.1.2

## 0.1.1

### Patch Changes

- d67b176: Fix a collaboration crash where a peer's block selection unmounted the editor.

  `mergeBlockDecorationAttributes` in `@input/pen-react` turned a block decoration's attribute bag into props on the block host without the SEC2 skip that `applyElementAttributes` applies to inline decorations. `@input/pen-multiplayer` puts a `style` attribute on remote presence decorations, so a peer selecting a block sent a CSS string into a React `style` prop and React threw out of the commit phase, taking the editor's root with it. The React helper now skips `/^on/i`, `style`, and `dangerouslySetInnerHTML`, the last of which crashed the same way and is a markup sink only a React prop can reach. Dropping `style` also keeps RI1's `unicode-bidi: isolate` on the block host. `createRemotePresenceAttributes` no longer emits the `style` attribute that every conforming renderer discarded: style presence through `data-user-id`, and peer caret colour still comes from `RemoteCursorState.user.color`.

- d67b176: Show collaborators inside tables.

  A peer editing a table was invisible. `buildLocalAwarenessState` only recognised text and block selections, so a `CellSelection` fell through to `{ cursor: null, selection: null }` and nothing was published — and nothing downstream knew cells existed either, since `RemoteSelectionState` had no cell member.

  Cell selections now travel as `{ kind: "cell", blockId, anchor, head, clock }` with `{ row, col }` endpoints and no cursor: a grid cell is the smallest region this presence names, so there is no caret to place, and coordinates rather than anchors match AS3's structural treatment of the local cell selection. COL2 validates them against the live grid — a cell on a block that holds no grid, or a row or column outside it, is rejected at ingest with the new `out-of-range-cell` reason — and resolve re-reads the grid on every commit so a peer whose rows were deleted under them clamps onto a live cell instead of vanishing.

  `@input/pen-react`'s table renderer marks the occupied cells with `data-pen-multiplayer-cell-selection`, the peer's head cell with `data-pen-multiplayer-cell-head`, and sets the caret overlay's `--pen-peer-color` on each. Because these come from the renderer rather than a presence decoration, they can carry a colour at all: SEC2 drops `style` from decoration attributes, so presence decorations emit none and every other surface is coloured from `data-user-id`. Hosts rendering their own grid can resolve the same mapping with `resolveRemoteCellPresence`, new on `@input/pen-dom/utils/remoteCellSelection` and re-exported from `@input/pen-react`.

  Both `RemoteSelectionState` and `PresenceRejectionReason` gain a member, so an exhaustive `switch` over either needs a new arm.

- 2f9bbe2: Fix soft breaks rendering as spaces, so a `\n` in a block's text shows up as a line break.

  `pen.insertLineBreak` (Shift+Enter) stores a `\n` in the block's own text, and the markdown ingest keeps single newlines inside a paragraph. Nothing rendered them: text entry surfaces inherited CSS's initial `white-space: normal`, so the browser collapsed every stored newline — and every run of repeated spaces — into a single space. The character was still in the document, still counted by undo and delete, and still exported, but it was invisible on screen and the caret would not move onto it. AI writing showed this most sharply, because the streaming preview renders on a surface that already set `pre-wrap`: text appeared with its line breaks while it streamed and lost them the moment it was applied.

  `white-space: pre-wrap` is now a library-authored inline style on the inline content host and on every table cell content host, in all three renderers, alongside RI1's `unicode-bidi: isolate` and for the same reason. This is correctness rather than taste and is deliberately not overridable by host CSS: a surface that renders its own stored characters incorrectly is not a theme, and HOST6 requires an editor with no host stylesheet to be functional.

  `pre-wrap` honors an interior newline but gives a trailing one no line box, so a field whose text ends with `\n` also gets a trailing `<br>`, maintained by both reconcile paths. Like the empty-block placeholder it is marked (`data-pen-trailing-break`) and contributes no logical length and no logical text, so offset mapping and the DOM/`Y.Text` watchdog read straight through it and it never becomes document content.

  Two consequences for hosts. Ordinary host CSS setting `white-space` on `[data-pen-inline-content]` or a cell content host no longer wins, because an inline style beats a stylesheet rule; a host that genuinely needs another value — a code block wanting `white-space: pre` with horizontal scroll is the real case — needs `!important`. And a field whose text ends with `\n` now has one more child element, which host selectors like `:last-child` or `> *` and any host code walking the surface's children will see.

- d67b176: Fix the slash menu inserting the wrong block type.

  `Pen.SlashMenu.List` in auto mode regrouped `items` by `display.group` and handed each option a counter that restarted from the grouped order, while `confirm(index)`, `select(index)`, and `selectedIndex` all index the flat `items` array from `useSlashMenu`. Any schema whose groups are not contiguous in registration order made the two orders disagree, and the default schema is one: it registers `bulletListItem`, `numberedListItem`, and `checkListItem` between `heading` and `codeBlock`, so `basic` resumes after `lists` has started. Choosing Code Block inserted a bullet list, Divider inserted a numbered list, and Quote inserted an image. Arrow-key navigation moved the active option through the flat order too, so the highlight jumped around the rendered list and `aria-activedescendant` named an option other than the visible one, against AX3.

  `useSlashMenu` now returns items already partitioned by group, so the order the menu navigates is the order it renders, and the query path groups after its relevance sort so the closest match stays at index 0. The list builds group headings by breaking consecutive runs instead of regrouping, which means every option carries its real index in `items` and a list that ever saw an ungrouped array would repeat a heading rather than resolve the wrong block.

  The ordering itself is DOM-free and now ships from `@input/pen-core` as `orderSlashMenuItemsByGroup` and `slashMenuGroupOf`, next to `shouldShowBlockInDefaultMenus` and the `allBlockDisplays()` registry it reorders, so a second renderer's slash menu inherits the invariant instead of reimplementing it (API6).

- 49ff006: Fix the slash menu leaving its trigger text in the document.

  Confirming an entry only deleted the trigger when the block held a lone `/`. Any query took the sibling-insert branch instead, so picking Table after typing `/ta` left a `/ta` paragraph above the new table — the block the author was converting survived as litter. It was also AX3-visible: `getSlashTarget` matches any block whose text starts with `/`, so the listbox reopened as soon as selection returned to the leftover paragraph.

  `confirm` now deletes the whole trigger range — `/` and query together, read from the live document — in the same undo group that installs the chosen block, and decides its shape from what is left over: nothing left means the trigger was the whole block, so the block is converted in place; text left over (a caret parked mid-word, or a confirm with no trigger, which is how a host-supplied `SlashMenu.Input` drives the hook) keeps its block and inserts the chosen type as a sibling.

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
- Updated dependencies [2f9bbe2]
- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [49ff006]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-dom@0.1.1
  - @input/pen-multiplayer@0.1.1
  - @input/pen-ai@0.1.1
  - @input/pen-search@0.1.1
  - @input/pen-snapshots@0.1.1
  - @input/pen-interop@0.1.1
  - @input/pen-shortcuts@0.1.1
  - @input/pen-schema@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. React primitives, hooks, and renderers for Pen, bound to the shared DOM engine.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
  - @input/pen-dom@0.1.0
  - @input/pen-ai@0.1.0
  - @input/pen-interop@0.1.0
  - @input/pen-shortcuts@0.1.0
  - @input/pen-multiplayer@0.1.0
  - @input/pen-schema@0.1.0
  - @input/pen-search@0.1.0
  - @input/pen-snapshots@0.1.0
