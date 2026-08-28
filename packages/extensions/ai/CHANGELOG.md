# @input/pen-ai

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [3f82c15]
  - @input/pen-core@0.1.2
  - @input/pen-ingest@0.1.2
  - @input/pen-tools@0.1.2
  - @input/pen-types@0.1.2

## 0.1.1

### Patch Changes

- d67b176: Fix AI generations losing their text when a collaborator types in the same block, and make a peer's AI run visible.

  Two separate faults met in the same block. `handleExternalCommit` cancels an active generation when a non-AI commit touches the block being written, which is right for the local user taking the keyboard back, but every update arriving through `applyUpdate` is `origin: "collaborator"` (COL1) and those were cancelling too. A peer typing anywhere in the block killed the run mid-stream and the model's remaining text never landed. The origins that leave a generation running are now a named set, and `collaborator` is in it.

  The `suggestion-splice` streaming sink then wrote each delta at the selection's original end offset plus the length streamed so far. Those offsets describe a document that stopped existing the moment a peer edited ahead of the write head: a two-character insert before the selection made every later delta land two characters early, splicing the arriving text into the middle of the text it was meant to follow. The sink now holds an anchor pair minted once at the start of the rewrite — a write head at the selection end and a delete start outside it — repairs both on content-move commits, and resolves them per delta, so a concurrent edit or a block split moves the head instead of corrupting it (ST2, AN14). Losing the rewritten text to a structural edit, or the block itself to a deletion, now reports a diagnostic instead of quietly appending.

  A peer's AI run is now visible as presence. The streaming preview is a local decoration and never enters the document (RS1), so there is nothing for a collaborator to sync; the run publishes a `streaming: { blockId }` awareness payload instead. That key was already being written but never arrived: the multiplayer validator dropped it as undeclared, and local presence writes replaced the awareness state wholesale, so any selection change unpublished it. `streaming` is now a declared, validated key, presence writes merge rather than replace, and `MultiplayerController.getRemoteStreaming()` plus a `pen-multiplayer-streaming` block decoration expose it to renderers. The run publishes the key once rather than on every flush, since the block id does not change and resending it would spend the peer's whole presence rate budget. COL2 is amended to name the declared key set — it claimed a `pen.*` namespace that no key has ever used.

  `createTwoPeerHarness` accepts `extensionsFor`, building each peer's extensions separately. An extension factory closes over the controller it activates, so two peers handed one instance share it, which made a headless two-peer test of any stateful extension impossible to write.

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-tools@0.1.1
  - @input/pen-ingest@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. First-class AI co-authoring for Pen, with subpaths for suggestions, autocomplete, skills, tools, and streaming.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
  - @input/pen-tools@0.1.0
  - @input/pen-ingest@0.1.0
