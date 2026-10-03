# @input/pen-conformance

Private Playwright harness for conformance. Never published.

## Two gates, not one

`pnpm --filter @input/pen-conformance test` is **Node host locks only** (`src/hosts/*.test.js`). It does not start a browser and it does not run `scenarios/` or `suites/`. A green `pnpm test` is not conformance. The Playwright gate is `test:chromium` / `test:matrix` (CI job `conformance-engine` in `.github/workflows/conformance.yml`).

Standing DOM↔authority has three results: **matched** (checked and equal), **mismatch** (checked and unequal), **unchecked** (could not check — unfocused or non-text). Unchecked is not success. `caretCacheHolds` fails when `missingCount > 0`, not only when `staleCount > 0`.

Standing assertions (`assertStandingDiagnostics`, `assertStandingDomMatchesAuthority`), axe analyzers (`analyzeEditorSurface`, `analyzeEditorWcag22Aa`), `harness/src/geometry.ts`, and most of `harness/src/session.ts` are **Playwright-only**. Their extractable predicates live in Node (`standingFilter`, `axeFormat`, `domAuthorityCompare`, `geometryCompare`, `serialize`). The wrappers themselves need a page.

`domAuthorityCompare` compares the live DOM selection to `editor.selection`. That name is not `authorityCompare`. The recorded-trace replay lives in `src/authorityCompare.ts` (`pnpm --filter @input/pen-conformance exec node --experimental-strip-types --test src/hosts/authorityCompare.test.js`). Do not use `--test-name-pattern`: a pattern matching nothing still reports the file itself as a passed test and exits 0. The Playwright form is `pnpm --filter @input/pen-conformance run test:chromium -- scenarios/authorityCompare.spec.ts` — a missing file exits 1; `--grep authorityCompare` starts Chromium and reaches the harness copy, not this Node replay. The committed corpus is split/merge/remove with mapPoint algebra landings; a live copy-split that stays on the source must mismatch, not pass.

The scenario gate is a separate command:

```bash
pnpm --filter @input/pen-conformance run test:chromium
pnpm --filter @input/pen-conformance run test:matrix
pnpm --filter @input/pen-conformance run test:axe
pnpm --filter @input/pen-conformance run test:ax3
pnpm --filter @input/pen-conformance run test:ax6
pnpm --filter @input/pen-conformance run test:scale5
pnpm --filter @input/pen-conformance run test:host4
```

- `harness/` — Vite app: one v1-preset editor, fixture loader, `window.__penConformance`
- `src/` — scenario DSL, standing assertions, and lint scripts
- `scenarios/` — scripted journeys (hello-world, harness self-test, feature suites)
- `suites/` — selection (live I4/P1/S3/S5/S6), input (K1/K2/K4/B1/B2), ime (C1–C4 plus `MANUAL.md`), bidi (M2/M3/DIR2), overlays (O1/O2), geometry (G2), fuzz (the W3.R19 DOM fuzzer: seeded S2/S5/S6 walks over `fuzz-mixed`, `pnpm run fuzz:dom -- --project <engine>`, traces in `test-results/fuzz-dom/`). Other live wiring stays in `scenarios/` and `harness-live.spec.ts`.
- `fixtures/` — documents plus the diagnostics allowlist
- `fixtures/hostile/` — attacker corpus (`window.__xssProbe` canary)

## Known defects — four DOM fuzz seeds (2026-10-03)

**The DOM fuzzer's four PR seeds (`suites/fuzz/dom-fuzz.spec.ts`, W3.R19) all find a product defect on their first run, and each is an entry.** One `knownDefect: KNOWN_FUZZ_DEFECTS[seed]` line carries the four, so `rg -c 'knownDefect:' suites/` counts it once. Each symptom is the shrunk trace's (`PEN_FUZZ_SHRINK=1`) first failure, measured on Chromium; WebKit fails the same seeds at other steps. A seed whose defect is fixed reports as unexpectedly passing, and then runs on to its next failure or to step 40.

The ledger was empty from 2026-08-24 until then. N2 mixed-boundary pointer delete was filed and closed the same day; its two scenarios in `suites/selection/n2-mixed-boundary-delete.spec.ts` now pass on Chromium, WebKit and Firefox, and the annotations are deleted as the fix's last step.

N2 mixed-boundary pointer delete was filed and closed the same day; its two scenarios in `suites/selection/n2-mixed-boundary-delete.spec.ts` now pass on Chromium, WebKit and Firefox, and the annotations are deleted as the fix's last step.

