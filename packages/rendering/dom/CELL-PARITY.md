# Table-cell parity

Normative (`spec/rules/dom.md` FE6). This document declares which field-editor capabilities apply while the caret is inside a table cell. A capability outside the supported set must fail closed — no-op plus diagnostic — never half-work.

Cell editing always uses `ContentEditableBackend`, never EditContext (`FIELD_EDITOR_BACKEND_SPLIT` in `src/field-editor/fieldEditorImpl.ts` lists `table-cell` under `alwaysContentEditable`). Two modes are distinct throughout, and conflating them is the most common source of wrong expectations here:

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

There are two ways a mark toggle reaches Pen, and the diagnostic is on one of them.

The field editor's own route is `beforeinput` with `inputType: "formatBold"`, dispatched through `DIRECT_HANDLERS`. That route emits the diagnostic. Measured across the conformance engines, **Chromium and WebKit produce it**: they turn the platform bold accelerator into `formatBold` inside a `contenteditable`. Firefox delivers the keydown and nothing more, so on Firefox the intent never arrives and there is nothing to decline. (In a paragraph Chromium delivers nothing either, because a paragraph is on EditContext; cells are always contenteditable, which is why the route exists here at all.) `fe6-cell-parity.spec.ts` asserts this per engine rather than skipping Firefox, so a Chromium or WebKit regression that silenced the route cannot pass unnoticed.

The other route is `richTextShortcutsExtension()` from `@input/pen-shortcuts`, which binds `Mod-b`/`Mod-i`/`Mod-u` and is how a host gets these shortcuts on every engine — a bare `createEditor()` does not install them. That route declines through `toggleInlineMark`'s documented `false` return, and emits no diagnostic. It is left alone deliberately: the diagnostic's declared scope is the field editor and the conformance package, and the keybinding layer already has a return channel for "not expressible" that its caller chooses to discard. Giving that route the same diagnostic is the obvious next step for whoever wants the contract total across routes; it needs a cell predicate in the shortcuts package, which is why it is not a one-line change.

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

`packages/tooling/conformance/scenarios/fe6-cell-parity.spec.ts` is the net, and it runs on Chromium, Firefox, and WebKit. It exercises the supported rows against a live cell — text entry, caret movement inside the cell, Tab to the next cell, undo — and holds the declared-unsupported row to three claims: the document bytes do not change on any engine, Chromium and WebKit route the bold accelerator as `formatBold` while Firefox does not, and where the route exists the decline is reported as `cell-capability-unsupported` naming the capability and the surface.

Two facts the scenario had to work around, recorded because both are easy to rediscover the hard way:

- The harness's per-step standing check compares the DOM against a **text** selection authority. Cell editing holds a `cell` selection, so that check can only answer "unchecked", and `standingFilter` treats unchecked as a failure on purpose (skip-as-success was a real hole once). In-cell scenarios therefore drive the keyboard through `page` and assert their own invariants, as `t6-cell-editing-arrows.spec.ts` already did.
- `window.__penConformance.documentText` walks block text, and a table block's own text is empty because its cells own theirs. Assertions about cell content read the cell.
