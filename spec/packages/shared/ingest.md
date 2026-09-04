# @input/pen-ingest

## Purpose

`@input/pen-ingest` is the Markdown parse and write-op construction layer. Import and profile-policy helpers live in `@input/pen-core`.

## Public Role

This package used to sit _under_ core (core imported it) and later re-exported the moved helpers. That dual path is gone (DL13): this package depends on `@input/pen-core` and hosts import those helpers from core. This package remains because importers and tools still call `parseMarkdownToBlocks()` and `buildDocumentWriteOps()` here.

## Key Exports / Entrypoints

- Export map: `.`
- Implemented here: `parseMarkdownToBlocks()`, `splitPlainTextLineBlocks()`, `buildDocumentWriteOps()`, and the structured-target types
- Import, profile-policy, and block-capability helpers (`blocksToOps()`, `normalizePendingBlocksForImport()`, `shouldExposeBlockInTooling()`, and siblings) export from `@input/pen-core` only
- Structured-target descriptor types for tools and autocomplete write flows
- Workspace scripts: `build`, `clean`, `dev`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-core`, `@input/pen-types`, `htmlparser2`, `mdast-util-from-markdown`, `mdast-util-gfm`, `micromark-extension-gfm`
- Peer dependencies: No peer dependencies declared.
- Boundary: `@input/pen-ingest` is a shared transformation library and should not become an end-user entrypoint or runtime authority package.

## Runtime Model

`@input/pen-ingest` turns content-like inputs into normalized pending blocks and operation lists that higher-level packages can safely apply:

```mermaid
flowchart TD
  Inputs[MarkdownBlocksOrToolInputs]
  Parse[ParseOrCoerceContent]
  Normalize[NormalizePendingBlocks]
  Policy[ProfilePolicyAndDiagnostics]
  Ops[BuildDocumentOps]
  Higher[HigherLevelPackages]

  Inputs --> Parse
  Parse --> Normalize
  Normalize --> Policy
  Policy --> Ops
  Ops --> Higher
```

Important rules:

- Pending blocks are intermediate structures, not final editor truth.
- Schema and document-profile policy still decide what survives normalization.
- This package prepares operations and diagnostics, but a higher-level package still decides when to call `editor.apply(...)`.

## Integration Notes

- Path in workspace: `packages/shared/ingest`
- Spec path mirrors workspace path: `packages/shared/ingest.md`
- Use this package when building importers, AI/document tools, or structured write flows that need schema-aware normalization before mutation
- `buildDocumentWriteOps()` is especially important because it unifies text, markdown, and block-shaped write inputs behind one normalization path
- Keep package consumers responsible for runtime application, undo grouping, and UI affordances

## Current Maturity / Intended Usage

Workspace package at version `0.2.1`; intended usage is current-state but still evolving. It is already a high-leverage package because many higher-level features depend on its normalization and write-op rules staying stable.

## Non-goals

- Do not leak product-facing abstractions into generic shared helpers.
- Do not move editor state ownership or renderer behavior into this package.
- Do not let convenience parsing helpers become a substitute for higher-level policy or runtime boundaries.
