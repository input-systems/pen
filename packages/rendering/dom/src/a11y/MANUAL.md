# AX8 assistive-technology matrix

Screen-reader behavior cannot be fully automated. This checklist is the release matrix in `spec/rules/accessibility.md` AX8 (extends the IME matrix in `spec/rules/reliability.md`).

**Status: stub. Unexecuted.** Every matrix row is incomplete. No VoiceOver, NVDA, TalkBack, or JAWS session has been recorded. A release-train cut requires the VoiceOver and NVDA rows completed; TalkBack is in the matrix; JAWS is informational only.

Do not mark a row complete without a dated pass of all five scripted scenarios below. An agent cannot complete this checklist.

## One sitting (human)

Do **VO-mac first** (VoiceOver + Safari on macOS). That is the cheapest required row and takes one sitting if the host is already running.

1. From the repo root, start the playground UI: `pnpm dev -- --filter=@input/pen-playground...` — open `http://localhost:5173`.
2. Build a fixture that matches **Host and fixture** below (or load a document that already has those blocks). Confirm the surface has an `aria-label` from `pen.a11yLabel`.
3. Enable VoiceOver (`Cmd-F5`). Keyboard only after the page is loaded.
4. Run scenarios 1–5 in order. Tick the VO-mac boxes only after that session. Record tester, date, OS, VO version, Safari version, and host in the matrix row.
5. Leave every other row incomplete. NVDA needs a Windows machine; VO-ios needs a device; TalkBack and JAWS are later.

Known product bugs, so a fail here is not a setup error (rechecked 2026-08-21; do not treat an earlier "known failure" label as a diagnosis):