**N2 is worth reading before you file an entry, because the diagnosis was wrong twice while the tests were right throughout.** The working theory was an escalation to `BlockSelection`, and the search was for the writer performing it. There was none: the drag produced a `TextSelection` on every engine, and the defect was the _offset_ on its structural endpoint (`d1@0` does not cover a `0..1` block), plus a separate WebKit/Firefox bug snapping the drag's text start to the paragraph end. Two engines failed the same scenario for two different reasons.

Two habits would have shortened it. First, **read which assertion failed**, not that the scenario failed — the first assertion (paragraph prefix survives) was already passing, and only the second (divider removed) was red, so the symptom in the entry's own title was stale. A multi-assertion scenario reports one aggregate result and that result does not name the cause. Second, when a hypothesis survives two eliminations, **re-read the raw observation** rather than extending the hypothesis to a third writer.

The related trap is still real and still worth stating: `selectionReader.test.ts` asserts "does not escalate a mixed text/structural range to BlockSelection", the reader really does refuse, and the test really does pass. A correct component with a green test is not evidence of a correct product when something else can write the same state — it just was not what was wrong this time.

**The nine earlier entries are all fixed too.** The section keeps its mechanism and reasoning because that is what future entries need — if you are adding one, read the rules below first.

Staffing the empty `input` / `ime` / `bidi` / `geometry` / `overlays` directories found **six product defects**, plus one entry that turned out not to be a product defect at all (see K2 below). The suite did not get worse; it got honest — it previously reported 106/106 on three engines while testing none of these paths, so that figure measured coverage we did not have.

**All six are now fixed, five of them within a day of being filed, and that is the argument for the staffing rather than a footnote to it.** K1: unbound owned navigation keys now `preventDefault`. M3: `Home`/`End` are bound on macOS and resolve the visual line edge through an injected measure. C2: the EditContext path defers remote deltas while composing, which the contenteditable path already did. Both C3 entries: the `Date.now() < 50` plus rAF gate is replaced by the composition event sequence itself. C1 closed last, on 2026-08-24 — see below, because the shipped fix is not the one this section predicted. Each fix deleted its own annotation as its last step, so the table below is the count of live annotations rather than a history — it held zero between C1's fix and N2's filing on the same day, then N2 closed the same day.

**Two T4 entries joined the ledger on 2026-08-23 and were fixed on 2026-08-24.** They are recorded here because their SOURCE was different from the other six, and that difference is the transferable part. They did not come from staffing an empty directory; they came from writing the first keystroke-level scenario for a rule the repo already believed it had implemented. That is the spec-port-audit pattern rather than the coverage-gap pattern: `caret.ts` implemented T4 correctly and its registry tests passed, but no real Arrow key reached it — after T1's second `Mod-a` deactivated the field editor, capture-phase `keydown` landed in `documentShortcuts.ts`, whose own arrow handler ignored `shiftKey`, addressed first/last rather than `head`, returned false at the document edge, and never consulted the keymap.

So a ledger entry can mean either of two things: a path nothing tested, or **a path tested only through an API the keystroke does not use**. The second kind is invisible to a passing test suite by construction, which is why a green registry test was not evidence that the rule shipped.

The rules for any future entry, which are what kept this ledger draining rather than growing. An entry's scenario asserts what the spec requires and carries `knownDefect`, which marks it expected-to-fail. `Conformance / Chromium` is not `continue-on-error`, and a job that is permanently red is one nobody can act on — that is how a blocking engine sat red for a week unnoticed. When a defect is fixed, Playwright reports the scenario as **unexpectedly passing** and the job goes red until the annotation is deleted. Removing the annotation is the fix's last step.

To check the ledger, match the annotation and not the word:

```sh
rg -c 'knownDefect:' suites/   # no output + exit 1 = empty
```

`rg -c knownDefect suites/` is the wrong pattern and currently reports a false entry: `suites/geometry/g5-arrow-keystroke.spec.ts` mentions the identifier in prose to explain why that skip is deliberately **not** a known defect. A check that cannot distinguish an annotation from a sentence about annotations will report this ledger as non-empty forever.

`knownDefect` means "the spec is right and the product is wrong". It is **not** for a harness limitation — the clipboard paste scenario is `test.skip` on non-Chromium because Playwright lacks those permissions there, and putting that in this table would file a harness gap as a product defect.

Re-verify rather than trust: an expected-failure also absorbs a failure for the _wrong_ reason, so every entry records its observed symptom verbatim in the annotation.

