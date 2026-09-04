# @input/pen-markdown

## Purpose

Shared markdown serialization helpers for Pen

## Public Role

Provide shared lower-level helpers used by higher-level packages.

## Key Exports / Entrypoints

- Export map: `.`
- Owned here: `exportMarkdownForBlocks()`, `exportMarkdownRange()`
- Workspace scripts: `build`, `clean`, `dev`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-core`, `@input/pen-types`
- Peer dependencies: No peer dependencies declared.
- Boundary: Shared packages support package boundaries without becoming end-user entrypoints.

## Data Flow / Runtime Model

This package still owns markdown serialization (`exportMarkdownForBlocks()`, `exportMarkdownRange()`). The old `core → markdown` inversion is gone.

## Integration Notes

- Path in workspace: `packages/shared/markdown`
- Spec path mirrors workspace path: `packages/shared/markdown.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.

## Current Maturity / Intended Usage

Workspace package at version `0.2.3`; intended usage is current-state but still evolving.

## Non-goals

Do not leak product-facing abstractions into generic shared helpers.
