# @input/pen-shortcuts

## Purpose

Headless keyboard shortcut extension for Pen

## Public Role

Add optional runtime behavior on top of the editor core without changing the canonical mutation authority.

## Key Exports / Entrypoints

- Export map: `.`
- Primary extension entrypoint: `richTextShortcutsExtension()`
- Workspace scripts: `build`, `clean`, `dev`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-core`, `@input/pen-types`
- Peer dependencies: No peer dependencies declared.
- Boundary: Extensions compose through the core editor and slots/events rather than side channels. Core does not install this package.

## Data Flow / Runtime Model

`richTextShortcutsExtension()` publishes bindings on `keymapFacet` (`pen.keymap`). Bare `createEditor()` does not include these shortcuts; `defaultPreset()` does.

## Integration Notes

- Path in workspace: `packages/extensions/shortcuts`
- Spec path mirrors workspace path: `packages/extensions/shortcuts.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.

## Current Maturity / Intended Usage

Workspace package at version `0.2.3`; intended usage is current-state but still evolving.

## Non-goals

Do not duplicate core editor authority or renderer ownership inside the extension.
