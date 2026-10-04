# Pen migration guide: the editing-surface release (0.1.0 train)

This release puts the browser editing surface under one selection model. Pen now draws its own carets: the **overlay caret is on by default** on every surface (React, Vue, vanilla `mountEditor`). It paints carets next to atoms, in empty blocks, at range endpoints, for remote peers, and outlines block and grid-cell selections, all inside a `data-pen-overlay-layer` element on the editor root. The field editor has **one selection reader** (a single `selectionchange` listener per root) and **one selection writer** (the projector). The helpers hosts used to call to save, restore or write the DOM selection are gone; hosts call `editor.setSelection` / `selectText` and Pen projects the result. Every selection write carries its real origin (`pointer`, `keyboard`, `ime`, `restore`, …). **Focus follows the selection record**, and focus returns by primitive class: toolbar buttons do not take focus, and menus return focus to the control that opened them. **List items are grouped** in `div[data-pen-list-group][role="list"]` wrappers and announced as lists. An edited table cell's caret now lives in the selection record as `CellSelection.text`. Yjs awareness moves to a subpath. Undo grouping is keyed, not timed. Commits and keystrokes no longer read the whole document. The Node floor is raised.

---

## Breaking changes

Every published package is in one `fixed` changeset group, so all of them move together.

### All packages: Node engine floor

- **Changed:** `engines.node` goes from `>=22` to `^22.22.2 || ^24.15.0 || >=26.0.0`. This is forced by `isomorphic-dompurify` 4.3 → jsdom 30 in `@input/pen-interop`. `@input/pen`, `@input/pen-react` and `@input/pen-vue` depend on interop.
- **Affected:** CI, SSR or build machines on Node < 22.22.2, 24.0–24.14, 23 or 25.
- **Do:** move to Node `^22.22.2`, `^24.15.0` or `>=26`.

### `@input/pen-core`

**1. `BlockHandle.length()` counts atoms in atom-only blocks (N1).** An atom-only block now has length 1, where before it had 0.

- **Affected:** code that reads `length() === 0` as "this block has no text".
- **Do:**
  ```ts
  // before
  if (block.length() === 0) {
    /* empty */
  }
  // after: when an atom-only block should count as text-empty
  if (block.textContent() === "") {
    /* empty */
  }
  ```

**2. Table-cell caret moves into `CellSelection.text`; the side-channel seam is removed.** `setCellCaretFocus`, `getCellCaretFocus`, `CellCaretFocus` and `CellCaretWrite` are no longer exported.

- **Affected:** hosts that moved the in-cell caret with `setCellCaretFocus`, and hosts that treat every `selectionChange` to a `cell` selection as a grid move. In-cell caret moves and typing now fire `selectionChange` too.
- **Do:**
  ```ts
  // before
  setCellCaretFocus(editor, { blockId, row, col, offset });
  // after (text is in the cell's logical offsets; only valid when anchor === head)
  const cell = { row, col };
  editor.setSelection({
    type: "cell",
    blockId,
    anchor: cell,
    head: cell,
    text: { anchor: offset, focus: offset },
  });

  // in selectionChange handlers
  editor.onSelectionChange(({ state }) => {
    if (state?.type === "cell" && state.text) {
      /* in-cell caret/range, not a grid move */
    }
  });
  ```
  If `anchor !== head`, Pen rejects the write with a `selection-invalid-cell-text` diagnostic.

**3. Block revisions advance only for blocks a commit touched (SCALE2).** This applies to remote and undo structural commits too.

- **Affected:** hosts that took "every `editor.getBlockRevision()` bumped" as a "something structural happened" signal.
- **Do:** listen to `commit` events for that signal instead.
- **Also:** an `insert-block` or `move-block` into a `{ parent }` that does not exist is now dropped with `PEN_APPLY_003` (PR5). Before, an insert left an orphaned block and a move detached the block.

### `@input/pen-types`

**4. `UndoManager.syncExplicitUndoGroup` is replaced by `withCapture` (AIB4).**

