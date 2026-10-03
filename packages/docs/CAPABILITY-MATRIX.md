# Capability matrix

Normative (`spec/rules/host.md` HB1). This document states, per surface, what each capability gives you. A capability absent from this document does not exist publicly; changing a cell is a spec-visible change.

`scripts/check-capability-matrix.mjs` (GATE 5.3) parses the tables below: every status must be in the vocabulary, and every claiming cell must name a path that exists and is not under `playground/`, at least one of which is a test, conformance spec, or example (HB5). `--self-test` proves a cell citing only a document fails.

## Surfaces

| Surface | Package | Entry |
| --- | --- | --- |
| React | `@input/pen-react` | `PenEditor`, or the `Pen.*` primitives |
| Vue | `@input/pen-vue` | `PenEditor`, or `PenContent` / `PenBlock` |
| Vanilla | `@input/pen-dom` | `mountEditor(editor, root)`, or `FieldEditorImpl` directly |
| Headless | `@input/pen-core` | `createHeadlessEditor()` — no DOM |

## Status vocabulary

| Status | Means |
| --- | --- |
| `supported` | Works on this surface with the packages the row names, and the named path proves it on this surface. |
| `bring-your-own-ui` | The behavior and its state reach this surface; the binding ships no components for it. You render the chrome. |
| `not-supported` | Not reachable on this surface. Needs a different surface. |
| `planned` | Intended, not shipped. Do not build against it. |

`bring-your-own-ui` is the most common status here, and that is the matrix's main finding rather than a gap in it. Pen's capabilities live in `@input/pen-core`, `@input/pen-dom`, and the extensions; a binding's job is to mount and subscribe (HB2). So a capability usually reaches every DOM surface, and what differs between React and Vue is how much chrome ships with it. React carries the reference feature set, and that spread is a difference in bundled UI, not in reach.

Two consequences worth stating plainly. Vue reaching React is not a goal: a Vue app that renders its own accept/reject buttons over the same decorations is using Pen as designed. And `bring-your-own-ui` is not a soft `not-supported` — the state is on an editor you already have, so the work is rendering, not plumbing.

## Editing

| Capability | React | Vue | Vanilla | Headless |
| --- | --- | --- | --- | --- |
| Single-block fields | `supported` — `packages/rendering/react/src/__tests__/fieldEditorCommands.marksAndInputRules.test.ts` | `supported` — `packages/rendering/vue/src/__tests__/mount.test.ts` | `supported` — `packages/rendering/dom/src/__tests__/mountEditor.test.ts` | `not-supported` — interactive text entry needs a field editor, which needs a DOM |
| Expanded (multi-block) fields | `supported` — `packages/rendering/dom/src/field-editor/__tests__/expandedContentEditableBackend.test.ts` | `supported` — `packages/rendering/dom/src/field-editor/__tests__/expandedContentEditableBackend.test.ts` | `supported` — `packages/tooling/conformance/suites/overlays/o4-multiblock-native.spec.ts` | `not-supported` — as above |
| Table-cell editing | `supported` — `packages/rendering/react/src/__tests__/tableCellNavigation.test.ts` | `supported` — cells select and activate for editing: `packages/rendering/vue/src/__tests__/mount.test.ts` | `bring-your-own-ui` — `mountEditor` renders no table chrome; cell endpoints are `packages/rendering/dom/src/field-editor/__tests__/restoreCellEndpoints.test.ts` | `not-supported` — table ops apply, cell editing does not |
| Document mutation (`editor.apply`) | `supported` — `packages/core/src/__tests__/applyPipeline.contract.test.ts` | `supported` — `packages/core/src/__tests__/applyPipeline.contract.test.ts` | `supported` — `packages/core/src/__tests__/applyPipeline.contract.test.ts` | `supported` — `packages/core/src/__tests__/applyPipeline.contract.test.ts` runs without a DOM |
| Host-defined container blocks | `supported` — `Pen.Editor.BlockChildren` is the children outlet; `packages/rendering/react/src/__tests__/customContainerRendering.test.tsx` | `supported` — children arrive as `ctx.childNodes`; `packages/rendering/vue/src/__tests__/customContainerRendering.test.ts` | `supported` — `mountEditor` builds a children host per container; `packages/rendering/dom/src/__tests__/customContainerRendering.test.ts` | `supported` — children resolve with no DOM through `documentState.childrenOf`; `packages/core/src/__tests__/containerChildren.test.ts` |

