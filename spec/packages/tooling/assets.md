# @input/pen-assets

## Purpose

In-memory asset provider for Pen

## Public Role

Support development, testing, benchmarking, or local integration workflows around Pen.

## Key Exports / Entrypoints

- Export map: `.`
- `memoryAssets()` is the sole entrypoint, with `MemoryAssetsOptions`: `maxSize`, `uploadUrl`, and the `rejectUpload` / `rejectAfterProgress` failure doubles
- Upload enforces `maxSize` and reports `onProgress(0)` then `onProgress(1)` with no intermediate ticks, so hosts cannot accidentally depend on a progress curve this store does not have
- `delete()` is implemented; nothing in Pen calls it
- Falls back to a data URL when `URL.createObjectURL` is absent, which is what makes the store usable under Node
- Workspace scripts: `build`, `clean`, `dev`, `lint`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-types`
- Peer dependencies: No peer dependencies declared.
- Boundary: Tooling packages serve the workspace and advanced integrators more than standard runtime embedding.

## Data Flow / Runtime Model

Tooling package packages in Pen should stay package-first and explicit about ownership. Use these packages in development flows, tests, or benchmarks.

## Integration Notes

- Path in workspace: `packages/tooling/assets`
- Spec path mirrors workspace path: `packages/tooling/assets.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.

## Current Maturity / Intended Usage

Workspace package at version `0.2.1`; intended usage is current-state but still evolving.

## Non-goals

Do not present tooling packages as the editor runtime itself.