- **Affected:** hosts that implement `UndoManager` themselves.
- **Do:**
  ```ts
  // before
  syncExplicitUndoGroup(groupId: string | null): void;
  // after
  withCapture<T>(origin: OpOrigin, groupId: string | null, run: () => T): T;
  ```
  `CRDTUndoManager` gains an optional `setCaptureKey(key: CRDTUndoCaptureKey | null)`.

**5. `ToolDefinition.destructive` can be a function (AIB3).** It is now `boolean | ToolDestructiveResolver`, where the resolver is `(input, { staged }) => boolean`. This item also covers `@input/pen-tools` and `@input/pen-ai`.

- **Affected:** code that reads `tool.destructive` as a boolean, and hosts that used the `confirm` resolver as an "every AI edit" hook.
- **Do:**
  ```ts
  // before
  if (tool.destructive) { ... }
  // after
  const d = tool.destructive;
  const isDestructive = typeof d === "function" ? d(input, { staged }) : !!d;
  // or use isDestructiveAITool / authorizeAIToolCall, which now take the call's context
  ```
  `edit_document` now reaches `confirm` (and emits `ai-tool-unconfirmed`) only for direct replaces, deletes of non-empty blocks, and content-kind changes of non-empty blocks. To audit every AI edit, move to `onBeforeApply` or the `commit` event. In production, if you expose `delete_block` / `write_document`, consider `aiExtension({ unconfirmedDestructive: "refuse" })`; `directTransport`, `createSSEHandler`, and `processStream` now apply that setting (and `aiExtension({ confirm })`) from the editor they run against, or take `confirm` / `unconfirmedDestructive` options directly when there is no editor or you want a different policy on that surface.

### `@input/pen-yjs`

**6. Awareness moves to the `@input/pen-yjs/awareness` subpath; `y-protocols` becomes an optional peer (API2).** `yjsAdapter()` no longer creates an awareness.

- **Affected:** hosts that import awareness helpers from the root, or that wire a provider without `@input/pen-multiplayer`.
- **Do:**
  ```ts
  // before
  import {
    createYjsAwareness,
    getYjsAwareness,
    encodeYjsAwarenessUpdate,
    applyYjsAwarenessUpdate,
  } from "@input/pen-yjs";
  // after
  import {
    createYjsAwareness,
    getYjsAwareness,
    encodeYjsAwarenessUpdate,
    applyYjsAwarenessUpdate,
  } from "@input/pen-yjs/awareness";

  // provider wiring without the multiplayer extension
  const adapter = yjsAdapter({ awareness: createYjsAwareness });
  ```
  Hosts using `@input/pen-multiplayer` change nothing, because the extension creates its own awareness on activation. That package now lists `yjs` and `y-protocols` as peers.

**7. `CRDTEvent.affectedBlocks` on remote or undo structural transactions is exact (SCALE2).** It lists only the blocks that were inserted, removed or moved, not every id in `blockOrder`.

- **Do:** treat it as "touched blocks only". For a full re-scan, read the document or use `commit` events.

### `@input/pen-undo`

**8. Undo and redo restore the selection with origin `restore`, not `programmatic` (S3).** The restored selection now scrolls into view.

- **Do:**
  ```ts
  // before
  editor.onSelectionChange((record) => { if (record.origin === "programmatic") /* maybe history */ });
  // after
  editor.onSelectionChange((record) => { if (record.origin === "restore") /* history restore */ });
  ```

### `@input/pen-multiplayer`

**Peer colours are validated against a closed grammar (COL2).** A peer's `user.color` is accepted only as a hex colour, a CSS named colour (plus `transparent` / `currentColor`), or `rgb()` / `rgba()` / `hsl()` / `hsla()` with numeric arguments. Anything else, including `var(--…)`, `inherit`, `color-mix()` and `oklch()`, falls back to `currentColor`. This closes a hole where a collaborator could inject a CSS `url()` into every viewer's caret.

