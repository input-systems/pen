# `@input/pen`

`@input/pen` is the batteries-included starter package: `defaultPreset()` is an `EditorPreset` that assembles the default schema and five headless extensions, and this package's `createEditor` / `createHeadlessEditor` are core's constructors with one difference — an omitted `preset` defaults to `defaultPreset()`, so a quickstart is one import and `createEditor()`. It does not render a surface or ship CSS.

## What it assembles

`defaultPreset()` with no options (or with every flag left on) resolves to this stack, in order. The Option column is the `DefaultPresetOptions` flag that installs that row; each flag defaults on, and `false` omits the extension.

| Extension name        | Package                   | Option          |
| --------------------- | ------------------------- | --------------- |
| `tools`               | `@input/pen-tools`        | `tools`         |
| `delta-stream`        | `@input/pen-ai/stream`    | `deltaStream`   |
| `undo`                | `@input/pen-undo`         | `undo`          |
| `rich-text-shortcuts` | `@input/pen-shortcuts`    | `shortcuts`     |
| `html-clipboard`      | `@input/pen-interop/html` | `htmlClipboard` |

`resolve()` also returns `schema: createDefaultSchema()` from `@input/pen-schema` — that package's default block and inline set, with unknown-block passthrough. This preset does not pass options into the factory (`createDefaultSchema()` takes none) and does not extend the registry. This package's `createEditor()` therefore installs the default blocks; core's `createEditor()` with no schema and no preset does not.

Core's bare `createEditor({ schema })` (no preset) installs no extensions. The four that used to come from core's no-preset fallback — `tools`, `undo`, `rich-text-shortcuts`, and `delta-stream` — are gone. Dependents of the first three fail loudly. Undo fails silently: `canUndo()` is false, Mod-Z is dead, and nothing throws. This preset is the batteries-included path: Mod-B / Mod-I, undo / Mod-Z, and `aiExtension()`'s `delta-stream` dependency all require it (or an explicit `extensions` entry), which is why this package's constructors apply it by default.

This package does not assemble a renderer, AI, search, snapshots, autoformat, or multiplayer. It does contribute the default HTML paste importer through `clipboardFacet` (`html-clipboard`): that extension provides `{ html: htmlImporter }`, and the facet merges provider tables so a second importer (markdown, assets, or a host overlay) composes instead of disabling HTML paste. A host on core's bare `createEditor()` plus a renderer does not get HTML paste unless they supply `importers.html`.

The capability matrix (`packages/docs/CAPABILITY-MATRIX.md`) is per surface, not per preset. A host diffs this battery list against that matrix: this preset supplies undo (`undo`) and HTML paste (`html-clipboard`), and the `delta-stream` writer that streaming preview depends on. It does not supply AI review UI, autocomplete, search, snapshots, autoformat, multiplayer, overlays, or field editors — those stay the extension or binding the matrix cell names.

## Install

This package has no peer dependencies.

```bash
pnpm add @input/pen
```

`@input/pen-core` arrives as a dependency and stays the runtime authority; this package's `createEditor` forwards to core's after defaulting the `preset` option to `defaultPreset()`. Explicit `preset`, `schema`, and `extensions` options pass through unchanged, and `@input/pen-core`'s constructors stay the bare, preset-free path. A renderer (`@input/pen-react`, `@input/pen-vue`, or `@input/pen-dom`) is a separate install when you want a mounted editor.

## Usage

```ts
import { createEditor } from "@input/pen";

const editor = createEditor();
```

Each assembled feature can be turned off by passing the preset explicitly. `deltaStream` and `shortcuts` also accept the option objects from those packages:

```ts
import { createEditor, defaultPreset } from "@input/pen";

const editor = createEditor({
  preset: defaultPreset({
    tools: false,
    deltaStream: false,
    undo: false,
    shortcuts: {
      onToggleLink: (editor) => {
        return true;
      },
    },
  }),
});
```

### Options

| Option          | Default   | Effect                                                                                                  |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `tools`         | on        | `false` omits `toolsExtension()`                                                                        |
| `deltaStream`   | on        | `false` omits `deltaStreamExtension()`; an object is passed through as `DeltaStreamOptions`             |
| `undo`          | on        | `false` omits `undoExtension()`                                                                         |
| `shortcuts`     | on (`{}`) | `false` omits `richTextShortcutsExtension()`; an object is passed through as `RichTextShortcutsOptions` |
| `htmlClipboard` | on        | `false` omits `htmlClipboardExtension()`                                                                |
| `smoothStream`  | off       | `true` installs `smoothStreamExtension()`; an object is passed through as `SmoothStreamOptions`         |

The public exports are `defaultPreset`, `DefaultPresetOptions`, the preset-defaulting `createEditor` and `createHeadlessEditor`, and the re-exported types `CreateEditorOptions` and `Editor`.

## HOST1 — client boundary

This package has no `"use client"` directive. It is a non-rendering assembler and stays importable from server modules (`spec/rules/host.md` HOST1). The React client boundary lives on `@input/pen-react` entry points, not here.

In Next.js App Router, import `PenEditor` from a Client Component. `defaultPreset` does not need that wrapper.

## HOST3 — Node floor

`engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`. The workspace Node and browser floor is the browser-and-Node-support table in the repository root README.

## HOST6 — no required stylesheet

This package ships no stylesheet. Renderer mounts (`PenEditor`, `Editor.Root`, `mountEditor`) adopt editor-field chrome by default; pass `chrome={false}` for the unstyled path. The custom-property surface is documented in `STYLING.md`, which ships inside the `@input/pen-react` package.

Mounted examples live in the repository under `examples/react`, `examples/vue`, and `examples/vanilla`.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Getting started page (`#/getting-started`) and the Core concepts page (`#/core-concepts`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
