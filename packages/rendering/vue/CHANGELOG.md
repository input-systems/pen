# @input/pen-vue

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [3f82c15]
  - @input/pen-core@0.1.2
  - @input/pen-dom@0.1.2
  - @input/pen-interop@0.1.2
  - @input/pen-schema@0.1.2
  - @input/pen-types@0.1.2

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
