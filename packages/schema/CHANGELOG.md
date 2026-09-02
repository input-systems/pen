# @input/pen-schema

## 0.2.0

### Patch Changes

- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
  - @input/pen-core@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- Updated dependencies [7fb7864]
- Updated dependencies [7fb7864]
  - @input/pen-core@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-types@0.1.8

## 0.1.7

### Patch Changes

- @input/pen-core@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
  - @input/pen-core@0.1.6
  - @input/pen-types@0.1.6

## 0.1.5

### Patch Changes

- c926c5e: Widen `BlockSchema`'s `Content` default from `"inline"` to `ContentType` so nested, `none`, `table`, and `subdocument` blocks are bare `BlockSchema` values and belong in `SchemaRegistry.extend` without a cast (API10). `DefinedBlockSchema.a11y` is now the resolved spec intersected with the AX4 fluent attach, so `defineBlock()` is assignable to `BlockSchema`. Serialize/normalize callbacks on `BlockSchema` use method syntax so a specific `Type` remains assignable to the wide schema.

  This is graded patch, not minor: existing call sites that passed a correct `BlockSchema` still type-check, and hosts that already cast (the previous workaround) can delete the cast. The inference change is that `BlockSchema["content"]` is the `ContentType` union instead of the `"inline"` literal — that is the truthful type, not a break of a documented contract. Same grading as HOST8/HOST9, which shipped a real behavior change as patch with the reason written down; this change is types-only.

- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5

## 0.1.4

### Patch Changes

- @input/pen-core@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- @input/pen-core@0.1.3
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

## 0.1.1

### Patch Changes

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. The default block and inline schema set for Pen.

### Patch Changes

- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
