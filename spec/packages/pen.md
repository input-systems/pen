# @input/pen

## Purpose

Batteries-included starter for Pen: the default preset plus editor constructors that apply it by default

## Public Role

Package the standard runtime stack for most adopters so they can start from a coherent default with one import and `createEditor()`.

## Key Exports / Entrypoints

- Export map: `.`
- Root exports: `createEditor()` and `createHeadlessEditor()` (core's constructors with an omitted `preset` defaulted to `defaultPreset()`), `defaultPreset()`, `DefaultPresetOptions`, and the re-exported types `CreateEditorOptions` and `Editor`
- Workspace scripts: `build`, `clean`, `dev`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-ai`, `@input/pen-core`, `@input/pen-tools`, `@input/pen-interop`, `@input/pen-schema`, `@input/pen-shortcuts`, `@input/pen-types`, `@input/pen-undo`
- Peer dependencies: No peer dependencies declared.
- Boundary: Presets compose existing runtime packages rather than becoming new architecture layers.

## Data Flow / Runtime Model

`defaultPreset()` is the only batteries-included composition path, and this package's `createEditor()` / `createHeadlessEditor()` apply it whenever the caller passes no `preset` — explicit `preset`, `schema`, and `extensions` options pass through to core unchanged. Core's bare `createEditor()` installs neither this stack nor a schema.

The preset's `resolve()` returns `createDefaultSchema()` plus, unless turned off, `toolsExtension()`, `deltaStreamExtension()` from `@input/pen-ai/stream`, `undoExtension()`, and `richTextShortcutsExtension()`. It always also installs `htmlClipboardExtension()` (`name: "html-clipboard"`), which contributes `{ html: htmlImporter }` through `clipboardFacet` (R8) so HTML paste works without a renderer-owned importer. That clipboard extension is on by default and opts out through `htmlClipboard: false`, like the other members of `DefaultPresetOptions` (`tools`, `deltaStream`, `undo`, `shortcuts`). `smoothStream` is off by default and opts in through `smoothStream: true` or a `SmoothStreamOptions` object (`smoothStreamExtension()` from `@input/pen-ai/stream`, ST7–ST9). Hosts can turn the defaults off or pass typed options to the composed packages. Hosts that need full control should skip the preset and register extensions explicitly through `createEditor({ extensions: [...] })`.

## Integration Notes

- Path in workspace: `packages/pen`
- Spec path mirrors workspace path: `packages/pen.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.
- This package's `createEditor()` is the standard rich-text stack; pass `preset: defaultPreset({ ... })` to turn members off, or a custom preset to replace the stack. Core's `createEditor()` includes no shortcuts and no stream extension. React and Vue `useEditor()` inject `defaultSchema` only; they still do not call this preset.

## Current Maturity / Intended Usage

Workspace package at version `0.2.2`; intended usage is current-state but still evolving.

## Non-goals

Do not treat presets as a replacement for explicit extension composition when hosts need custom policy.
