# @input/pen-autoformat

## Purpose

Markdown shortcut input rules for Pen — auto-format as you type

## Public Role

Add optional runtime behavior on top of the editor core without changing the canonical mutation authority.

## Key Exports / Entrypoints

- Export map: `.`
- Workspace scripts: `build`, `clean`, `dev`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-core`, `@input/pen-types`
- Peer dependencies: No peer dependencies declared.
- Boundary: Extensions compose through the core editor and slots/events rather than side channels. The extension publishes a rules engine on `inputRulesEngineFacet` / `INPUT_RULES_ENGINE_SLOT_KEY` and rewrites matching input from an `onBeforeApply` hook; `@input/pen-dom` reads that engine facet.
- Rules are bypassed for the `input-rule`, `collaborator`, `import`, `history`, and `system` origins, so a rule cannot fire on a peer's text or on its own rewrite.
- Not installed by `defaultPreset()`. This is opt-in like `@input/pen-search`.

## Data Flow / Runtime Model

Extension package packages in Pen should stay package-first and explicit about ownership. Adopt this package only when the host app needs the capability it provides.

## Integration Notes

- Path in workspace: `packages/extensions/autoformat`
- Spec path mirrors workspace path: `packages/extensions/autoformat.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.

## Current Maturity / Intended Usage

Workspace package at version `0.2.2`; intended usage is current-state but still evolving.

## Non-goals

Do not duplicate core editor authority or renderer ownership inside the extension.