- **Affected:** hosts that assign peer colours as CSS variables or modern colour functions.
- **Do:** resolve the colour to hex or `rgb()` before passing it as `user.color`, or theme remote carets with the `--pen-peer-*` tokens instead.

### `@input/pen-dom`

**Programmatic selection writes no longer take focus (HOST9).** `editor.setSelection`, `selectText` and other programmatic or collaborator writes update the selection without moving focus into the editor when focus is elsewhere (the page body, a host control, or another editor). Only user input (`pointer`, `keyboard`, `ime`), undo/redo `restore`, and the user's own edits move focus.

- **Affected:** hosts that called `setSelection` from outside the editor and expected the editor to be focused afterwards.
- **Do:**
  ```ts
  // React
  const focus = useFocusController();
  await focus.text({ blockId, offset: "end" });
  // elsewhere: the field editor's focus()
  fieldEditor.focus();
  ```

**9. Overlay caret and block outlines are on by default.** Pen draws carets into `[data-pen-overlay-layer]` and sets `caret-color: transparent` on the field. Block and grid-cell selections get an outline whose default is an inset 2px `Highlight` ring.

- **Do:**
  ```css
  /* if you already style [data-selected], avoid a double outline */
  .my-editor-root {
    --pen-block-selection-outline: none;
  }
  /* or drop your own [data-selected] rule and use the tokens */
  ```
  - Set caret and outline tokens on the editor root or an ancestor, not on a wrapper inside it.
  - Overlay items carry `data-block-id`. Scope block selectors to blocks so they don't match overlay items:
    ```css
    /* before */ [data-block-id="x"] { … }
    /* after  */ [data-pen-editor-block][data-block-id="x"] { … }
    ```
  - The root now has an extra last child, `data-pen-overlay-layer`. CSS that relies on the root's `:last-child` must account for it.

**10. List items are wrapped in `[data-pen-list-group]` (AX1).** This item also covers `@input/pen-react` and `@input/pen-vue`. Each run of list items renders inside `div[data-pen-list-group][role="list"]`. Each item host gets `role="listitem"`, `aria-level`, `aria-posinset` and `aria-setsize`.

- **Affected:** CSS that uses sibling combinators across a list boundary, and code that walks the blocks host's direct children. Also, React and Vue remount an item that moves between groups when a run splits or merges.
- **Do:**
  ```css
  /* before */
  [data-pen-editor-block] + [data-pen-editor-block] {
    margin-top: 4px;
  }
  /* after: cover the group boundaries too */
  [data-pen-editor-block] + [data-pen-editor-block],
  [data-pen-editor-block] + [data-pen-list-group],
  [data-pen-list-group] + [data-pen-editor-block] {
    margin-top: 4px;
  }
  ```
  ```ts
  // before: blocksHost.children
  // after: also descend into list groups
  const blocks = blocksHost.querySelectorAll(
    ":scope > [data-pen-editor-block], :scope > [data-pen-list-group] > [data-pen-editor-block]",
  );
  ```

**11. Focus follows the selection record (W3.R16).**

- Escape no longer focuses the block element. From a caret, focus goes to the focus sink. From a block selection, it goes to the root.
- `deactivate()` no longer focuses the block element or the root.
- `handleEscapeSelectionTransition` drops `root`:
  ```ts
  // before
  handleEscapeSelectionTransition({ event, editor, fieldEditor, root });
  // after
  handleEscapeSelectionTransition({ event, editor, fieldEditor });
  ```
- A custom field editor passed to `handleFieldEditorRootFocus` must implement `requestRootFocus`.

**12. Selection writes are routed through the projector; `editorSelectionToDOM` is removed (S1).** It is gone from `@input/pen-dom/field-editor` and `…/field-editor/selectionBridge`.

```ts
// before
editorSelectionToDOM(root, anchor, focus);
// after
editor.setSelection({ type: "text", anchor, focus }); // or editor.selectText(...)
```

`findDOMPoint` is now exported from `@input/pen-dom/field-editor/selectionBridge` if you need block-offset → DOM-point mapping.