**K2 was that wrong reason, and it is the first measured instance of the cost this section warns about.** It was recorded as "nested toggle child never mounts", routed to the toggle renderer and `useParentIdChildBlockIds`. Both were correct. The `nested-toggle` fixture put the child in a TestBlock `children` array, which `populateYDoc` writes as a layout `Y.Array` and does **not** add to `blockOrder` — while toggles nest as siblings in `blockOrder` carrying a `parentId` prop, which is what `parentIdTree` filters on. The hook returned `[]` correctly and the open toggle rendered its empty state. The fixture had the `parentId` prop set right and nested the block anyway; the nesting won.

Two things kept it recoverable. The verbatim symptom named `hasBody:false` alongside a populated `blockIds`, which is what made the fixture the suspect rather than the renderer. And the annotation is a marker, not a mute — the scenario kept asserting the spec throughout, so nothing had to be un-weakened to re-check it. The fixture-shape lock now rejects `children:` for this fixture by name, so the shape cannot come back silently.

| Rule | Scenario                                                                                                                                  | Route                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| S2   | `S2/S5/S6: DOM selection fuzz, seed 11` — click `fuzz-list-3`@6, Shift+ArrowDown: authority focus `fuzz-code`@7, DOM `fuzz-code`@1        | pen-dom reader/caret: the code block's structural role against a text authority (W3.R10) |
| S2   | `… seed 23` — drag `fuzz-zwj`@5 → `fuzz-after-divider`@12 across the divider: two `selection-projection-mismatch` on the expanded surface | pen-dom projector, expanded surface (W3.R1)                                              |
| S2   | `… seed 37` — drag `fuzz-code`@21 → `fuzz-list-3`@3 upward: DOM focus stays at `fuzz-code`@0                                              | pen-dom pointer path out of a code block (W3.R12)                                        |
| S2   | `… seed 41` — Mod-z right after load undoes a load-time commit; selection null, focus on `BODY`, `selection-projection-mismatch`          | undo restoring a null selection (W3.R16)                                                 |

**C1 was fixed on 2026-08-24, and the shipped fix is not the candidate this section proposed — the candidate was wrong for a measurable reason worth keeping.** The proposal was "hold `handleTextUpdate`'s apply until the end of the same turn, then resolve on `compositionend`". Measuring Chromium's real CDP order refuted it: `textupdate` arrives in task 1 with composing still closed, microtasks run with composing still closed, and `textformatupdate` only opens the session in task 2. A same-turn hold therefore still commits before composing opens — the original bug, delayed one tick. `compositionend` never fires at all on Escape or on `Input.insertText`, so the proposed resolution point does not exist.

What shipped instead is a rewind, still sequence-based with no timer or rAF: ordinary `textupdate` applies immediately, which leaves the C4 typing path untouched; `textformatupdate` then rewinds that apply with a `delete-text` at `origin: "system"`, keeps the DOM preview, and holds the text; Escape or an empty `compositionend` drops the hold and reconciles from authority; and a later non-empty `textupdate` — which is what `Input.insertText` produces — commits the held text through the normal apply path.

This is the second time on this ledger that a plausible sequencing fix was **byte-identically wrong in the browser while green in Node**, and both times the disproof required measuring the real event order rather than reasoning about it. A Node test can pin the hold; it cannot tell you which task the session opens in.

Residual, deliberately not fixed here: the speculative apply uses `origin: "user"` and the rewind uses `origin: "system"`, so after an Escape a user undo entry for the discarded insert may remain on the stack. Not required for C1 or C4, and it wants an undo-focused pass rather than a tail-end change.

**T4 was fixed on 2026-08-24 in `documentShortcuts.ts`** — shared by the vanilla, React and Vue hosts — and the predicted trap held: deleting the v1 interceptor would not have been sufficient. The document-level handler never called `dispatchKeymapEvent`, so with the interceptor merely removed, Shift+Arrow and document-edge Arrow would still have no-opped; they would just have no-opped somewhere else. The handler now dispatches `pen.caretUp/Down/Left/Right` with `extend` taken from `shiftKey`, behind a `selection.type === "block"` guard so text carets and cell selections are not claimed. Nothing in `caret.ts` changed, which is the tell that the defect was a routing gap rather than a rule gap. Verified on all three engines after a rebuild.

Keeping the block-type guard matters beyond tidiness: `handleTableCellKey` still returns `false` for arrows so native cell caret motion is not `preventDefault`ed, and a later change that dropped the guard and routed _every_ document-level arrow through the keymap would eat cell caret motion.

`window.__penConformance.isCollapsed()` is the official `@input/pen-core` helper over the live editor selection. Do not read a live `selection.isCollapsed` property; the selection redesign is removing it. The serialized DTO field is a snapshot computed at serialize time, not that live property.
