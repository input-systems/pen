# @input/pen-bench

Performance benchmarks for Pen.

## CH8

Blocking budgets do not run on the shared `pnpm test` / `turbo run test` graph. They live on a dedicated serial job so a red check is a regression, not machine load (`09-reliability-testing.md` CH8, `11-audit.md` F38).

- `pnpm test` / `test:unit` run the fast correctness suite only. They do not enforce critical budgets.
- `pnpm --filter @input/pen-bench bench` runs `src/cli.ts` with target enforcement.
- `pnpm --filter @input/pen-bench bench:ci` runs the runner unit tests, then `src/cli.ts`, serially.

Critical budgets are judged on the **median of 50 measured iterations** (`BENCH_GATE_SAMPLE_SIZE`). P95 and Max are printed and stored as trend data. They are not gate inputs.

## SCALE1

The attributed envelope table is `ENVELOPE.md` in this package, generated from `baselines/envelope.json`. `@input/pen-test` publishes the size grades (verified / measured / untested above). This package owns the **counts** (the durable measure), the clocks, the harness floors, and the fixture-shape audit.

Counts are the published envelope. Wall-clocks in the table are load-taken 2026-08-20 and must be re-measured on a quiet machine. A row without a fixture count is not a measurement. A wall-clock without a harness floor is not attributed to Pen.

The concurrent-peers row is verified as a count (2) plus observation: peer A inserts, peer B must contain that insert after `sync()` before the clock starts. The timed work is A insert + sync, not concurrent A+B. An earlier published number timed two independently-populated Y.Docs that never collaborated.

- `pnpm --filter @input/pen-bench bench:envelope:drift` is the named count gate. `--fresh <record.json>` compares that record to the committed envelope and exits non-zero by row name. A missing file also exits 1. No `--fresh` measures live fixture counts against the committed table.
- `pnpm --filter @input/pen-bench bench:envelope` runs the ladder (median of 21, floor subtracted) and fails if a same-class gated rung exceeds the committed gate. Do not run this to re-record under load.
- `pnpm --filter @input/pen-bench bench:envelope:write` regenerates `baselines/envelope.json` and `ENVELOPE.md` from a fresh run.
- Same-class clock gate: rungs whose attributed p50 is at least 0.5ms are gated at `max(attributed × 3, attributed + 1ms)`. Below that the clock is timer noise. P95 is recorded, not gated (CH8). Cross-class (macos-arm64 vs ubuntu-latest) is not compared. Count drift is compared on every class.
- `.github/workflows/bench.yml` runs `bench:envelope` after `bench:ci`. The size-grade table (`packages/tooling/test/ENVELOPE.md`) is diffed against its generator by the same `bench-envelope-drift` repo gate as this package's table.

## SCALE3

The SCALE3 suite measures one user keystroke in an envelope-sized document with the stack hosts ship: the default preset (`tools`, `delta-stream`, `undo`, `rich-text-shortcuts`) plus no-op stand-ins for AI, suggestions, autocomplete, search, and multiplayer. The stand-ins keep those extension names and the observe/decoration hooks; they do not import the AI packages, so the number is commit-dispatch cost rather than model runtime.

Each bench isolates one axis at a declared point. The set covers document size (100 / 1000 blocks), extension count (shipped 9 / shipped+8), decoration count (0 / 256), and remote-caret count (0 / 8). The last axis is eight `data-pen-remote-caret` decorations on the multiplayer stand-in, not eight synced Y.Docs — N-synced-peer scaling is not a SCALE3 measurement (SCALE1 covers two concurrent peers). The 1000-block shipped stack is the shared second point on the last three axes.

SCALE2's eight no-op decorating extensions are the plus8 point. `bench:ci` compares that median to the same-run 1000-block shipped-stack median (`max(base × 2, base + 15ms)`). That is a dispatch-cost bound, not a decoration-identity proof.

Baselines live in `src/constants/scale3.ts` with the machine class that produced them. The isolated job compares the median to `gateP50Ms` (measured median plus CI slack), not to an invented frame budget.

Waivers are the committed empty document at `spec/benchWaivers.json` (API10). `run.ts` loads that file via `--waivers`, a cwd walk, or the package-local path. `test` joins the workspace suite for the unit checks; the long `bench` / `bench:ci` / `bench:envelope` runs stay on their own scripts.

## SCALE4

`src/soak/run.mjs` samples `heapUsed` across a headless session (edits, undo/redo, two-peer remote updates, `openTextStream`, create/destroy). The trend is printed. The only hard assertion is post teardown-and-recreate vs baseline (`TEARDOWN_HEAP_MULTIPLE`, derived from measured 24-iteration `--expose-gc` runs). Nightly: `.github/workflows/soak.yml` with `SCALE4_SOAK_ITERATIONS=400`.

## Install

```bash
pnpm add @input/pen-bench
```

## Usage

Hosts do not import this package into an editor. Run it from the workspace:

```bash
pnpm --filter @input/pen-bench bench
```

```ts
import { BENCH_GATE_SAMPLE_SIZE } from "@input/pen-bench";

void BENCH_GATE_SAMPLE_SIZE;
```

Critical budgets use the median of `BENCH_GATE_SAMPLE_SIZE` (50) measured iterations.

## Options

This package has no editor options. The CLI reads committed baselines and `spec/benchWaivers.json`; those are not create-function defaults.

## Documentation

The docs site (the `@input/pen-docs` package) covers runtime floor notes on the Browser and Node page (`#/support`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