Expanded fields need no per-binding API: both bindings mount the same `FieldEditorImpl`, which owns the expanded backend, so the DOM-level test is the evidence for all three DOM surfaces.

Container blocks are the opposite case, and that is why each cell names its own test: recognition is shared — one schema flag, read through `isContainerBlockType` (RI6) — but the outlet is per surface, so a React test cannot vouch for Vue. Headless is `supported` rather than `not-supported` because the capability's model half is the whole capability there: `childrenOf` resolves both nesting routes with no DOM, and there is no chrome to be missing.

## AI

| Capability | React | Vue | Vanilla | Headless |
| --- | --- | --- | --- | --- |
| AI review UI (accept/reject, diffs) | `supported` — `packages/rendering/react/src/__tests__/suggestionRendering.test.tsx` | `bring-your-own-ui` — decorations paint through the decoration composable; no accept/reject components. `packages/rendering/vue/src/__tests__/publicApi.test.ts` | `bring-your-own-ui` — adopt `PEN_REVIEW_STYLESHEET`; `packages/extensions/ai/src/__tests__/reviewPresentation.test.ts` | `bring-your-own-ui` — accept/reject APIs work without a DOM: `packages/extensions/ai/src/__tests__/reviewPresentation.test.ts` |
| Streaming preview | `supported` — `packages/rendering/react/src/__tests__/aiPrimitives.sessionRailAndToolActivity.test.tsx` | `bring-your-own-ui` — preview decorations paint; no generation-zone or progress chrome. `packages/rendering/vue/src/__tests__/publicApi.test.ts` | `bring-your-own-ui` — `packages/extensions/ai/src/__tests__/reviewPresentation.streamingPreview.test.ts` | `bring-your-own-ui` — preview state is observable; nothing renders it. `packages/extensions/ai/src/__tests__/reviewPresentation.streamingPreview.test.ts` |
| Autocomplete (ghost text) | `supported` — `packages/rendering/react/src/__tests__/suggestionRendering.test.tsx` | `bring-your-own-ui` — the controller drives; no ghost rendering in the binding. `packages/extensions/ai/src/autocomplete/__tests__/extension.policySnapshotsAndPrefetch.test.ts` | `bring-your-own-ui` — `getAutocompleteController()`; `packages/extensions/ai/src/autocomplete/__tests__/extension.policySnapshotsAndPrefetch.test.ts` | `bring-your-own-ui` — the controller runs headlessly: `packages/extensions/ai/src/autocomplete/__tests__/extension.policySnapshotsAndPrefetch.test.ts` |

The three AI rows are the parity story HB1 exists to tell. All three capabilities reach every DOM surface, because the decorations come from `@input/pen-ai` through the shared inline-decoration pipeline. What React adds is chrome: the `@input/pen-react/ai` and `@input/pen-react/ai-suggestions` entrypoints. A Vue or vanilla host gets the same decorations and renders its own affordances.

## Presentation

| Capability | React | Vue | Vanilla | Headless |
| --- | --- | --- | --- | --- |
| Overlays (carets, selection rects, block outlines) | `supported` — `packages/rendering/react/src/__tests__/regionSelection.marqueeBounds.test.tsx` | `bring-your-own-ui` — Vue paints no overlays (`packages/rendering/vue/STYLING.md`); native selection still renders, and overlay geometry is readable from `packages/rendering/dom/src/geometry/__tests__/geometryReader.test.ts` | `bring-your-own-ui` — geometry and overlay utilities ship; `mountEditor` mounts no layer. `packages/tooling/conformance/suites/overlays/o1-ordinary-native.spec.ts` | `not-supported` — overlays are geometry, which needs layout |
| Review surface styling | `supported` — `packages/extensions/ai/src/__tests__/rs4.stylingContract.test.ts` | `supported` — `packages/extensions/ai/src/__tests__/rs4.stylingContract.test.ts` | `supported` — `packages/extensions/ai/src/__tests__/rs4.stylingContract.test.ts` | `not-supported` — CSS needs a document |
| Editor field chrome | `supported` — `packages/rendering/react/src/__tests__/editorChrome.test.ts` | `supported` — `packages/rendering/vue/src/__tests__/editorChrome.test.ts` | `supported` — `packages/rendering/dom/src/__tests__/editorChrome.test.ts` | `not-supported` — CSS needs a document |