**13. Reconcile no longer saves or restores the native selection.** `saveSelection`, `restoreSelection` and `SavedSelection` are removed from `@input/pen-dom/field-editor` and `…/field-editor/reconciler`. The `preserveSelection` option is gone from `fullReconcileToDOM` / `fullReconcileDeltasToDOM`.

```ts
// before
const saved = saveSelection(el);
fullReconcileToDOM(el, …, { preserveSelection: true });
restoreSelection(el, saved);
// after
fullReconcileToDOM(el, …);
fieldEditor.projectAfterRebuild?.([blockId]);
```

**14. `FieldEditorStore` text-selection setters require an origin (S3).**

```ts
// before
store.applyDocumentTextSelection(anchor, focus);
store.applyDomTextSelection(anchor, focus);
// after
store.applyDocumentTextSelection(anchor, focus, "pointer"); // or "keyboard" / "ime"
store.applyDomTextSelection(anchor, focus, "pointer");
```

`destructureInlineAtom` and `collapseSelectionToPoint` take an optional `origin`.

**15. Pointer gestures (`@input/pen-dom/utils/pointerSelection`).**

- `resolvePointerDragSelection` no longer takes `getBoundaryPoint`. The signature is now `(editor, root, gesture, { clientX, clientY })`.
- `PointerSelectionGesture` gains the required fields `startSelectionVersion` and `committed`. Build one with `createPointerSelectionGesture(editor, { blockId, clientX, clientY, … })`, or set `startSelectionVersion` and `committed: false` yourself.
- `attachContentGestures`: drop `skipNextClick` from `state`. The click after a gesture is now skipped through `gesture.committed`.

**16. `DomScheduler` no longer projects selection (P4).** `DomSchedulerOptions.onProjectSelection`, `DomScheduler.setProjector`, `DomScheduler.projectedThisFlush` and the `SelectionProjector` type are removed. Delete those calls; projection runs in the field editor and resolves on the parked block's own mount ack.

**17. Arrow keys beside inline atoms go through the keymap.** The DOM-range path `selectInlineAtomWithArrowKey` is removed. In right-to-left blocks, ArrowLeft and ArrowRight follow visual direction (M2), not "previous" and "next" atom. There is no API change.

### `@input/pen-react`

**18. `Pen.Editor.CaretOverlay` (`EditorCaretOverlay`) binds to pen-dom's overlay.**

- `renderCaret` gets a transform-positioned `caretStyle` with no `left`/`top`, plus a new `affinity`.
- Its node is portaled into the overlay layer.
- `data-caret-visible` moves to the layer element.
- The 500 ms blink pause is gone; the blink restarts on each edit or caret move.
  ```tsx
  // before
  renderCaret={({ caretStyle }) => <i style={{ left: caretStyle.left, top: caretStyle.top, … }} />}
  // after
  renderCaret={({ caretStyle, affinity }) => <i style={caretStyle} />}
  ```
  ```css
  /* before */ [data-pen-editor-caret-overlay][data-caret-visible] { … }
  /* after  */ [data-pen-overlay-layer][data-caret-visible] { … }
  /* set --pen-editor-caret-* tokens on the editor root or above */
  ```

**19. `Pen.Multiplayer.CaretOverlay` (`MultiplayerCaretOverlay`) binds to the overlay.**

- Remote carets move from `[data-pen-multiplayer-caret-overlay]` into `[data-pen-overlay-layer]`.
- `caretStyle` and `labelStyle` change from `position: fixed` + `left`/`top` to `position: absolute` + `transform`.
- The default label is a child of its caret, has `[data-pen-multiplayer-caret-label]`, and no longer carries `data-pen-multiplayer-caret` or the user attributes.
- Colour comes from `--pen-peer-color`.

  Restyle remote carets under `[data-pen-overlay-layer]`, and read position from `transform` in `renderCaret` / `renderLabel`.

**20. `EditorSelectionRect` draws only the region-select marquee.** pen-dom now paints committed block selections. Style them with `--pen-block-selection-outline` / `--pen-block-selection-background` / `--pen-block-selection-radius` on the editor root.

