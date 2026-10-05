---
"@input/pen-core": minor
"@input/pen-dom": minor
"@input/pen-undo": minor
---

The editor selection record is now the single source of truth for every caret, range, cell, focus and pointer path. The renderers read and write the DOM selection only through it (S1), and every selection write carries its real origin (S3).

- Arrow keys beside inline atoms go through the keymap. In right-to-left blocks they follow the visual direction (M2).
- `BlockHandle.length()` counts each inline embed as one offset, so a block that holds only atoms has length 1 (N1).
- An edited table cell's caret is `CellSelection.text` (`{ anchor, focus }` in the cell's offsets). It is validated, anchored and mapped through remote edits. `selectionChange` now fires for in-cell caret moves, and Shift+Arrow inside a cell extends the range. `setCellCaretFocus`, `getCellCaretFocus`, `CellCaretFocus` and `CellCaretWrite` are removed.
- Pointer gestures, drops and pointer pastes write origin `pointer`. Keymap commands, text input and shortcut pastes write `keyboard`, or `ime` while composing. Undo and redo write `restore`. Keyboard, IME and history moves scroll into view.
- Focus follows the selection record. Block and cell selections focus the focus sink. App and `null` selections focus the root, but only while the editor already owns focus. Escape writes the selection and lets its projection place focus (W3.R16).
- `programmatic`, `mapped` and `gc` writes no longer take focus the editor does not own (HOST9). Projection and focus work in editors mounted in an iframe. Tabbing into a multi-block range projects it.
- A reconcile no longer saves and restores the native selection. Rebuilt blocks are projected through `fieldEditor.projectAfterRebuild(blockIds)` (P3).
- A parked projection resolves on the mount ack of its own block (P4). `DomScheduler` no longer projects selections.
- Pointer drags and block clicks are resolved through core's transitions (`resolvePointerSelectionIntent`). A pointer selection that moves to another block ends the current undo step.
- The contenteditable, EditContext and expanded backends share one base class (CS5).
- `FieldEditorImpl` and `FieldEditorSession` drop methods that only forwarded to pen-dom internals. pen-dom reports gestures itself.

Host migration:

- Hosts that relied on ArrowLeft always meaning "previous atom" in right-to-left blocks now get the visual direction. There is no API change.
- Hosts that read `length() === 0` as "this block has no text" check `textContent() === ""` instead when an atom-only block must count as empty.
- Hosts that drove in-cell caret motion through `setCellCaretFocus` write a `CellSelection` with `text` instead: `editor.setSelection({ type: "cell", blockId, anchor: cell, head: cell, text: { anchor: caretOffset, focus: caretOffset } })`. Hosts that treated every `selectionChange` to a `cell` selection as a grid move check `text` first.
- Hosts that call `applyDocumentTextSelection` or `applyDomTextSelection` pass the gesture's origin, for example `"pointer"`.
- Hosts that read `selectionChange` origins see `restore` for history restores and drop any `programmatic` check they used to detect them.
- Hosts that call `handleEscapeSelectionTransition` drop `root`. Hosts that relied on Escape or `deactivate()` focusing the block element focus the sink or root instead.
- Hosts that called `editor.setSelection` (or another programmatic write) while focus was outside the editor, and relied on it focusing the editor, now focus it explicitly. In React use `useFocusController().text(…)` / `.range(…)`; elsewhere use the field editor's `focus()`.
- Hosts that called `saveSelection` / `restoreSelection` or passed `preserveSelection` to `fullReconcileToDOM` / `fullReconcileDeltasToDOM` drop them and call `fieldEditor.projectAfterRebuild([blockId])` after rebuilding a block.
- Hosts that called `editorSelectionToDOM` call `editor.setSelection` instead and let the field editor project it. `findDOMPoint` is now exported from `@input/pen-dom/field-editor/selectionBridge`.
- Hosts that passed `onProjectSelection`, called `setProjector` or read `projectedThisFlush` on a `DomScheduler` drop those calls, and the `SelectionProjector` type is gone. Selection projection runs in the field editor.
- Hosts that call `resolvePointerDragSelection` drop the `getBoundaryPoint` option. Hosts that build a `PointerSelectionGesture` by hand use `createPointerSelectionGesture`, or set `startSelectionVersion` and `committed: false`.
- Hosts that call `attachContentGestures` drop `skipNextClick` from `state`.
- Hosts that subclass a backend and use a removed protected member move to the new members:
  - `ContentEditableBackend`: `fullReconcileActiveField` becomes `rebuildField(inlineDecorations?, blockId?)`, and `applyTextDiffAsOps` drops its `deferredRemoteDeltas` argument.
  - `EditContextBackend`: `resolveEditorSelectionRange`, `resolveCollapsedEditorSelectionRange`, `getAuthoritativeTextInputSelection` and `resolveKeyDownRange` become `authorityRangeIn(blockId)` / `trustedCaretIn(blockId)`.
- Hosts drop calls to the removed field-editor forwarders: `beginPointerSelection`, `endPointerSelection`, `notifyGestureEvent`, `isAdmissibleGestureRead`, `getGestureWindows`, `requestDivergenceProjection`, `shouldProjectSelectionAfterReconcile`, `requestActivation` and `resolveInsertMarks`. Focus, pending marks and post-rebuild projection keep their session methods.

Breaking: yes — hosts apply the migration list above (pass origins, write `CellSelection.text` instead of `setCellCaretFocus`, replace `saveSelection`/`restoreSelection`/`editorSelectionToDOM` with `editor.setSelection` plus `projectAfterRebuild`, drop removed scheduler/gesture/forwarder members, focus the editor explicitly after programmatic writes)