The styling contract is `supported` everywhere it can be because it is one exported sheet plus one class vocabulary (RS4), not per-binding code: `PEN_REVIEW_STYLESHEET` from `@input/pen-dom`, class names from `@input/pen-types`. Editor-field chrome is the same idea: one sheet (`PEN_EDITOR_CHROME_STYLESHEET`), adopted by `EditorRoot`, `PenEditor`, and `mountEditor` unless `chrome={false}`.

## Chrome

| Capability | React | Vue | Vanilla | Headless |
| --- | --- | --- | --- | --- |
| Toolbar (marks, block type) | `supported` — `packages/rendering/react/src/__tests__/toolbar.ax3.test.ts` | `bring-your-own-ui` — mark and conversion commands; active-state derivation is React-local. `packages/core/src/commands/__tests__/text.test.ts` | `bring-your-own-ui` — mark and conversion commands; active-state derivation is React-local. `packages/core/src/commands/__tests__/text.test.ts` | `bring-your-own-ui` — commands run headlessly. `packages/core/src/commands/__tests__/text.test.ts` |
| Selection toolbar | `supported` — `packages/rendering/react/src/__tests__/selectionToolbar.a11y.test.ts` | `bring-your-own-ui` — placement from `resolveSelectionRect`. `packages/rendering/dom/src/__tests__/selectionPlacement.test.ts` | `bring-your-own-ui` — placement from `resolveSelectionRect`. `packages/rendering/dom/src/__tests__/selectionPlacement.test.ts` | `not-supported` — placement needs layout |
| Slash menu | `supported` — `packages/rendering/react/src/__tests__/slashMenu.navigationAndCatalog.test.tsx` | `bring-your-own-ui` — catalog order is in core; `/` matching is React-local. `packages/core/src/__tests__/slashMenuOrder.test.ts` | `bring-your-own-ui` — catalog order is in core; `/` matching is React-local. `packages/core/src/__tests__/slashMenuOrder.test.ts` | `bring-your-own-ui` — catalog order is in core. `packages/core/src/__tests__/slashMenuOrder.test.ts` |
| Suggestion menu | `supported` — `packages/rendering/react/src/__tests__/suggestionMenu.triggerAndAnchoring.test.tsx` | `bring-your-own-ui` — `resolveSuggestionMenuTarget`. `packages/core/src/__tests__/resolveSuggestionMenuTarget.n6.test.ts` | `bring-your-own-ui` — `resolveSuggestionMenuTarget`. `packages/core/src/__tests__/resolveSuggestionMenuTarget.n6.test.ts` | `bring-your-own-ui` — `resolveSuggestionMenuTarget` runs without a DOM. `packages/core/src/__tests__/resolveSuggestionMenuTarget.n6.test.ts` |
| Block handle (drag, move) | `supported` — `packages/rendering/react/src/__tests__/blockHandle.a11y.test.ts` | `bring-your-own-ui` — move ops. `packages/core/src/commands/__tests__/structure.test.ts` | `bring-your-own-ui` — move ops. `packages/core/src/commands/__tests__/structure.test.ts` | `bring-your-own-ui` — move ops. `packages/core/src/commands/__tests__/structure.test.ts` |
| Table chrome (column menu, row and column UI) | `supported` — `packages/rendering/react/src/__tests__/tableColumnMenu.ax3.test.tsx` | `bring-your-own-ui` — table commands. `packages/core/src/__tests__/editorCore.tableCommands.test.ts` | `bring-your-own-ui` — table commands. `packages/core/src/__tests__/editorCore.tableCommands.test.ts` | `bring-your-own-ui` — table commands. `packages/core/src/__tests__/editorCore.tableCommands.test.ts` |