**21. Focus return (AX3).**

- Toolbar buttons and toggles no longer take focus on click: the primary-button `mousedown` default is prevented after your handler runs (`pointerdown` is left alone, so compatibility mouse events still fire). Keyboard activation keeps focus on the control, and Escape returns it to the editor.
- The AI command menu and the contextual prompt move focus back to whatever had it before they opened, on accept, reject, dismiss or Escape.
- The block-handle and table column menus return focus to the control that opened them.
- If you relied on `document.activeElement` being the toolbar button after a click, or on the AI input keeping focus after close, update that logic. For custom chrome, use `captureFocusReturn` / `restoreFocusReturn` from `@input/pen-dom`.

### `@input/pen-vue`

**22. Overlay on by default with no component.** Same CSS actions as item 9: set `--pen-block-selection-outline: none` if you style `[data-selected]`, and account for the extra `data-pen-overlay-layer` child in any root `:last-child` CSS. List grouping (item 10) applies to `PenContent` / `PenBlock`.

---

## Behaviour changes worth knowing (not breaking)

- **Carets beside atoms.** Mentions and inline apps share the text line, because the caret-boundary `<br>` is hidden. The caret height comes from the text line, not the chip box. A half-click on a chip puts the caret on the side that was clicked.
- **Empty-block and range-endpoint carets** are drawn by the overlay. A text range over more than 50 blocks draws both endpoint carets plus one covering span, and focus sits on the focus sink, which is labelled `pen.a11y.textRangeSelected`.
- **Reduced motion:** each root carries a presence-only `data-pen-reduced-motion` attribute. Under reduced motion the caret is solid and the AI suggestion underline does not transition.
- **Scroll into view** happens for keyboard, IME, undo/redo and local-typing selection moves. Pointer, programmatic and collaborator moves do not scroll.
- **Origins:** pen-dom selection writes carry `pointer` / `keyboard` / `ime`. Convenience setters (`selectText`, `selectBlock`, …) take an optional `SelectionWriteOptions` whose `origin` defaults to `programmatic`.
- **`focus()` on a field with no caret** commits a caret at the field's end (origin `programmatic`), so `editor.selection` matches the DOM.
- **`FieldEditor.focusTextSelection` and React `useFocusController`** run in the calling turn; the promise they return is already settled.
- **Arrow up/down into a table** selects its edge cell as a `CellSelection`.
- **Undo:** an AI action stays one undo step even if the user types during it. User typing during a generation becomes its own steps. `stopCapturing()` no longer closes an AI group.
- **Diagnostics:**
  - `selection-projection-mismatch`: the projector reads the selection back after writing and finds it doesn't match.
  - `selection-target-unmounted`: now emitted once per park, with `version`, `blockId` and `mountRequested`.
  - `dangling-block-reference`: normalization removed order entries for blocks that no longer exist.
  - `decoration-out-of-scope`.
  - `YJS_SINGLETON_MISMATCH`: a second yjs copy opened a transaction on the document.
- **Decorations:** `decorationsChange` passes `(generation, changedBlockIds)` and fires only when something changed.
- **Scale:**
  - A keystroke, caret move or structural commit no longer reads the whole document.
  - React, Vue and vanilla re-render only the blocks whose state changed (via `fieldEditor.blockNotifier`).
  - Mounting is no longer quadratic.
  - `pen.caretUp` / `pen.caretDown` at 10k blocks is no longer about 0.6 s.
- **Announcements** from the live region land one frame later, in the scheduler write phase.
- **Firefox:** Shift+Tab out of the editor works. Starting a composition over a cross-block selection no longer crashes.
- **IME + collaboration:** remote edits during a composition are deferred and rebased (C2/COL1).
- **Paste:** HTML import keeps nested lists from Slack, Apple Notes and Google Docs, and keeps block wrappers inside `<b>`. If a conversion would lose text, it falls back to plain paragraphs.
- **Multiplayer palette** (`MULTIPLAYER_COLORS`) uses darker shades for 4.5:1 label contrast.
- **`edit_document` streaming preview** shows what accepting the edit will do.

