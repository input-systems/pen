# Built-in command catalog

Frozen names from `spec/rules/commands.md`. Caret (except verticals), text, structure, table, and history handlers live in this directory. `installEditorCommandRegistry` wires `createCommandRegistry` + `builtinCommandHandlers` onto `createEditor`.

Field-editor keydown (`handleFieldEditorKeyDown`) and beforeinput (`DIRECT_HANDLERS`, expanded backend) dispatch those handlers through `getCommandRegistry(editor).dispatch`. Local `apply*` / `moveCaretAcrossBlocks` functions remain as compatibility exports and no-registry fallbacks. `pen.caretUp` / `pen.caretDown` have handlers: geometry via `setVerticalCaretMeasure` (G5), logical block-edge crossing when no measure is registered. Field-editor ArrowUp/Down dispatch these directly.

Owner:

- **core** — headless handler registered at `default` precedence in `caret.ts`, `text.ts`, `structure.ts`, `table.ts`, or `history.ts`.
- **field-editor** — a named handler for this command still lives in `packages/rendering/dom/src/field-editor/` (not moved this slice).
- **not-yet-moved** — token exists; no registered handler in core or field-editor.

Keymap: `defaultKeymap.ts` is the K2 platform table, including bindings for the two unmoved vertical caret commands. `resolveDirectedBinding` is the K1 / M2 rtl swap (arrow + word only; table stays logical). Unbound by default: `pen.caretBlockStart`, `pen.caretBlockEnd` (callers dispatch them; no key). `pen.convertBlock`, the four structure commands, and `table.escapeGrid` are also unbound.

Related (not this file): `textSegmentation.ts` is the shared Segmenter module.

## Caret (`caret.ts`)

Param `{ extend: boolean }` unless noted.

| Command | Param | Owner | Current name |
| --- | --- | --- | --- |
| `pen.caretLeft` | `{ extend }` | core | `handleGraphemeCaret` (`-1`) + atom-adjacent select. T4 at block boundary. T6 from `CellSelection` via `transitionCellSelection`. In-cell editing (a `CellSelection` with `text`) moves `text` and stays inside the cell. |
| `pen.caretRight` | `{ extend }` | core | `handleGraphemeCaret` (`1`) + atom-adjacent select. T4 at block boundary. Same T6 / in-cell `text` motion as `pen.caretLeft`. |
| `pen.caretUp` | `{ extend }` | core | G5 via `setVerticalCaretMeasure` (`measureNow` + `verticalCaretTarget`). No measure → logical previous-block landing (field-editor `moveCaretAcrossBlocks`). Document edge stays put. Mid-block without measure is a miss (wrap needs geometry). T6 from `CellSelection`. In-cell editing moves `text` to offset 0 (single-line). |
| `pen.caretDown` | `{ extend }` | core | Symmetric to `pen.caretUp`. In-cell editing moves `text` to the cell text end. |
| `pen.caretLineStart` | `{ extend }` | core | Visual line-box start (M3). Field-editor injects a DOM measure on `Symbol.for("pen.lineEdgeSeam")`; no measure → logical offset 0. Home is bound on macos and windows/linux. Not keymap-swapped. |
| `pen.caretLineEnd` | `{ extend }` | core | Visual line-box end (M3). Same seam and logical fallback as `pen.caretLineStart`. |
| `pen.caretBlockStart` | `{ extend }` | core | Offset 0 of the focus block. |
| `pen.caretBlockEnd` | `{ extend }` | core | Logical length of the focus block. |
| `pen.caretDocStart` | `{ extend }` | core | First normal position in document order. |
| `pen.caretDocEnd` | `{ extend }` | core | Last normal position in document order. |
| `pen.caretWordLeft` | `{ extend }` | core | `previousWordBoundary` via `textSegmentation.ts`. |
| `pen.caretWordRight` | `{ extend }` | core | `nextWordBoundary` via `textSegmentation.ts`. |
| `pen.selectAll` | `void` | core | T1 via `escalateSelectAll`. |
| `pen.selectBlock` | `{ blockId }` | core | BlockSelection of the named block. |

## Text (`text.ts`)

