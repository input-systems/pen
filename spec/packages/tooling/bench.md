# @input/pen-bench

## Purpose

Performance benchmarks for Pen

## Public Role

Support development, testing, benchmarking, or local integration workflows around Pen.

## Key Exports / Entrypoints

- Export map: `.`
- Runner: `bench()`, `runSuite()`, `runAllSuites()`, `createBenchSuites()`
- Gating: `evaluateBenchResult()`, `isCriticalBench()`, `getBenchTarget()`, `BENCH_GATE_SAMPLE_SIZE`
- Envelope and scale baselines: `buildEnvelopeRecord()`, `compareEnvelopeDrift()`, and their tolerance helpers
- Fixtures: `createLargeDocument()`, `createScale3Editor()`, `createEnvelopeEditor()`, `createScale3RealisticEditor()` and `observeScale3Realistic()` (SCALE3 realistic variant: real `aiExtension` with staged suggestions and real `searchExtension` with an active query, gated on `baselines/scale3-realistic.counts.json`)
- Baselines: `baselines/envelope.json` (SCALE1), `baselines/scale3.json` (SCALE3 clocks), `baselines/scale3-peers.json` (SCALE3 synced-peer counts), `baselines/v3-anchor-budget.chromium.json` (PG1)
- Reporters: `reportConsole()`, `reportJSON()`
- Workspace scripts: `bench`, `bench:ci`, `bench:envelope`, `bench:envelope:renderer`, `bench:anchors`, `bench:scale3:realistic`, `bench:scale3:peers`, `build`, `clean`, `dev`, `lint`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: none declared. The workspace packages it measures (`@input/pen-core`, `@input/pen-test`, `@input/pen-ai`, and others) are devDependencies, because a benchmark harness is not something a host installs — but the package does not run without them.
- Peer dependencies: No peer dependencies declared.
- Boundary: Tooling packages serve the workspace and advanced integrators more than standard runtime embedding.

## Data Flow / Runtime Model

Tooling package packages in Pen should stay package-first and explicit about ownership. Use these packages in development flows, tests, or benchmarks.

## Recording the envelope

The SCALE1 envelope is recorded with `pnpm --filter @input/pen-bench run bench:envelope:write`, which runs the SCALE1 suite at `ENVELOPE_SAMPLE_SIZE`, subtracts the harness floors, and writes `baselines/envelope.json` and `ENVELOPE.md`. The record is `status: "envelope"` when the one-minute load is at most 35% of logical CPUs and `provisional` otherwise; a provisional record is not committed as the envelope. The table's clock wording follows the record's `loadTaken` rather than hard-coded dates, and fixture rows whose `clockTrust` is `record` inherit it. `tolerance` is not edited in a re-record, so a rung whose attributed median falls below 0.5ms becomes record-only by the formula. `scripts/bench-envelope-drift.mjs` fails when the committed table does not match the committed JSON.

## Integration Notes

- Path in workspace: `packages/tooling/bench`
- Spec path mirrors workspace path: `packages/tooling/bench.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.

## Current Maturity / Intended Usage

Workspace package at version `0.4.0`; intended usage is current-state but still evolving.

## Non-goals

Do not present tooling packages as the editor runtime itself.
