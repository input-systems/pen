# IME manual matrix

**Correction, 2026-08-23 (owner).** `suites/ime/` is no
longer an empty directory. Automation now has four specs
(`c1-escape-cancel`, `c2-remote-mid-composition`,
`c3-gboard-rapid`, `c4-editcontext-preferred`). Staffing
this directory (with `input` / `bidi` / `geometry` /
`overlays` / `selection`) found seven product defects;
C1, C2, and two C3 failures were among them. C1's
Chromium CDP Escape cancel is now automated. This matrix
is still the release-train check against real devices.
The suite is more honest, not merely bigger. A prior
106/106 three-engine figure tested none of these paths.

Automation covers Chromium CDP compositions and replayed
`compositionstart` / `update` / `end` traces. This matrix is the
release-train check against real IMEs. Tick every box before a
release cut (`spec/rules/reliability.md`, IME suite).

Release-blocking:

- [ ] macOS Kotoeri: multi-segment convert, Escape cancel (C1)
- [ ] macOS Kotoeri: remote edit mid-composition leaves the field
      DOM untouched; after commit a remote insert at the composition
      start, or inside a reconverted word, reads before the composed
      text, as two converged `Y.Doc`s would (C2)
- [ ] macOS Pinyin: candidate commit lands as one apply
- [ ] Windows IME (MS-IME Japanese / Pinyin): same C1 / C2 / commit
- [ ] iOS Safari: composition underline, cancel, commit
- [ ] Android GBoard: rapid commit cycle (C3) — no dropped first
      character when a second composition starts in the same turn
- [ ] Chromium EditContext preferred; contenteditable fallback when
      `EditContext` is missing (C4 / HOST4)

Playground, not the conformance harness. Record engine, OS, and IME
name next to each tick.
