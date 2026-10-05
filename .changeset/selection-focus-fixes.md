---
"@input/pen-types": patch
"@input/pen-core": patch
"@input/pen-dom": patch
"@input/pen-react": patch
"@input/pen-vue": patch
---

Selection, focus and pointer fixes across React, Vue and vanilla `mountEditor`:

- **Reading and writing the selection**
  - One `selectionchange` reader per root and one projector are the only code that reads or writes the DOM selection (S1).
  - Input edits the editor selection instead of re-reading the DOM.
  - `focus()` on a field with no caret commits one to the record.
  - Every projection reads the selection back. A mismatch emits `selection-projection-mismatch` once and is not rewritten (W3.R1).
  - The backend selection stamps (`FieldEditorSelectionSource`) are gone.
- **Focus and projection timing**
  - Projections are withheld while an IME composes, while editor chrome holds focus, and while a host control holds focus (HOST9).
  - Undo/redo rebuilds and passive attaches no longer write the native range or steal focus.
- **New APIs**
  - The selection convenience setters take an optional `SelectionWriteOptions` with `origin` (S3).
  - `FieldEditorImpl.scrollIntoView` and `FieldEditorImpl.setMountRequester` are new. A projection parked on an unmounted block asks the mount requester to mount it. `selection-target-unmounted` is emitted once per park, and `BlockScrollAlign` is added.
  - `FieldEditorImpl.connect()` keeps the field editor live under React Strict Mode.
  - `focusTextSelection` and `useFocusController` run in the calling turn (S4).
- **Undo, redo and scrolling:** undo and redo scroll the restored selection into view even when the caret did not move. Scroll deltas round to whole pixels.
- **Ranges over more than 50 blocks (S2):** these ranges, and ranges the engine confines to one field, show a substitute state with the focus sink revealed (`getSubstituteState()`, `pen.a11y.textRangeSelected`). Typing, deleting, IME input and clipboard actions work there.
- **Fuzzer findings:** S2 cross-block projections now handle code blocks, tables, unit-block gaps, unmounted endpoints and WebKit drags.
- **Gesture windows:**
  - Gesture windows survive a field switch.
  - `pointercancel` ends a pointer gesture, and drag and context-menu windows close properly (R1).
  - Touch selection handles keep their range (`native-range` window).
  - An EditContext keystroke after `editor.selectText` lands at the new caret (FE9).
- **Clicks and arrows around atoms and blocks:**
  - A shift-click into another block extends to the offset under the pointer on every binding, including from a block or cell selection and over dividers.
  - Clicking an inline atom puts the caret on the clicked side, following the atom's bidi run (O1, T5).
  - `pen.caretUp` / `pen.caretDown` into a table select its edge cell (T5).
  - A click in a table cell during a text range selects the cell.
- **Atom layout:** atoms share the text line, and a caret beside a chip takes the line's height. Compositions beside atoms no longer insert U+FFFC.
- **Table cells:**
  - `CellSelection.text` is in `@input/pen-types`, and an edited cell keeps DOM focus (W3.R18).
  - `Mod-b`/`i`/`u` in a cell fail closed on keydown in every browser (FE6).
  - A table props/meta change no longer resets an edited cell.
  - Backspace and Delete in an edited cell delete the range or one character instead of clearing the cell. `editor.deleteSelection()` on a `CellSelection` with `text` deletes only that range (A1, T6).
- **Positioned chrome:** the selection toolbar, AI prompt and slash/suggestion menus position from the editor selection, not the live DOM range. `DomScheduler.measureNow` drops geometry stale since the last commit (SCH2).
- **Focus and activation:**
  - Shift+Tab out of the editor works in Firefox.
  - Overlay focus follows window blur (`bindEditorRootFocus`).
  - The toggle empty state, block-type select and slash-menu table insert activate in the same turn.

Breaking: no
