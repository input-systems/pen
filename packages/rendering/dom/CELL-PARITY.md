# Table-cell parity

Normative (`spec/rules/dom.md` FE6). This document declares which field-editor capabilities apply while the caret is inside a table cell. A capability outside the supported set must fail closed — no-op plus diagnostic — never half-work.

Cell editing always uses `ContentEditableBackend`, never EditContext (`_resolveBackendClass` in `src/field-editor/fieldEditorImpl.ts` returns `ContentEditableBackend` while a cell is being edited). Two modes are distinct throughout, and conflating them is the most common source of wrong expectations here:

- **Grid selection** — the table is selected, one or more cells are highlighted, no field editor is attached. `editor.selection.type` is `"cell"` and `activeCellCoord` is unset.
- **Cell editing** — a double-click or Enter attached a field editor to one cell's text. `activeCellCoord` names the cell.

Unless a row says otherwise it describes cell editing.

## Supported

| Capability                      | Notes                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Text entry                      | `beforeinput` → `splice-text` carrying `cell: { row, col }`                                                 |
| IME and composition             | The same event-sequence path a paragraph uses; the fallback in `FIELD-EDITOR-BACKENDS.md` applies unchanged |
| Caret movement inside the cell  | Arrow keys dispatch the ordinary caret commands; they move the record's `CellSelection.text`                |
| Cell-to-cell navigation         | Tab, Shift+Tab, and Enter move between cells; Enter is a move, not a block split                            |
| Undo and redo of a cell edit    | Cell text participates in the shared undo stack                                                             |
| AI suggestion accept and reject | Resolution ops carry the cell coordinate, so accepting clears the mark in the cell it was staged in         |
| Search and replace              | Matches and replacements reach cell text. Match _decorations_ do not — see below                            |
| Clipboard, in grid selection    | Copy, cut, and paste operate on the selected cells                                                          |

## Not supported

Each of these declines. The rightmost column is what a host can observe.

| Capability                                                      | Why                                                                               | Observable                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Mark toggling (bold, italic, underline)                         | Both toggle paths require a text selection; cell editing holds a `cell` selection | `cell-capability-unsupported` diagnostic, `capability: "marks"`, when the toggle reaches the field editor — see below |
| Block operations targeting cell content (split, merge, convert) | Guarded at dispatch: a cell's text is not a block                                 | No-op. Enter is a cell move instead                                                                                   |
| Input rules                                                     | Neither list rules nor inline rules accept a `table` field editor                 | No-op                                                                                                                 |
| Autocomplete                                                    | Declined by block policy unless the host opts in with `allowInTables`             | No-op; the controller records `table-cell-active`                                                                     |
| Clipboard, while editing a cell                                 | Copy and paste need a text cursor context, which cell editing does not provide    | No-op                                                                                                                 |
| Drag and drop                                                   | Refused at both ends for every surface, not only cells                            | `preventDefault`                                                                                                      |
| Expanded (multi-block) editing                                  | A cell is a single surface by construction                                        | Not reachable                                                                                                         |

Marks are the declared instance the conformance scenario exercises, and the only one that has a diagnostic today. The rest still decline silently; each one is a candidate for the same treatment, and the reason to add it one at a time is that a diagnostic on a path a host already handles is noise. What this document buys today is that the list is written down, so a silent decline is a known state rather than a bug report.

### Which route the mark diagnostic covers

The field editor emits the diagnostic on two routes, and the keyboard one is the one every engine reaches.

The keyboard route is the field editor's keydown. When `Mod-b`/`Mod-i`/`Mod-u` (no Shift or Alt) reaches the end of keydown handling inside an edited cell — no keymap command and no extension binding claimed it — the field editor prevents the default and emits the diagnostic. Every engine delivers that keydown. The native `formatBold` `beforeinput` does not reach every engine: Chromium produces it inside a `contenteditable`, Firefox never does, and WebKit only does when the host application maps the key equivalent to a bold command (Safari's Format menu does; a bare WKWebView, including the one Playwright drives, does not). A decline that waited for that event was observable on Chromium alone in the conformance matrix. Preventing the keydown default also stops Chromium from following with a native `formatBold`, so the decline is reported once.

The `beforeinput` route — `inputType: "formatBold"` and friends, dispatched through `DIRECT_HANDLERS` — still emits the diagnostic, for toggles that arrive without a keydown Pen saw (a host application's Format menu, for instance).

`richTextShortcutsExtension()` from `@input/pen-shortcuts` binds the same keys and is how a host gets these shortcuts on every engine — a bare `createEditor()` does not install them. Its handler declines through `toggleInlineMark`'s documented `false` return and emits nothing itself; because it returns `false`, the keydown falls through to the field editor's decline above. A host binding that returns `true` for one of these keys in a cell owns the key, and no diagnostic is emitted.

## Half-supported, and honest about it

These reach a cell partially. They are called out rather than filed under "supported" because a `supported` row promises the whole capability.

| Capability                | What works                                                          | What does not                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline decorations        | Render in the active cell                                           | Decoration ranges are keyed by the table's block id and block-local offsets, with no cell coordinate, so ranges only line up when they were built for the cell being reconciled |
| AI review decorations     | `suggestion` marks stored on cell text paint through the reconciler | The decoration-facet path reads block text, which a table does not have                                                                                                         |
| Streaming preview         | Committed suggestion marks appear                                   | Live virtual preview in an active cell is unverified                                                                                                                            |
| Multiplayer remote carets | Cell anchors resolve                                                | Remote cursor decorations carry no cell coordinate, and presence validation measures a table block's length as zero, so cell-local offsets can be rejected                      |
| Select all                | In grid selection, selects every cell                               | While editing a cell, `Mod-A` escalates to selecting the table block rather than the cell's text                                                                                |
| Inline atoms              | Render and persist in cell text                                     | Arrow-key atom selection is preempted by cell navigation, and pasting an atom into an active cell declines with the rest of the paste path                                      |

## Coverage

`packages/tooling/conformance/scenarios/fe6-cell-parity.spec.ts` is the net, and it runs on Chromium, Firefox, and WebKit. It exercises the supported rows against a live cell — text entry, caret movement inside the cell, Tab to the next cell, undo — and holds the declared-unsupported row to three claims: the document bytes do not change on any engine, no native `formatBold` follows the declined accelerator, and the decline is reported exactly once as `cell-capability-unsupported` naming the capability and the surface, on every engine.

Two facts the scenario had to work around, recorded because both are easy to rediscover the hard way:

- The harness's per-step standing check compares the DOM against a **text** selection authority. Cell editing holds a `cell` selection, so that check can only answer "unchecked", and `standingFilter` treats unchecked as a failure on purpose (skip-as-success was a real hole once). In-cell scenarios therefore drive the keyboard through `page` and assert their own invariants, as `t6-cell-editing-arrows.spec.ts` already did.
- `window.__penConformance.documentText` walks block text, and a table block's own text is empty because its cells own theirs. Assertions about cell content read the cell.
