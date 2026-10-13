# @input/pen-core

Headless editor runtime for Pen.

`createEditor` and `createHeadlessEditor` own document state, selection, normalization, and `editor.apply`. This package does not render a surface or ship CSS.

## Install

```bash
pnpm add @input/pen-core @input/pen
```

Most hosts start with `@input/pen` instead: its `createEditor()` defaults an omitted `preset` to `defaultPreset()`. This package's `createEditor()` is the bare constructor — it installs no extensions, and the fallback list is empty. Four that used to come from core are gone: `tools`, `undo`, `rich-text-shortcuts`, and `delta-stream`. Dependents of the first three fail loudly. Undo fails silently: `canUndo()` is false, Mod-Z is dead, and nothing throws.

## What It Provides

- `createEditor(...)` to create editor instances
- `createHeadlessEditor(...)` for server-side, worker, and test workflows that need editor semantics without a renderer
- document state, selection, normalization, and mutation orchestration
- the canonical `editor.apply(...)` document mutation boundary
- `aiEgressFacet` / `aiEgressExtension` / `streamThroughEgress` — the single `pen.aiEgress` filter shared by generation, suggestions, and autocomplete

## Usage

```ts
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";

const editor = createEditor({
  preset: defaultPreset(),
});
```

## Headless Usage

```ts
import * as Y from "yjs";
import { createHeadlessEditor } from "@input/pen-core";
import { yjsAdapter, wrapYjsDocument } from "@input/pen-yjs";

const ydoc = new Y.Doc();
const adapter = yjsAdapter();
const editor = createHeadlessEditor({
  crdt: adapter,
  document: wrapYjsDocument(adapter, ydoc),
});
```

This snippet also needs `yjs` and `@input/pen-yjs`. Use this shape for migrations, AI workers, export workers, and tests that should run through Pen's mutation pipeline without mounting a UI.

`editor.destroy()` deactivates extensions and observation. It does not tear down an attached field editor — hosts own that call (React `EditorRoot` and Vue `PenEditor` already do). The method returns the queued teardown promise; callers that ignore it stay correct.

## Typical Pairing

Most apps use `@input/pen-core` with:

- `@input/pen`
- `@input/pen-react` or `@input/pen-vue`

See the repository root README for the broader package map.

## Options

Every `CreateEditorOptions` field is optional.

| Option            | Default | Effect                                                                |
| ----------------- | ------- | --------------------------------------------------------------------- |
| `schema`          | unset   | Active schema. Omitted with no preset does not install default blocks |
| `preset`          | unset   | Assembler such as `defaultPreset()`                                   |
| `extensions`      | unset   | Extra extensions merged with the preset                               |
| `locale`          | unset   | Editor locale                                                         |
| `messages`        | unset   | Partial message-catalog override                                      |
| `a11yLabel`       | unset   | Accessible name for the editor surface                                |
| `editorViewMode`  | unset   | View mode                                                             |
| `documentProfile` | unset   | Authoring profile                                                     |

`createHeadlessEditor` adds `useDefaultExtensions`, default `false`. When that flag is false and no `preset` is passed, the editor uses an empty preset. `useDefaultExtensions: true` installs nothing — the fallback list is empty. It does not install `tools`, `undo`, `rich-text-shortcuts`, or `delta-stream`. Pass `preset: defaultPreset()` for those, or use `@input/pen`'s constructors, which default an omitted `preset` to `defaultPreset()`.

`ariaReadOnlyFacet` (`pen.ariaReadOnly`) only sets `aria-readonly` on a mounted surface. It does not decline typing or stop `editor.apply`. The renderer `readonly` prop is what declines typing.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Core concepts page (`#/core-concepts`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input Systems B.V. See [`LICENSE.md`](./LICENSE.md).