| Command | Param | Owner | Current name |
| --- | --- | --- | --- |
| `pen.insertText` | `{ text }` | core | Replace the current text selection / insert at caret. |
| `pen.deleteBackward` | `{ granularity }` | core | Grapheme/word/line within the block (F2); merge/select/convert at block start. Adjacent inline atom: first press **selects** (`selectAdjacentInlineAtom`); second press deletes via ordinary selection-delete. N2 mixed-boundary (text endpoint mid-paragraph, other endpoint a non-text 0..1 span): keep the text prefix/suffix and `delete-block` the structural end — do not escalate to `BlockSelection` of both. Pinned in `__tests__/mixedBoundaryDelete.n2.test.ts`. |
| `pen.deleteForward` | `{ granularity }` | core | Symmetric to backward, including merge at block end. Same select-then-delete for adjacent atoms. |
| `pen.insertLineBreak` | `void` | core | Insert `"\n"`. |
| `pen.splitBlock` | `void` | core | Split, list continuation, empty-list convert, heading → paragraph. |
| `pen.indent` | `void` | core | Port of `applyListTabBehavior` (`shiftKey: false`). |
| `pen.outdent` | `void` | core | Port of `applyListTabBehavior` (`shiftKey: true`). |
| `pen.toggleMark` | `{ mark; value? }` | core | `format-text` over a range. Collapsed caret is a miss (no pending-mark host). |
| `pen.convertBlock` | `{ blockId; newType; newProps? }` | core | `convert-block` plus parentId restore; unknown types emit `invalid-block-type`. |

## Structure (`structure.ts`)

| Command | Param | Owner | Current name |
| --- | --- | --- | --- |
| `pen.moveBlockUp` | `{ blockId? }` | core | `move-block` before the previous same-parent sibling. First sibling is a miss, not an error. |
| `pen.moveBlockDown` | `{ blockId? }` | core | `move-block` after the next same-parent sibling. Last sibling is a miss. |
| `pen.duplicateBlock` | `{ blockId? }` | core | Insert a copy after the original with a new id; selection lands on the copy. |
| `pen.deleteBlock` | `{ blockId? }` | core | `delete-block` on the target. The last remaining block is replaced by an empty paragraph. |

Block-selection delete is also handled by `pen.deleteBackward` / `pen.deleteForward` when the selection is a BlockSelection.

## Table (`table.ts`)

| Command | Owner | Current name |
| --- | --- | --- |
| `table.cellNext` | core | Port of field-editor Tab: linear cell step, clamp at last cell. Named in `defaultKeymap.ts` (`context: "cell"`). |
| `table.cellPrev` | core | Port of field-editor Shift-Tab: reverse linear step, clamp at first cell. |
| `table.cellDown` | core | Port of field-editor Enter: next row, same column, clamp at last row. |
| `table.escapeGrid` | core | Leave cell selection for the next visible block (else previous; else BlockSelection of the table). Unbound. |

Cell-editing arrows are `pen.caretLeft` / `pen.caretRight` / `pen.caretUp` / `pen.caretDown`, not extra `table.*` names. `handleTableCellKey` dispatches those commands (no RTL swap — table stays logical) and preventDefaults so they do not produce a keyboard `selectionchange`.

## History (`history.ts`)

| Command | Owner | Current name |
| --- | --- | --- |
| `history.undo` | core | Dispatches to the `undo.manager` facet / `editor.undoManager`. Named in `defaultKeymap.ts`. |
| `history.redo` | core | Same, `redo`. |

## Counts

| Owner | Names |
| --- | --- |
| core | 33 |
| field-editor | 0 |
| not-yet-moved | 0 |
| **total (frozen)** | **33** |

`pen.caretUp` / `pen.caretDown` have registered handlers. Geometry is injected with `setVerticalCaretMeasure`; until the field-editor host does that, dispatch still does the logical edge-crossing that `moveCaretAcrossBlocks` did, and mid-block wrap remains a miss. Successful left/right/word/line/doc motion clears `goalX` (G5). M5: vertical bindings and the measure `direction` argument are never RTL-swapped.

I6 headless half: `__tests__/keymapParity.headless.test.ts` iterates the default keymap table and dispatches every binding on the live registry. The browser-harness half is outstanding — do not compare `createEditor` to `createHeadlessEditor` in Node; they are the same factory.

Inline-atom delete (owner decision, applied 2026-08-23). First Backspace / Delete next to an atom SELECTs (`selectAdjacentInlineAtom`); the second press deletes through ordinary non-collapsed `handleDelete`. Live keystroke is `FieldEditorImpl` → `handleFieldEditorKeyDown` → `dispatchKeymapEvent` → `registry.dispatch`. `deleteAdjacentInlineAtom` remains a helper, not the live path. Pinned in `__tests__/inlineAtomDelete.test.ts` and field-editor `__tests__/commandsDelete.inlineAtomDivergence.test.ts`.

## Field-editor names that are not catalog commands

From `commands*.ts` / `keyHandling*.ts` / `keyBindingShortcuts.ts`: `applyListInputRule`, `setInlineMark`, `normalizeInlineOffset`, `getConvertBlockOps`, `handleFieldEditorKeyDown`, `handleEditorKeyBindings`, `collectKeyBindings`, `matchesKey`, `matchesBindingContext`, plus `commandsShared.ts` helpers. Do not invent catalog names for these.

`handleBlockSelectionArrow` / `handleBlockSelectionEnter` / `handleDeleteSelectionShortcut` (`utils/documentShortcuts.ts`) fold into caret / split / delete when those handlers move; they are not extra commands.