## New APIs

- `@input/pen-core`
  - `getListSegments`, `getListItemSemantics`, `isListItemType`: list runs, levels and positions.
  - `convertPointerDrag`, `clickSelectableBlock`, `buildTransitionSnapshot`, and the types `TransitionSnapshot`, `TransitionBlock`: pointer transitions.
  - `scopedDecorationSource({ interest, decorate })`: per-block decoration source.
  - `editor.requestDecorationUpdate({ source?, blockIds })`.
  - `DocumentSession.ensureAwareness(scopeId, factory)` and live `editor.internals.awareness`.
  - `DocumentState.preorderIndexOf(id)` / `preorderBlockIds()`.
- `@input/pen-types`
  - `CellSelection.text`.
  - `SelectionWriteOptions` on the selection setters.
  - `FieldEditorFocusOptions.origin`.
  - `ToolDestructiveResolver`, `ToolAuthorityContext`, `CRDTUndoCaptureKey`, `BlockScrollAlign`.
- `@input/pen-ai`
  - `aiExtension({ unconfirmedDestructive: "refuse" })`, also accepted on `AIToolGrant`, `AIToolTurnOptions` and `AgenticLoopOptions`.
  - `aiToolConfirmPolicyFacet`, `resolveAIToolConfirmPolicy` and `AIToolConfirmPolicy` on `@input/pen-ai/tools`; `confirm` / `unconfirmedDestructive` on `ProcessStreamOptions`.
  - `EditDocumentPreviewUpdate` gains `blockIds`, `placement` and `complete`.
- `@input/pen-transport`
  - `confirm` / `unconfirmedDestructive` on `DirectTransportOptions` and `SSEServerOptions`.
- `@input/pen-yjs`
  - `@input/pen-yjs/awareness` subpath.
  - `yjsAdapter({ awareness })`.
- `@input/pen-dom`
  - `getRootOverlay(root)`: `registerContributor`, `onPaintPlan`, `requestPaint`, `holdCaretMode`.
  - `overlayItemStyle`, `overlayLabelStyle`.
  - `attachRemoteCarets(overlay, source)` and `getRemoteCaretSource(editor)`.
  - `captureFocusReturn` / `restoreFocusReturn`.
  - `getRootReducedMotion(root)`, `REDUCED_MOTION_ATTR`, `AX6_MOTION_MAPPING`.
  - `resolvePointerSelectionIntent` and `createPointerSelectionGesture`, in `@input/pen-dom/utils/pointerSelection`.
  - `findDOMPoint`, in `…/field-editor/selectionBridge`.
  - `fieldEditor.blockNotifier`.
  - `FieldEditorImpl`: `projectAfterRebuild(blockIds)`, `setMountRequester(requester)`, `scrollIntoView(target, scroll)`, `setReadOnly(readonly)`, `getGestureWindows()`.
  - `FieldEditorSession.getSubstituteState()`.
  - `buildLazyNormalPositionSnapshot(editor)`.
  - `DocumentTree.destroy()`.
  - `DomScheduler`: `setOverlayPainter`, `requestPaint`, `flushCount` / `paintCount`.
  - Overlay CSS tokens: `--pen-overlay-z-index`, `--pen-editor-endpoint-caret-color`, `--pen-block-selection-outline`, `--pen-block-selection-background`, `--pen-block-selection-radius`, `--pen-selection-range-background`, `--pen-selection-range-opacity`.
- `@input/pen-react`
  - `useReducedMotion()`.
- `@input/pen-vue`
  - `PenMultiplayerCaretOverlay`.
- `@input/pen-test`
  - `createPeerHarness(n)`, `PEER_SCHEDULES`, `runPeerSchedules`.
  - `findStructuralViolations` / `assertStructuralInvariants`.
  - `createScanProbe(editor)`.
  - The mixed scale fixture: `generateMixedBlockSpecs`, `mixedFixtureOps`, and related helpers.
