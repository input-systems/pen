# @input/pen-schema

## Purpose

Default block and inline schemas for Pen

## Public Role

Ship the default block and inline definitions used by most applications and tests.

## Key Exports / Entrypoints

- Export map: `.`, `./defs`
- `createDefaultSchema()` and the prebuilt `defaultSchema`
- Named block defs such as `paragraph`, `heading`, `table`, `callout`, `blockquote`, `toggle`, `checkListItem`, and `subdocument`, plus named marks/inlines such as `bold`, `link`, `mention`. Inline atoms reserve `type` as the embed discriminator (the schema-reservation SCH1 in `packages/core.md`, not the DOM scheduler SCH1); none of the shipped node inlines declare that prop. Shipped node inlines already set `serialize.toMarkdown` / `toHTML`; they do not need `toText` because IOP8 falls back to `toMarkdown` for `text/plain`.
- `./defs` also exports the `defaultBlocks` and `defaultInlines` collections. `defaultBlocks` is a heterogeneous `BlockSchema[]` with no assertion — `content: "none" | "table" | "subdocument"` entries are bare `BlockSchema` because the generic default is `ContentType` (API10).
- Display-catalog helpers: `SCHEMA_DISPLAY_CATALOG`, `resolveDisplayCopy()`, `resolveDisplayGroup()`, `schemaDisplayKey()`, `schemaGroupKey()`
- Workspace scripts: `build`, `clean`, `dev`, `lint`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-core`, `@input/pen-types`
- Peer dependencies: No peer dependencies declared.
- Boundary: It defines the standard authored surface but does not own runtime authority.

## Data Flow / Runtime Model

Schema surface packages in Pen should stay package-first and explicit about ownership. Use it directly or as the starting point for custom schema composition.

## Integration Notes

- Path in workspace: `packages/schema`
- Spec path mirrors workspace path: `packages/schema.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.

## Current Maturity / Intended Usage

Workspace package at version `0.2.1`; intended usage is current-state but still evolving.

## Non-goals

Do not hide product policy or renderer-specific styling decisions here.
