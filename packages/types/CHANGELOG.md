# @input/pen-types

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
