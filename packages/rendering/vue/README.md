# `@input/pen-vue`

Vue rendering primitives for Pen.

`@input/pen-vue` is the first non-React renderer in the Pen monorepo. It is intentionally lean: it proves that editor lifecycle, rendering, selection, decorations, and field-editor integration are not tied to React.

This package does not ship a stylesheet or a preset. `PenEditor` mounts the shared DOM field-editor engine from `@input/pen-dom`.

## Install

```bash
pnpm add @input/pen @input/pen-vue vue yjs
```

`vue` is a peer of this package. `yjs` is a peer of `@input/pen-yjs`, which `@input/pen-core` depends on.

## Quick Start

```ts
import { createEditor } from "@input/pen";
import { PenEditor } from "@input/pen-vue";

const editor = createEditor();
```

```vue
<template>
  <PenEditor :editor="editor" empty-placeholder="Start writing..." />
</template>
```

`useEditor()` still exists. With no argument it calls `createEditor({ schema: defaultSchema })` and does not install `defaultPreset()` — no Mod-B / Mod-I, undo, `tools`, or `delta-stream`. Undo fails silently. Pass `{ preset: defaultPreset() }` when you want that stack. `PenVuePlugin` only registers the components.

## Public Surface

- `PenEditor`, `PenContent`, `PenBlock`, `PenInlineContent`, `PenFieldEditor`
- `useEditor`, `useSelection`, `useBlockList`, `useDecorations`
- `PenVuePlugin`
- `RendererOverrides` and paste importer types

## Example

```ts
import { defineComponent, h } from "vue";
import { createEditor } from "@input/pen";
import { PenEditor } from "@input/pen-vue";

const editor = createEditor();

export const PenExample = defineComponent({
  name: "PenExample",
  setup() {
    return () =>
      h(PenEditor, {
        editor,
        emptyPlaceholder: "Write something...",
      });
  },
});
```

## Capabilities

The normative per-surface matrix is `packages/docs/CAPABILITY-MATRIX.md` in the Pen repository. Vue's column, in short:

- `supported`: single-block fields, expanded (multi-block) fields, table-cell editing, document mutation, host-defined container blocks, paste import (the HTML importer is wired by default), the review-surface styling contract, editor-field chrome.
- `bring-your-own-ui`: AI review, streaming preview, autocomplete, multiplayer, search, undo, snapshots, input rules, overlays, and every Chrome row — toolbar, selection toolbar, slash menu, suggestion menu, block handle, table chrome. For the Chrome rows this is the designed state (HB1): the matrix cites the core or pen-dom behavior a Vue toolbar or menu builds on. The state and behavior reach Vue — AI decorations paint through `useDecorations` like any other decoration — and this package ships no components for them.
- `not-supported`: nothing. Every capability reaches Vue.

That second list is not a to-do list. Pen's capabilities live in `@input/pen-core`, `@input/pen-dom`, and the extensions; React ships more chrome over the same state, and Vue reaching React's component count is not a goal.

## Notes

- Client-only mount: Vue has no `"use client"` directive, so this package does not emit one — mount `PenEditor` in the browser.
- `PenEditor` adopts editor-field chrome by default. Pass `:chrome="false"` for the HOST6 unstyled path. The HOST6 styling contract is [STYLING.md](./STYLING.md).
- `PenEditor` installs the shared DOM field-editor engine from `@input/pen-dom`.
- Renderer overrides let host apps customize block rendering without forking the editor runtime.
- Paste importers can be passed through the `importers` prop on `PenEditor`.

## Options

`PenEditor` takes a required `editor` prop. `emptyPlaceholder` is optional; when omitted, the editor uses the message-catalog string for `pen.schema.document.emptyPlaceholder` (`Start writing...`). `importers` is optional. `chrome` defaults to `true` (adopts editor-field chrome); pass `:chrome="false"` to skip.

`readonly` defaults to `false`. The prop declines typing and pointer activation, sets `data-readonly` (match with `[data-readonly]`, not `[data-readonly="true"]`), and sets `aria-readonly="true"`. It does not stop `editor.apply`. `pen.ariaReadOnly` the facet only sets `aria-readonly`.

`engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`. The required peer is `vue` (`^3.4.0`).

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Getting started page (`#/getting-started`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
