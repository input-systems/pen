# @input/pen-vue

## 0.2.0

### Patch Changes

- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
  - @input/pen-core@0.2.0
  - @input/pen-dom@0.2.0
  - @input/pen-interop@0.2.0
  - @input/pen-schema@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- Updated dependencies [7fb7864]
- Updated dependencies [46a28ab]
- Updated dependencies [7fb7864]
  - @input/pen-core@0.1.9
  - @input/pen-dom@0.1.9
  - @input/pen-interop@0.1.9
  - @input/pen-schema@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [cb50239]
- Updated dependencies [d4246d2]
- Updated dependencies [15a7820]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [ff491c2]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-dom@0.1.8
  - @input/pen-interop@0.1.8
  - @input/pen-types@0.1.8
  - @input/pen-schema@0.1.8

## 0.1.7

### Patch Changes

- 56a7f6e: Adopt a default editor chrome stylesheet from PenEditor, EditorRoot, and mountEditor so an empty field fills its block and focus stays visible without host CSS. Opt out with chrome={false}.
- Updated dependencies [56a7f6e]
  - @input/pen-dom@0.1.7
  - @input/pen-core@0.1.7
  - @input/pen-interop@0.1.7
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
  - @input/pen-types@0.1.6
  - @input/pen-schema@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5
  - @input/pen-schema@0.1.5
  - @input/pen-dom@0.1.5
  - @input/pen-interop@0.1.5

## 0.1.4

### Patch Changes

- 9fdb74d: Yield block-selection Enter to the host (HOST8) and keep DOM focus on the editor sink while a block or cell is selected (HOST9). Enter is now a bubbling default like Escape, so a listener on the editor element can preventDefault first; hosts that relied on document-capture Enter will see the key reach the subtree. Focus is parked on the sink in the same selectionChange turn so two composers in one document no longer race for a body-targeted Enter.
- Updated dependencies [9fdb74d]
- Updated dependencies [9fdb74d]
  - @input/pen-dom@0.1.4
  - @input/pen-core@0.1.4
  - @input/pen-interop@0.1.4
  - @input/pen-schema@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- 15ffd4e: Yield the document Escape selection ladder to capture-phase overlays (HOST7). The ladder is now a bubbling default, so a later-mounted menu or host chrome can preventDefault first instead of leaving trigger text behind as a block selection.
- Updated dependencies [7ee119d]
- Updated dependencies [15ffd4e]
- Updated dependencies [15ffd4e]
  - @input/pen-dom@0.1.3
  - @input/pen-core@0.1.3
  - @input/pen-interop@0.1.3
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
  - @input/pen-interop@0.1.2

## 0.1.1

### Patch Changes

- 2f9bbe2: Fix soft breaks rendering as spaces, so a `\n` in a block's text shows up as a line break.

  `pen.insertLineBreak` (Shift+Enter) stores a `\n` in the block's own text, and the markdown ingest keeps single newlines inside a paragraph. Nothing rendered them: text entry surfaces inherited CSS's initial `white-space: normal`, so the browser collapsed every stored newline — and every run of repeated spaces — into a single space. The character was still in the document, still counted by undo and delete, and still exported, but it was invisible on screen and the caret would not move onto it. AI writing showed this most sharply, because the streaming preview renders on a surface that already set `pre-wrap`: text appeared with its line breaks while it streamed and lost them the moment it was applied.

  `white-space: pre-wrap` is now a library-authored inline style on the inline content host and on every table cell content host, in all three renderers, alongside RI1's `unicode-bidi: isolate` and for the same reason. This is correctness rather than taste and is deliberately not overridable by host CSS: a surface that renders its own stored characters incorrectly is not a theme, and HOST6 requires an editor with no host stylesheet to be functional.

  `pre-wrap` honors an interior newline but gives a trailing one no line box, so a field whose text ends with `\n` also gets a trailing `<br>`, maintained by both reconcile paths. Like the empty-block placeholder it is marked (`data-pen-trailing-break`) and contributes no logical length and no logical text, so offset mapping and the DOM/`Y.Text` watchdog read straight through it and it never becomes document content.

  Two consequences for hosts. Ordinary host CSS setting `white-space` on `[data-pen-inline-content]` or a cell content host no longer wins, because an inline style beats a stylesheet rule; a host that genuinely needs another value — a code block wanting `white-space: pre` with horizontal scroll is the real case — needs `!important`. And a field whose text ends with `\n` now has one more child element, which host selectors like `:last-child` or `> *` and any host code walking the surface's children will see.

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
- Updated dependencies [2f9bbe2]
- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [49ff006]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-dom@0.1.1
  - @input/pen-interop@0.1.1
  - @input/pen-schema@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. Vue rendering primitives for Pen, bound to the shared DOM engine.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
  - @input/pen-dom@0.1.0
  - @input/pen-interop@0.1.0
  - @input/pen-schema@0.1.0
