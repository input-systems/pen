# @input/pen-yjs

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [3f82c15]
  - @input/pen-types@0.1.2

## 0.1.1

### Patch Changes

- f4220b9: Report a block that arrives carrying content as an insert of that content, so a peer's split repairs anchors instead of stranding them.

  Yjs leaves a type created inside a transaction out of `txn.changed`. A block whose text is written at construction — a split's tail block, an import, a paste — therefore produced no text delta at all, and `createSummarySource` had nothing to report: observers saw the block appear and its text arrive from nowhere.

  AN14 says a remote peer's split repairs a local position, deriving the move from "same-length delete/insert pairing across blocks". The pairing could never fire. A split reaches the receiving peer as a delete on the source block and a new block whose content was invisible, so `deriveContentMoves` saw a delete with nothing to pair it against and returned no move. Every anchor in the moved range stayed on the source block at the cut offset — including the write head core's `openTextStream` holds, which is why the rule was written in the first place. The only coverage was a hand-built summary carrying an insert splice that a real remote split never produces.

  The gate for reporting the text is the block's entry changing on the `blocks` map, so a reorder — which touches only the order arrays — never restates existing text as an insert. This also corrects the block index, which had been recording a newly arrived block's length as zero.

- @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. The Yjs CRDT adapter for Pen: document shape (`blockOrder`, `blocks`, `apps`, `metadata`), transactions, update handling, and undo integration.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [a022804]
  - @input/pen-types@0.1.0
