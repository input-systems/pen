# @input/pen-vue

## Purpose

`@input/pen-vue` provides Vue rendering primitives for Pen. It is the shipped proof that Pen's editor lifecycle, field-editor integration, selection model, and renderer overrides work outside React.

## Public Role

This package gives Vue applications a lean but real renderer surface: core editor components, composables for editor-derived state, shared DOM field-editor integration, and a simple plugin for global component registration. Its strategic role is broader than its API size, because it validates the cross-framework architecture.

## Key Exports / Entrypoints

- Export map: `.`, `./plugin`
- Root exports such as `PenEditor`, `PenContent`, `PenBlock`, `PenInlineContent`, and `PenFieldEditor`. The `PenEditorProps` interface is declared on the component but is not on the barrel; `PenTableCellContent` is likewise internal.
- Composables such as `useEditor`, `useSelection`, `useBlockList`, and `useDecorations`
- Plugin export: `PenVuePlugin`
- Public renderer and paste-importer types such as `RendererOverrides` and `PasteImporters`
- Workspace scripts: `build`, `clean`, `dev`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-core`, `@input/pen-dom`, `@input/pen-interop`, `@input/pen-schema`, `@input/pen-types`
- Peer dependencies: `vue`
- Boundary: `@input/pen-vue` depends on `@input/pen-dom` and `@input/pen-core` and should stay lean.

## Runtime Model

The Vue renderer follows the same architectural split as React, but with a deliberately smaller public surface:

```mermaid
flowchart TD
  VueApp[VueApp]
  Components[VueComponents]
  Composables[VueComposables]
  Dom["@input/pen-dom"]
  Core["@input/pen-core"]

  VueApp --> Components
  Components --> Composables
  Components --> Dom
  Composables --> Core
  Dom --> Core
```

Important responsibilities:

- Mount the editor and shared field-editor engine in a Vue host
- Expose key editor-derived state through composables instead of duplicating state inside components
- Register the field editor and paste assets with `internals.assignSlot`. When the host omits `importers`, `PenEditor` still defaults `paste:importers.html` to `htmlImporter` from `@input/pen-interop/html`. Also wires focused/read-only/empty root attributes and `bindEditorDocumentKeyDown()` from `@input/pen-dom` (HOST7/HOST8: Escape and Enter bubble; other document shortcuts stay in capture).
- Pointer activation listens on the editor root and resolves through `handleFieldEditorPointerActivate()` against the blocks host. It does not listen only on the inline-content span (without chrome that surface is zero-width on an empty document). Host-chrome clicks above the first block or below the last use the same fallback as vanilla: that inline-text block at start or end. The gap between blocks stays inactive.
- Idle `PenInlineContent` and `PenTableCellContent` pass `{ editor }` into `fullReconcileDeltasToDOM` so `pen.urlPolicy` cannot be skipped by omitting a policy. The image fallback on `PenBlock` resolves `src` with `resolveEditorUrl(editor, src, "image")`. Denied URLs omit the attribute and set `data-pen-blocked-url`.
- `useEditor()` with no argument calls `createEditor({ schema: defaultSchema })`. It injects the default schema and still installs no preset. Pass `preset: defaultPreset()` or explicit `extensions` when the host wants undo, shortcuts, tools, or the stream extension.
- `PenEditor` adopts `PEN_EDITOR_CHROME_STYLESHEET` by default (`chrome`, default `true`). Pass `:chrome="false"` for the unstyled HOST6 path.
- The `readonly` prop on `PenEditor` is what declines pointer activation and local typing. `pen.ariaReadOnly` is read only for `aria-readonly` and does not set `data-readonly`. The facet does not decline typing, `editor.apply`, or the wire. That split is an open owner decision.
- Boolean `data-*` attributes use the same valueless form as `@input/pen-dom` (`data-readonly=""`). ARIA booleans remain `"true"` / `"false"`.
- Support renderer overrides so host apps can customize block rendering without forking the runtime
- Validate that keyboard routing, Escape selection transitions, select-all behavior, clipboard, and table-editing behavior stay portable across frameworks

## Integration Notes

- Path in workspace: `packages/rendering/vue`
- Spec path mirrors workspace path: `packages/rendering/vue.md`
- `PenEditor` is the main integration entrypoint; it renders default `PenContent` when no default slot is provided, and `PenVuePlugin` is optional convenience for global registration
- The package intentionally exposes fewer primitives than `@input/pen-react`; that is a design choice, not necessarily a gap
- Use this package when a Vue host needs Pen without rebuilding the editing engine

## Current Maturity / Intended Usage

Workspace package at version `0.2.0`; intended usage is current-state but still evolving. The package is intentionally lean, but it is now important enough that regressions here should be treated as architectural regressions, not just renderer-specific bugs.

## Non-goals

- Do not force full React surface parity before the shared cross-framework boundaries are stable.
- Do not move shared editing behavior from `@input/pen-dom` into Vue-only code.
- Do not let Vue component-local state become the authority for selection, decorations, or document mutations.