- **Autocomplete caret — original diagnosis is stale; whether speech/caret still fail is a real-browser question.** `contenteditableBackend.updateSelection` is no longer a no-op (it writes the authority's record into the field; the projector calls it). Accept already calls `selectText` + `commitProgrammaticTextSelection` (`packages/extensions/ai/src/autocomplete/autocompleteControllerLifecycle.ts` ~243–257). `DomScheduler.projectSelection` is no longer a stub: the field editor sets itself as the scheduler's projector, so the flush projects the queued record and honours a parked result. jsdom cannot tell whether WebKit/Firefox still leave the DOM caret behind. Outside `a11y/`.
- **Empty-document / block click — attributes are assertable; AT speech is not.** Pointer activation now resolves the clicked `[data-pen-editor-block]` (or host-chrome fallback to the first/last text block) rather than listening on a zero-width inline span (`packages/rendering/dom/src/host/pointerActivation.ts`). That path calls `activateTextSelection` + `attachElement` on the inline. The editor selection is a text caret, so `syncFocusSink` keeps the sink `aria-hidden="true"` / `tabIndex=-1` / no role. `bindEditorAnnouncer` does not write the live region (text caret, no atom). Focus stays on the field, not the sink — routing focus onto the sink is left to the selection redesign. Tab order: the sink is out of it; the textbox is the accessible surface. jsdom can lock the attributes and the empty live region. Whether VoiceOver/NVDA announce the empty textbox on click needs a real AT session (scenario 2).
- **Below-last-block host chrome activates, it does not stay inactive.** A click on the editor root / blocks host with `clientY` strictly below the last text block activates that block at its end offset (`pointerActivation.ts` ~167; `pointerActivation.hostClick.test.ts`). The a11y outcome is the same text-caret path as a block click (sink hidden, live region silent). The inactive case is the **gap between blocks** (and the jsdom zero-rect host-gap). Do not treat a tall-host click below the last block as a dead zone.

## Host and fixture

Run against a live editor (playground or `examples/react` / `examples/vue`), not jsdom.

Until a dedicated AX8 fixture is committed, assemble a document that includes at least:

- headings (`h1`–`h3` minimum)
- a bullet list and a numbered list
- a table with header cells
- a quote and a code block
- one atom/widget (image or unlabeled fallback)

The surface must carry an `aria-label` / `aria-labelledby` from `pen.a11yLabel`.

Read-only is two knobs. `pen.ariaReadOnly` **the facet** only sets `aria-readonly="true"` on the surface. It does not decline typing, does not stop `editor.apply`, and does not stop the wire. The `readonly` **prop** is what declines typing (pointer activation, React/Vue gesture guards). A host that only sets the facet gets an editor that announces itself read-only and then accepts edits. That split is intended — do not treat the facet as an edit gate, and do not fail this checklist for a facet-only host that still accepts keystrokes. When checking read-only *speech*, set the facet (or the prop, which also sets `aria-readonly`). When checking that typing is declined, set the prop.

Record per session: tester, date, OS, AT version, browser version, host (playground / example), fixture note.

Expected announcement strings are the English defaults in `packages/types/src/types/messages.ts` (`pen.a11y.*`). Hosts that override `pen.messages` must record the spoken override, not the default.

## Scripted scenarios

Run each scenario once per matrix row. Keyboard only unless a step says otherwise. Pointer is allowed only to load the host.

### 1. Fixture read-through

Read the document from the top with the AT's browse/virtual cursor (VoiceOver rotor / NVDA browse / TalkBack explore).

Pass when:

- the editing surface is announced as a multiline textbox with its label
- headings are announced as headings at the correct level
- lists are announced as lists with item counts
- the table is announced as a table; header cells have scope (row/column header, not generic cells)
- quote and code use native roles (`blockquote`, `pre`/`code`) rather than a generic group
- the atom is announced by its `a11y.label` (or type-name fallback)
- the overlay layer and hidden focus sink are **not** in the browse tree while they are presentation (`aria-hidden`)

Fail on silence for a labeled block, a visible atom with no name, or overlay/caret chrome spoken as content.

### 2. Typing echo

Focus the surface. Type a short word, then delete it, in a paragraph.

Pointer: a click anywhere in a text block (including an empty document's only paragraph) activates that field. A click on tall host chrome below the last block also activates the last field at its end. A click in the gap between blocks does not. After an activating click the sink stays `aria-hidden="true"` and the live region stays empty — do not expect an AX2 announcement. Whether the empty textbox is spoken is this scenario.

Pass when:

- each committed character (or IME-committed syllable) is echoed
- backspace/delete is audible
- the live region does **not** speak on ordinary keystrokes (AX2 announcements are for conversion, selection, suggestions, streaming — not per-character flood)
- mid-composition IME candidates stay in the field (caret-anchored popups must not steal DOM focus)

Fail on missing echo, doubled echo (field + live region), or focus leaving the field while composing.

### 3. Selection announcements (AX2)

From a caret in the fixture:

1. Convert a paragraph to a heading — expect `Converted to {blockType}`.
2. Undo, then redo — expect `Undid {hint}` / `Redid {hint}`.
3. Enter block selection and grow/shrink it — expect `{count} blocks selected` on enter and on change (rate-limited: one per key per 500ms, latest wins).
4. If the fixture has a table, extend a cell selection — expect `{rows} by {columns} cells selected`.
5. Move the caret onto an atom — expect `{atomType} selected`.

Pass when those phrases (or the host catalog override) are spoken once, politely, and rapid grow/shrink does not flood. Fail on silence, on two live regions speaking the same event, or on overlay rectangles being the only signal.

### 4. Popup navigation (AX3)

Keyboard only. DOM focus must stay in the editing field for caret-anchored popups.

1. **Slash menu** — type `/`, ArrowUp/Down/Home/End through options, Escape closes to plain typing, reopen, type a query such as `/head`, and Enter/Tab accept an insertion.
2. **Autocomplete** (if the host enables it) — same activedescendant pattern; accept one completion.
3. **Link editor** — open from the keyboard, edit, Escape restores the editing position.
4. **Drag-handle menu** — focus the handle, Enter/Space opens the menu, invoke move up/down, Escape restores origin.
5. **Table row/column menu** (if present) — open, insert a row, Escape restores.

Pass when:

- the field reports expanded/controls while a caret-anchored popup is open
- the active option is spoken as the user arrows
- Enter/Tab accepts and Escape closes
- accepting a slash-menu insertion leaves no `/query` text behind, so the listbox does not reopen when selection returns to that block
- no popup except an explicit dialog traps focus
- Vue hosts match React for every shipped primitive in this list

Skip a primitive only if it is not mounted in the host; record the skip. Do not skip slash-menu insertion.

### 5. Suggestion accept

Trigger an AI suggestion (inline suggestion or review flow the host ships).

Pass when:

- appearance speaks `Suggestion appeared`
- accepting (keyboard) speaks `Suggestion accepted` and the text is in the document
- rejecting speaks `Suggestion rejected` and the text is not committed
- streaming start/finish, if exercised, speak `Streaming started` / `Streaming finished` without flooding the queue

Fail on accept that is pointer-only, on missing appearance/accept speech, or on the suggestion state being color-only (underline + icon in reference styles; AX5).

## Matrix

| Row | AT | Browser | Platform | Gate | Status | Tester | Date | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VO-mac | VoiceOver | Safari | macOS | Required for release cut | Incomplete | | | |
| VO-ios | VoiceOver | Safari | iOS | Required for release cut | Incomplete | | | |
| NVDA-chrome | NVDA | Chrome | Windows | Required for release cut | Incomplete | | | |
| NVDA-firefox | NVDA | Firefox | Windows | Required for release cut | Incomplete | | | |
| TB-chrome | TalkBack | Chrome | Android | Matrix row | Incomplete | | | |
| JAWS | JAWS | Chrome or Firefox | Windows | Informational | Incomplete | | | |

Release cut: VO-mac, VO-ios, NVDA-chrome, and NVDA-firefox must be **Complete** (all five scenarios passed). TalkBack should be run when a device is available; it does not block the cut. JAWS notes are recorded when convenient and never treated as a gate.

## Per-row results

Copy a block per session. Leave unchecked until that scenario is run.

### VoiceOver + Safari (macOS) — incomplete

- [ ] 1. Fixture read-through
- [ ] 2. Typing echo
- [ ] 3. Selection announcements
- [ ] 4. Popup navigation
- [ ] 5. Suggestion accept

Notes:

### VoiceOver + Safari (iOS) — incomplete

- [ ] 1. Fixture read-through
- [ ] 2. Typing echo
- [ ] 3. Selection announcements
- [ ] 4. Popup navigation
- [ ] 5. Suggestion accept

Notes:

### NVDA + Chrome (Windows) — incomplete

- [ ] 1. Fixture read-through
- [ ] 2. Typing echo
- [ ] 3. Selection announcements
- [ ] 4. Popup navigation
- [ ] 5. Suggestion accept

Notes:

### NVDA + Firefox (Windows) — incomplete

- [ ] 1. Fixture read-through
- [ ] 2. Typing echo
- [ ] 3. Selection announcements
- [ ] 4. Popup navigation
- [ ] 5. Suggestion accept

Notes:

### TalkBack + Chrome (Android) — incomplete

- [ ] 1. Fixture read-through
- [ ] 2. Typing echo
- [ ] 3. Selection announcements
- [ ] 4. Popup navigation
- [ ] 5. Suggestion accept

Notes:

### JAWS (informational) — incomplete

Same five scenarios. Failures here do not block a release cut; record speech differences against the NVDA row.

- [ ] 1. Fixture read-through
- [ ] 2. Typing echo
- [ ] 3. Selection announcements
- [ ] 4. Popup navigation
- [ ] 5. Suggestion accept

Notes:
