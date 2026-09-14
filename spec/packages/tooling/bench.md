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
- Fixtures: `createLargeDocument()`, `createScale3Editor()`, `createEnvelopeEditor()`
- Reporters: `reportConsole()`, `reportJSON()`
- Workspace scripts: `bench`, `bench:ci`, `bench:envelope`, `bench:anchors`, `build`, `clean`, `dev`, `lint`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: none declared. The workspace packages it measures (`@input/pen-core`, `@input/pen-test`, `@input/pen-ai`, and others) are devDependencies, because a benchmark harness is not something a host installs — but the package does not run without them.
- Peer dependencies: No peer dependencies declared.
- Boundary: Tooling packages serve the workspace and advanced integrators more than standard runtime embedding.

## Data Flow / Runtime Model

Tooling package packages in Pen should stay package-first and explicit about ownership. Use these packages in development flows, tests, or benchmarks.

## Integration Notes

- Path in workspace: `packages/tooling/bench`
- Spec path mirrors workspace path: `packages/tooling/bench.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.

## Current Maturity / Intended Usage

Workspace package at version `0.2.3`; intended usage is current-state but still evolving.

## Non-goals

Do not present tooling packages as the editor runtime itself.
