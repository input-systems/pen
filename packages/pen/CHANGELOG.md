# @input/pen

## 0.2.1

### Patch Changes

- Updated dependencies [879773c]
- Updated dependencies [ab64f16]
  - @input/pen-ai@0.2.1
  - @input/pen-core@0.2.1
  - @input/pen-interop@0.2.1
  - @input/pen-shortcuts@0.2.1
  - @input/pen-tools@0.2.1
  - @input/pen-undo@0.2.1
  - @input/pen-schema@0.2.1
  - @input/pen-types@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
  - @input/pen-core@0.2.0
  - @input/pen-ai@0.2.0
  - @input/pen-interop@0.2.0
  - @input/pen-shortcuts@0.2.0
  - @input/pen-tools@0.2.0
  - @input/pen-undo@0.2.0
  - @input/pen-schema@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- 7fb7864: Add a smooth-stream extension that paces paint of streamed text while the document stays complete.
- Updated dependencies [7fb7864]
- Updated dependencies [7fb7864]
  - @input/pen-core@0.1.9
  - @input/pen-ai@0.1.9
  - @input/pen-interop@0.1.9
  - @input/pen-shortcuts@0.1.9
  - @input/pen-tools@0.1.9
  - @input/pen-undo@0.1.9
  - @input/pen-schema@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-ai@0.1.8
  - @input/pen-tools@0.1.8
  - @input/pen-interop@0.1.8
  - @input/pen-types@0.1.8
  - @input/pen-shortcuts@0.1.8
  - @input/pen-undo@0.1.8
  - @input/pen-schema@0.1.8

## 0.1.7

### Patch Changes

- @input/pen-core@0.1.7
  - @input/pen-ai@0.1.7
  - @input/pen-interop@0.1.7
  - @input/pen-shortcuts@0.1.7
  - @input/pen-tools@0.1.7
  - @input/pen-undo@0.1.7
  - @input/pen-schema@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- d6a3b79: Cut and image drop close the undo capture window the same way paste already does. `clipboardFacet` now merges paste-importer tables (last-wins per key) so multiple providers compose, and the starter HTML clipboard contributes through that facet instead of `assignSlot`.
- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
  - @input/pen-interop@0.1.6
  - @input/pen-core@0.1.6
  - @input/pen-ai@0.1.6
  - @input/pen-types@0.1.6
  - @input/pen-shortcuts@0.1.6
  - @input/pen-tools@0.1.6
  - @input/pen-undo@0.1.6
  - @input/pen-schema@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5
  - @input/pen-schema@0.1.5
  - @input/pen-ai@0.1.5
  - @input/pen-shortcuts@0.1.5
  - @input/pen-tools@0.1.5
  - @input/pen-undo@0.1.5
  - @input/pen-interop@0.1.5

## 0.1.4

### Patch Changes

- @input/pen-core@0.1.4
  - @input/pen-ai@0.1.4
  - @input/pen-interop@0.1.4
  - @input/pen-shortcuts@0.1.4
  - @input/pen-tools@0.1.4
  - @input/pen-undo@0.1.4
  - @input/pen-schema@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- @input/pen-core@0.1.3
  - @input/pen-ai@0.1.3
  - @input/pen-interop@0.1.3
  - @input/pen-shortcuts@0.1.3
  - @input/pen-tools@0.1.3
  - @input/pen-undo@0.1.3
  - @input/pen-schema@0.1.3
  - @input/pen-types@0.1.3

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [e80fedc]
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-core@0.1.2
  - @input/pen-types@0.1.2
  - @input/pen-schema@0.1.2
  - @input/pen-ai@0.1.2
  - @input/pen-interop@0.1.2
  - @input/pen-shortcuts@0.1.2
  - @input/pen-tools@0.1.2
  - @input/pen-undo@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-ai@0.1.1
  - @input/pen-undo@0.1.1
  - @input/pen-tools@0.1.1
  - @input/pen-interop@0.1.1
  - @input/pen-shortcuts@0.1.1
  - @input/pen-schema@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- 78d0efd: First public release. The batteries-included starter for Pen. `createEditor` and `createHeadlessEditor` default an omitted `preset` to `defaultPreset()`, which assembles the default schema, document tools, delta stream, undo, rich-text shortcuts, and HTML clipboard, so the quickstart is one import and a bare `createEditor()`. Explicit `preset`, `schema`, and `extensions` pass through unchanged; `@input/pen-core` remains the bare, preset-free constructor.

### Patch Changes

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
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
  - @input/pen-ai@0.1.0
  - @input/pen-interop@0.1.0
  - @input/pen-tools@0.1.0
  - @input/pen-undo@0.1.0
  - @input/pen-shortcuts@0.1.0
  - @input/pen-schema@0.1.0