React ships the reference chrome; Vue and vanilla ship none, by design (HB1). Each chrome row cites the behavior below the binding that a host's own chrome uses, and names where React keeps state derivation of its own — toolbar active marks (`computeToolbarState`, `resolveActiveMarks`), slash-trigger matching (`getSlashTarget`), block-drag move ops (`buildMoveBlockOps`), and table defaults (`utils/tableDefaults.ts`) — so the gap is stated rather than discovered. For these rows `bring-your-own-ui` on Vue and vanilla is the designed state, not a backlog.

## Data

| Capability | React | Vue | Vanilla | Headless |
| --- | --- | --- | --- | --- |
| Interop: programmatic import/export | `supported` — `packages/extensions/interop/src/__tests__/surface.sf2.formats.test.ts` | `supported` — `packages/extensions/interop/src/__tests__/surface.sf2.formats.test.ts` | `supported` — `packages/extensions/interop/src/__tests__/surface.sf2.formats.test.ts` | `supported` — `packages/extensions/interop/src/__tests__/surface.sf2.formats.test.ts` |
| Interop: paste importers | `supported` — importers are a prop; `packages/rendering/react/src/__tests__/htmlPasteDefault.test.ts` | `supported` — HTML importer is wired by default; `packages/rendering/vue/src/__tests__/mount.test.ts` | `supported` — `packages/rendering/dom/src/__tests__/clipboardPaste.test.ts` | `not-supported` — paste is a DOM event |
| Multiplayer | `supported` — `packages/rendering/react/src/__tests__/multiplayerCaretOverlay.test.tsx` | `bring-your-own-ui` — awareness state syncs; no presence or remote-caret components. `packages/extensions/multiplayer/src/__tests__/decorations.test.ts` | `bring-your-own-ui` — `packages/extensions/multiplayer/src/__tests__/decorations.test.ts` | `bring-your-own-ui` — sync works, remote carets need layout. `packages/extensions/multiplayer/src/__tests__/decorations.test.ts` |
| Undo | `bring-your-own-ui` — install `undoExtension()`; no binding hook. `packages/extensions/undo/src/__tests__/undoExtension.editor.test.ts` | `bring-your-own-ui` — keyboard undo works once installed; `packages/rendering/vue/src/__tests__/mount.editingInteractions.test.ts` | `bring-your-own-ui` — `packages/extensions/undo/src/__tests__/undoExtension.editor.test.ts` | `supported` — `packages/extensions/undo/src/__tests__/undoExtension.editor.test.ts` |
| Snapshots and attribution | `supported` — `packages/rendering/react/src/__tests__/snapshotsMultiplayerHooks.test.tsx` | `bring-your-own-ui` — no composable; the extension's state is readable. `packages/extensions/snapshots/src/__tests__/snapshotsExtension.test.ts` | `bring-your-own-ui` — `packages/extensions/snapshots/src/__tests__/snapshotsExtension.test.ts` | `supported` — `packages/extensions/snapshots/src/__tests__/snapshotsExtension.test.ts` |

Undo is `bring-your-own-ui` on all three DOM surfaces because no binding exports an undo hook — the keyboard shortcut comes from the extension, so undo works without any binding code, and a custom undo button reads the extension. It is `supported` headlessly because there is no UI to be missing.

## Text tools

| Capability | React | Vue | Vanilla | Headless |
| --- | --- | --- | --- | --- |
| Search and replace | `supported` — `packages/rendering/react/src/__tests__/searchPrimitives.test.tsx` | `bring-your-own-ui` — the controller drives; no find UI. `packages/extensions/search/src/__tests__/search.test.ts` | `bring-your-own-ui` — `packages/extensions/search/src/__tests__/search.test.ts` | `bring-your-own-ui` — the controller runs headlessly: `packages/extensions/search/src/__tests__/search.test.ts` |
| Autoformat | `bring-your-own-ui` — install `autoformatExtension()`; no binding API. `packages/extensions/autoformat/src/__tests__/editorActivation.test.ts` | `bring-your-own-ui` — `packages/extensions/autoformat/src/__tests__/editorActivation.test.ts` | `bring-your-own-ui` — `packages/extensions/autoformat/src/__tests__/editorActivation.test.ts` | `bring-your-own-ui` — the engine runs, but typing-triggered rules need a field editor: `packages/extensions/autoformat/src/__tests__/extension.test.ts` |

Autoformat has no chrome to ship, so no binding exports anything for it: `bring-your-own-ui` here means "install the extension", not "render something".
